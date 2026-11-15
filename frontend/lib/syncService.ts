import { api } from './api';
import { dbDriver } from '../db/sqlite';
import { syncCatalog } from './catalogSyncService';
import { useNetworkStore } from '../store/useNetworkStore';
import { useAuthStore } from '../store/useAuthStore';
import { ensureDiagnosticImageUploaded } from './diagnosticImageUploadService';
import { MAX_RETRIES, MAX_ITENS_POR_LOTE, type StepResult } from './syncContracts';
import { syncPendingConversations } from './conversationSyncService';
import { sweepPendingSecondOpinions } from './pendingSecondOpinionService';

export { MAX_RETRIES };
export type { StepResult };

type QueueRow = Record<string, any>;

export interface FullSyncResult {
  ran: boolean;
  diagnostics: StepResult;
  feedbacks: StepResult;
  conversations: StepResult;
  secondOpinions: StepResult;
  catalogUpdated: boolean;
  /** Nomes das etapas que lançaram nesta rodada; vazio quando tudo correu. */
  falhas: string[];
}

const EMPTY_RESULT: FullSyncResult = {
  ran: false,
  diagnostics: { synced: 0, failed: 0 },
  feedbacks: { synced: 0, failed: 0 },
  conversations: { synced: 0, failed: 0 },
  secondOpinions: { synced: 0, failed: 0 },
  catalogUpdated: false,
  falhas: [],
};

function toArray(res: any): QueueRow[] {
  const out: QueueRow[] = [];
  for (let i = 0; i < res.rows.length; i++) out.push(res.rows.item(i));
  return out;
}

async function getQueueRows(table: string, includeFailed: boolean): Promise<QueueRow[]> {
  const pending = toArray(
    await dbDriver.execute(`SELECT * FROM ${table} WHERE sync_status = ?;`, ['PENDING'])
  ).filter((r) => (r.retry_count ?? 0) < MAX_RETRIES);

  if (!includeFailed) return pending;

  const failed = toArray(
    await dbDriver.execute(`SELECT * FROM ${table} WHERE sync_status = ?;`, ['FAILED'])
  ).map((r) => ({ ...r, retry_count: 0 }));

  return [...pending, ...failed];
}

function toIso(value: string | undefined): string {
  const parsed = value ? new Date(value.replace(' ', 'T')) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

async function uploadImageForDiagnostic(row: QueueRow): Promise<string> {
  return ensureDiagnosticImageUploaded({
    localId: row.local_id,
    imageUri: row.image_uri,
    imageS3Key: row.image_s3_key,
  });
}

async function markRetry(table: string, keyCol: string, row: QueueRow): Promise<void> {
  const retries = (row.retry_count ?? 0) + 1;
  const status = retries >= MAX_RETRIES ? 'FAILED' : 'PENDING';
  await dbDriver.execute(
    `UPDATE ${table} SET sync_status = ?, retry_count = ? WHERE ${keyCol} = ?;`,
    [status, retries, row[keyCol]]
  );
}

function emFatias<T>(itens: T[], tamanho: number): T[][] {
  const fatias: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) fatias.push(itens.slice(i, i + tamanho));
  return fatias;
}

/** Corpo de POST /sync/diagnostics para as linhas já com `image_s3_key`. Puro. */
export function montarCorpoDiagnosticos(rows: QueueRow[]) {
  return {
    diagnostics: rows.map((r) => ({
      local_id: r.local_id,
      timestamp: toIso(r.timestamp),
      image_s3_key: r.image_s3_key,
      location: r.latitude != null && r.longitude != null ? { lat: r.latitude, lng: r.longitude } : null,
      ai_result: {
        doenca_id: r.doenca_id,
        confianca: r.confianca_ia ?? 0,
        modelo_usado: r.modelo_usado,
        tempo_inferencia_ms: r.tempo_inferencia_ms ?? 0,
      },
      cross_validation: {
        status: r.cross_validation_status ?? 'SKIPPED',
        llm_doenca_id: r.llm_doenca_id ?? null,
        llm_confianca: r.llm_confianca ?? null,
        llm_observacoes: r.llm_observacoes ?? null,
      },
    })),
  };
}

/** Corpo de POST /sync/feedback. `serverIdByLocal` mapeia diagnostic_local_id -> server_id. Puro. */
export function montarCorpoFeedbacks(
  rows: QueueRow[],
  serverIdByLocal: Record<string, string | null>
) {
  return {
    feedbacks: rows.map((r) => ({
      diagnostic_server_id: serverIdByLocal[r.diagnostic_local_id] ?? null,
      diagnostic_local_id: r.diagnostic_local_id,
      timestamp_feedback: toIso(r.timestamp),
      is_correct: !!r.is_correct,
      user_correction_notes: r.user_correction_notes ?? null,
      corrected_doenca_id: r.corrected_doenca_id ?? null,
    })),
  };
}

async function syncFatiaDiagnosticos(rows: QueueRow[]): Promise<StepResult> {
  // A imagem sobe antes da fatia que a referencia.
  const ready: QueueRow[] = [];
  for (const row of rows) {
    if (!row.image_s3_key) {
      try {
        row.image_s3_key = await uploadImageForDiagnostic(row);
      } catch {
        // T5.8: item fica fora do lote desta rodada, permanece PENDING
        console.warn(`[Sync] Upload falhou para ${row.local_id}; mantido como PENDING.`);
        continue;
      }
    }
    ready.push(row);
  }
  if (ready.length === 0) return { synced: 0, failed: 0 };

  const { data } = await api.post('/api/v1/sync/diagnostics', montarCorpoDiagnosticos(ready));

  for (const item of data.synced_items ?? []) {
    await dbDriver.execute(
      'UPDATE fila_diagnosticos SET sync_status = ?, server_id = ? WHERE local_id = ?;',
      ['SYNCED', item.server_id, item.local_id]
    );
  }
  for (const item of data.failed_items ?? []) {
    const row = ready.find((r) => r.local_id === item.local_id);
    if (row) await markRetry('fila_diagnosticos', 'local_id', row);
  }

  return { synced: data.synced_count ?? 0, failed: data.failed_count ?? 0 };
}

export async function syncPendingDiagnostics(includeFailed = false): Promise<StepResult> {
  const rows = await getQueueRows('fila_diagnosticos', includeFailed);
  const total: StepResult = { synced: 0, failed: 0 };

  // Uma requisição por fatia, em sequência. Uma fatia concluída fica
  // concluída; se a seguinte lançar, o erro sobe e as demais ficam PENDING.
  for (const fatia of emFatias(rows, MAX_ITENS_POR_LOTE)) {
    const r = await syncFatiaDiagnosticos(fatia);
    total.synced += r.synced;
    total.failed += r.failed;
  }
  return total;
}

async function syncFatiaFeedbacks(
  rows: QueueRow[],
  serverIdByLocal: Record<string, string | null>
): Promise<StepResult> {
  const { data } = await api.post('/api/v1/sync/feedback', montarCorpoFeedbacks(rows, serverIdByLocal));

  for (const item of data.processed_items ?? []) {
    await dbDriver.execute(
      'UPDATE fila_feedbacks SET sync_status = ? WHERE diagnostic_local_id = ?;',
      ['SYNCED', item.diagnostic_local_id]
    );
  }
  for (const item of data.failed_items ?? []) {
    const row = rows.find((r) => r.diagnostic_local_id === item.diagnostic_local_id);
    if (row) await markRetry('fila_feedbacks', 'diagnostic_local_id', row);
  }

  return { synced: data.processed_count ?? 0, failed: data.failed_count ?? 0 };
}

export async function syncPendingFeedbacks(includeFailed = false): Promise<StepResult> {
  const rows = await getQueueRows('fila_feedbacks', includeFailed);
  if (rows.length === 0) return { synced: 0, failed: 0 };

  const diagRows = toArray(await dbDriver.execute('SELECT * FROM fila_diagnosticos;'));
  const serverIdByLocal: Record<string, string | null> = {};
  for (const d of diagRows) serverIdByLocal[d.local_id] = d.server_id ?? null;

  const total: StepResult = { synced: 0, failed: 0 };
  for (const fatia of emFatias(rows, MAX_ITENS_POR_LOTE)) {
    const r = await syncFatiaFeedbacks(fatia, serverIdByLocal);
    total.synced += r.synced;
    total.failed += r.failed;
  }
  return total;
}

let syncInProgress = false;

export async function runFullSync(opts: { includeFailed?: boolean } = {}): Promise<FullSyncResult> {
  if (syncInProgress) return EMPTY_RESULT;

  const mode = useNetworkStore.getState().connectionMode;
  if (mode !== 'ONLINE' && mode !== 'DEGRADED') return EMPTY_RESULT;
  if (!useAuthStore.getState().isAuthenticated) return EMPTY_RESULT;

  syncInProgress = true;
  console.log('[Sync] Iniciando sincronização completa...');
  try {
    const includeFailed = opts.includeFailed ?? false;
    const falhas: string[] = [];
    // Cada etapa tem o seu try: a exceção de uma não cancela as seguintes
    // (um lote recusado de diagnósticos não pode impedir o catálogo).
    const etapa = async <T,>(nome: string, vazio: T, fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        console.warn(`[Sync] A etapa "${nome}" falhou.`, err);
        falhas.push(nome);
        return vazio;
      }
    };
    const zero: StepResult = { synced: 0, failed: 0 };

    const diagnostics = await etapa('diagnostics', zero, () => syncPendingDiagnostics(includeFailed));
    const feedbacks = await etapa('feedbacks', zero, () => syncPendingFeedbacks(includeFailed));
    // Conversas depois dos diagnósticos: o servidor resolve o vínculo
    // `diagnostico_id` na hora quando o diagnóstico já chegou.
    const conversations = await etapa('conversations', zero, () => syncPendingConversations(includeFailed));
    const secondOpinions = await etapa('secondOpinions', zero, () => sweepPendingSecondOpinions());
    const catalog = await etapa('catalog', { updated: false }, () => syncCatalog());
    console.log('[Sync] Sincronização concluída.', {
      diagnostics, feedbacks, conversations, secondOpinions, falhas,
    });
    return {
      ran: true, diagnostics, feedbacks, conversations, secondOpinions,
      catalogUpdated: catalog.updated, falhas,
    };
  } finally {
    syncInProgress = false;
  }
}

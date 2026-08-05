import { api } from './api';
import { dbDriver } from '../db/sqlite';
import { syncCatalog } from './catalogSyncService';
import { useNetworkStore } from '../store/useNetworkStore';
import { useAuthStore } from '../store/useAuthStore';
import { ensureDiagnosticImageUploaded } from './diagnosticImageUploadService';

export const MAX_RETRIES = 5;
export const CLEANUP_DAYS = 30;

type QueueRow = Record<string, any>;

export interface StepResult { synced: number; failed: number }

export interface FullSyncResult {
  ran: boolean;
  diagnostics: StepResult;
  feedbacks: StepResult;
  slmLogs: StepResult;
  catalogUpdated: boolean;
}

const EMPTY_RESULT: FullSyncResult = {
  ran: false,
  diagnostics: { synced: 0, failed: 0 },
  feedbacks: { synced: 0, failed: 0 },
  slmLogs: { synced: 0, failed: 0 },
  catalogUpdated: false,
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

export async function syncPendingDiagnostics(includeFailed = false): Promise<StepResult> {
  const rows = await getQueueRows('fila_diagnosticos', includeFailed);
  if (rows.length === 0) return { synced: 0, failed: 0 };

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

  const { data } = await api.post('/api/v1/sync/diagnostics', {
    diagnostics: ready.map((r) => ({
      local_id: r.local_id,
      timestamp: toIso(r.timestamp),
      image_s3_key: r.image_s3_key,
      location: { lat: r.latitude ?? 0, lng: r.longitude ?? 0 },
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
  });

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

export async function syncPendingFeedbacks(includeFailed = false): Promise<StepResult> {
  const rows = await getQueueRows('fila_feedbacks', includeFailed);
  if (rows.length === 0) return { synced: 0, failed: 0 };

  const diagRows = toArray(await dbDriver.execute('SELECT * FROM fila_diagnosticos;'));
  const serverIdByLocal: Record<string, string | null> = {};
  for (const d of diagRows) serverIdByLocal[d.local_id] = d.server_id ?? null;

  const { data } = await api.post('/api/v1/sync/feedback', {
    feedbacks: rows.map((r) => ({
      diagnostic_server_id: serverIdByLocal[r.diagnostic_local_id] ?? null,
      diagnostic_local_id: r.diagnostic_local_id,
      timestamp_feedback: toIso(r.timestamp),
      is_correct: !!r.is_correct,
      user_correction_notes: r.user_correction_notes ?? null,
      corrected_doenca_id: r.corrected_doenca_id ?? null,
    })),
  });

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

export async function syncPendingSlmLogs(includeFailed = false): Promise<StepResult> {
  const rows = await getQueueRows('fila_slm_logs', includeFailed);
  if (rows.length === 0) return { synced: 0, failed: 0 };

  const { data } = await api.post('/api/v1/sync/slm-logs', {
    slm_sessions: rows.map((r) => ({
      session_id: r.session_id,
      started_at: toIso(r.started_at),
      model_version: r.model_version,
      interactions: JSON.parse(r.interactions_json || '[]'),
    })),
  });

  if (data.status === 'success') {
    for (const r of rows) {
      await dbDriver.execute(
        'UPDATE fila_slm_logs SET sync_status = ? WHERE session_id = ?;',
        ['SYNCED', r.session_id]
      );
    }
  }

  return { synced: data.processed_count ?? 0, failed: 0 };
}

export async function cleanupSyncedRecords(): Promise<void> {
  const cutoff = new Date(Date.now() - CLEANUP_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await dbDriver.execute(
    "DELETE FROM fila_feedbacks WHERE sync_status = 'SYNCED' AND datetime(timestamp) < datetime(?);",
    [cutoff]
  );
  await dbDriver.execute(
    "DELETE FROM fila_diagnosticos WHERE sync_status = 'SYNCED' AND datetime(timestamp) < datetime(?);",
    [cutoff]
  );
  await dbDriver.execute(
    "DELETE FROM fila_slm_logs WHERE sync_status = 'SYNCED' AND datetime(started_at) < datetime(?);",
    [cutoff]
  );
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
    const diagnostics = await syncPendingDiagnostics(includeFailed);
    const feedbacks = await syncPendingFeedbacks(includeFailed);
    const slmLogs = await syncPendingSlmLogs(includeFailed);
    const catalog = await syncCatalog();
    await cleanupSyncedRecords();
    console.log('[Sync] Sincronização concluída.', { diagnostics, feedbacks, slmLogs });
    return { ran: true, diagnostics, feedbacks, slmLogs, catalogUpdated: catalog.updated };
  } finally {
    syncInProgress = false;
  }
}

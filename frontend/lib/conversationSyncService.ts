import { api } from './api';
import { dbDriver } from '../db/sqlite';
import { updateMessageAttachment, type ChatAttachment } from './chatRepository';
import { ensureDiagnosticImageUploaded } from './diagnosticImageUploadService';
import { MAX_RETRIES, type StepResult } from './syncContracts';

export const MAX_CONVERSAS_POR_LOTE = 20;
export const MAX_MENSAGENS_POR_ENVELOPE = 200;

type Row = Record<string, any>;

interface EnvelopeMensagem {
  message_id: string;
  role: string;
  content: string;
  source: string | null;
  attachment_s3_key: string | null;
  latency_ms: number | null;
  created_at: string;
}

interface Envelope {
  session_id: string;
  title: string;
  origin_diagnostic_local_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  messages: EnvelopeMensagem[];
}

function toArray(res: any): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < res.rows.length; i++) out.push(res.rows.item(i));
  return out;
}

/**
 * Sessão pendente **ou** sessão já sincronizada que ganhou mensagem nova. Sem a
 * segunda metade, uma conversa continuada depois da primeira subida nunca mais
 * sairia do aparelho.
 *
 * A forma muda com `includeFailed` em vez de ser uma cláusula só: uma sessão
 * FAILED tem mensagens PENDING por definição, e uma cláusula única a traria de
 * volta em toda rodada automática — furando o limite de cinco tentativas.
 */
const SQL_SESSOES_AUTOMATICO = `
  SELECT * FROM chat_sessions
   WHERE sync_status = 'PENDING'
      OR (sync_status = 'SYNCED'
          AND EXISTS (SELECT 1 FROM chat_messages m
                       WHERE m.session_id = chat_sessions.id AND m.sync_status = 'PENDING'))
   ORDER BY created_at ASC;
`;

const SQL_SESSOES_MANUAL = `
  SELECT * FROM chat_sessions
   WHERE sync_status IN ('PENDING', 'FAILED')
      OR EXISTS (SELECT 1 FROM chat_messages m
                  WHERE m.session_id = chat_sessions.id AND m.sync_status = 'PENDING')
   ORDER BY created_at ASC;
`;

async function sessoesParaSincronizar(includeFailed: boolean): Promise<Row[]> {
  const res = await dbDriver.execute(includeFailed ? SQL_SESSOES_MANUAL : SQL_SESSOES_AUTOMATICO);
  return toArray(res)
    .map((r) => (r.sync_status === 'FAILED' ? { ...r, retry_count: 0 } : r))
    .filter((r) => (r.retry_count ?? 0) < MAX_RETRIES);
}

async function mensagensPendentes(sessionId: string): Promise<Row[]> {
  const res = await dbDriver.execute(
    "SELECT * FROM chat_messages WHERE session_id = ? AND sync_status = 'PENDING' ORDER BY created_at ASC;",
    [sessionId]
  );
  return toArray(res);
}

function lerAnexo(row: Row): ChatAttachment | null {
  if (!row.attachment_json) return null;
  try {
    return JSON.parse(row.attachment_json) as ChatAttachment;
  } catch {
    return null;
  }
}

/**
 * A imagem sobe antes do lote que a referencia — a mesma regra dos
 * diagnósticos. `ensureDiagnosticImageUploaded` lê a chave já gravada antes de
 * subir de novo, então chamar aqui não custa um segundo PUT.
 */
async function garantirAnexos(mensagens: Row[]): Promise<void> {
  for (const row of mensagens) {
    const anexo = lerAnexo(row);
    if (!anexo || !anexo.diagnosticLocalId || anexo.imageS3Key) continue;

    anexo.imageS3Key = await ensureDiagnosticImageUploaded({
      localId: anexo.diagnosticLocalId,
      imageUri: anexo.imageUri,
      imageS3Key: anexo.imageS3Key,
    });
    row.attachment_json = JSON.stringify(anexo);
    await updateMessageAttachment(row.id, anexo);
  }
}

function paraEnvelopeMensagem(row: Row): EnvelopeMensagem {
  return {
    message_id: row.id,
    role: row.role,
    content: row.content ?? '',
    source: row.source ?? null,
    // Do anexo vai só a chave: o caminho file:// é do aparelho, e o resultado
    // do CV o servidor lê de `diagnosticos`.
    attachment_s3_key: lerAnexo(row)?.imageS3Key ?? null,
    latency_ms: row.latency_ms ?? null,
    created_at: row.created_at,
  };
}

function montarEnvelopes(sessao: Row, mensagens: Row[]): Envelope[] {
  const base = {
    session_id: sessao.id,
    // A migração v7 monta o título com `?? 'Conversa'`, que não dispara para
    // string vazia. O servidor valida title com min(1) de propósito, para
    // nunca guardar conversa sem nome — quem cede aqui é o cliente.
    title: sessao.title || 'Conversa',
    origin_diagnostic_local_id: sessao.origin_diagnostic_local_id ?? null,
    created_at: sessao.created_at,
    updated_at: sessao.updated_at,
    deleted_at: sessao.deleted_at ?? null,
  };

  if (mensagens.length === 0) return [{ ...base, messages: [] }];

  const envelopes: Envelope[] = [];
  for (let i = 0; i < mensagens.length; i += MAX_MENSAGENS_POR_ENVELOPE) {
    envelopes.push({
      ...base,
      messages: mensagens.slice(i, i + MAX_MENSAGENS_POR_ENVELOPE).map(paraEnvelopeMensagem),
    });
  }
  return envelopes;
}

async function marcarSincronizada(sessionId: string, mensagens: Row[]): Promise<void> {
  await dbDriver.execute(
    "UPDATE chat_sessions SET sync_status = 'SYNCED', retry_count = 0 WHERE id = ?;",
    [sessionId]
  );
  if (mensagens.length === 0) return;

  // Por id, e não "todas as pendentes da sessão": uma mensagem escrita
  // enquanto a requisição estava no ar não subiu e não pode ser marcada.
  const marcas = mensagens.map(() => '?').join(', ');
  await dbDriver.execute(
    `UPDATE chat_messages SET sync_status = 'SYNCED' WHERE id IN (${marcas});`,
    mensagens.map((m) => m.id)
  );
}

async function marcarRetentativa(sessao: Row): Promise<void> {
  const tentativas = (sessao.retry_count ?? 0) + 1;
  const status = tentativas >= MAX_RETRIES ? 'FAILED' : 'PENDING';
  await dbDriver.execute('UPDATE chat_sessions SET sync_status = ?, retry_count = ? WHERE id = ?;', [
    status,
    tentativas,
    sessao.id,
  ]);
}

export async function syncPendingConversations(includeFailed = false): Promise<StepResult> {
  const sessoes = await sessoesParaSincronizar(includeFailed);
  if (sessoes.length === 0) return { synced: 0, failed: 0 };

  const prontas = new Map<string, { sessao: Row; mensagens: Row[] }>();
  const envelopes: Envelope[] = [];

  for (const sessao of sessoes) {
    const mensagens = await mensagensPendentes(sessao.id);
    try {
      await garantirAnexos(mensagens);
    } catch {
      // Falta de rede não é culpa do dado: a sessão fica PENDING para a
      // próxima rodada, sem consumir tentativa.
      console.warn(`[Sync] Anexo de ${sessao.id} não subiu; conversa mantida como PENDING.`);
      continue;
    }
    prontas.set(sessao.id, { sessao, mensagens });
    envelopes.push(...montarEnvelopes(sessao, mensagens));
  }

  if (envelopes.length === 0) return { synced: 0, failed: 0 };

  const sincronizadas = new Set<string>();
  const falhadas = new Set<string>();

  for (let i = 0; i < envelopes.length; i += MAX_CONVERSAS_POR_LOTE) {
    const lote = envelopes.slice(i, i + MAX_CONVERSAS_POR_LOTE);
    const { data } = await api.post('/api/v1/sync/conversations', { conversations: lote });

    for (const item of data.synced_items ?? []) {
      const pronta = prontas.get(item.session_id);
      if (!pronta || sincronizadas.has(item.session_id)) continue;
      await marcarSincronizada(pronta.sessao.id, pronta.mensagens);
      sincronizadas.add(item.session_id);
    }
    for (const item of data.failed_items ?? []) {
      const pronta = prontas.get(item.session_id);
      if (!pronta || falhadas.has(item.session_id)) continue;
      await marcarRetentativa(pronta.sessao);
      falhadas.add(item.session_id);
    }
  }

  // Conta sessões, não envelopes: uma conversa longa parte em vários e
  // continua sendo uma conversa.
  return { synced: sincronizadas.size, failed: falhadas.size };
}

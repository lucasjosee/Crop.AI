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

/**
 * Um envelope junto das linhas que ele carrega. `mensagens` não vai no corpo
 * da requisição (só `envelope` vai) — existe para marcar como SYNCED
 * exatamente as mensagens deste envelope quando (e só quando) a resposta
 * confirmar o lote em que ele foi enviado, nunca a lista inteira da sessão.
 */
interface EnvelopeParaEnviar {
  envelope: Envelope;
  sessionId: string;
  mensagens: Row[];
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

function montarEnvelopes(sessao: Row, mensagens: Row[]): EnvelopeParaEnviar[] {
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

  if (mensagens.length === 0) {
    return [{ envelope: { ...base, messages: [] }, sessionId: sessao.id, mensagens: [] }];
  }

  const envelopes: EnvelopeParaEnviar[] = [];
  for (let i = 0; i < mensagens.length; i += MAX_MENSAGENS_POR_ENVELOPE) {
    const fatia = mensagens.slice(i, i + MAX_MENSAGENS_POR_ENVELOPE);
    envelopes.push({
      envelope: { ...base, messages: fatia.map(paraEnvelopeMensagem) },
      sessionId: sessao.id,
      mensagens: fatia,
    });
  }
  return envelopes;
}

async function marcarMensagensSincronizadas(mensagens: Row[]): Promise<void> {
  if (mensagens.length === 0) return;

  // Por id, e não "todas as pendentes da sessão": uma mensagem escrita
  // enquanto a requisição estava no ar não subiu e não pode ser marcada. Pelo
  // mesmo motivo, quem chama já filtrou para só as mensagens do(s) envelope(s)
  // confirmados neste lote — nunca a lista inteira da sessão, que pode ter
  // envelopes irmãos ainda não enviados ou enviados num lote que falhou.
  const marcas = mensagens.map(() => '?').join(', ');
  await dbDriver.execute(
    `UPDATE chat_messages SET sync_status = 'SYNCED' WHERE id IN (${marcas});`,
    mensagens.map((m) => m.id)
  );
}

async function marcarSessaoSincronizada(sessionId: string): Promise<void> {
  await dbDriver.execute(
    "UPDATE chat_sessions SET sync_status = 'SYNCED', retry_count = 0 WHERE id = ?;",
    [sessionId]
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

  const prontas = new Map<string, { sessao: Row; totalEnvelopes: number }>();
  const envelopes: EnvelopeParaEnviar[] = [];

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
    const doSessao = montarEnvelopes(sessao, mensagens);
    prontas.set(sessao.id, { sessao, totalEnvelopes: doSessao.length });
    envelopes.push(...doSessao);
  }

  if (envelopes.length === 0) return { synced: 0, failed: 0 };

  // Envelopes confirmados por sessão, acumulado ao longo de toda a rodada —
  // não por lote — porque uma sessão com mais de MAX_MENSAGENS_POR_ENVELOPE
  // mensagens pendentes parte em vários envelopes, e o corte em lotes de
  // MAX_CONVERSAS_POR_LOTE não se alinha por sessão: os envelopes irmãos
  // podem cair em requisições diferentes.
  const envelopesConfirmados = new Map<string, number>();
  const sessoesComFalha = new Set<string>();

  for (let i = 0; i < envelopes.length; i += MAX_CONVERSAS_POR_LOTE) {
    const lote = envelopes.slice(i, i + MAX_CONVERSAS_POR_LOTE);
    const { data } = await api.post('/api/v1/sync/conversations', {
      conversations: lote.map((e) => e.envelope),
    });

    const confirmadosNesteLote = new Set<string>();
    for (const item of data.synced_items ?? []) {
      if (confirmadosNesteLote.has(item.session_id)) continue;
      confirmadosNesteLote.add(item.session_id);

      // Só os envelopes DESTE lote: uma sessão cujos envelopes irmãos ainda
      // não subiram (ou subiram num lote que falhou) não pode ter as
      // mensagens deles marcadas como sincronizadas.
      const doLote = lote.filter((e) => e.sessionId === item.session_id);
      if (doLote.length === 0) continue;
      await marcarMensagensSincronizadas(doLote.flatMap((e) => e.mensagens));
      envelopesConfirmados.set(item.session_id, (envelopesConfirmados.get(item.session_id) ?? 0) + doLote.length);
    }

    for (const item of data.failed_items ?? []) {
      sessoesComFalha.add(item.session_id);
    }
  }

  const sincronizadas = new Set<string>();
  const falhadas = new Set<string>();

  for (const [sessionId, pronta] of prontas) {
    if (sessoesComFalha.has(sessionId)) {
      // Uma vez só, não uma por envelope: uma sessão com dois envelopes, um
      // confirmado e outro rejeitado, ainda é uma tentativa a mais — não duas.
      await marcarRetentativa(pronta.sessao);
      falhadas.add(sessionId);
    } else if ((envelopesConfirmados.get(sessionId) ?? 0) >= pronta.totalEnvelopes) {
      await marcarSessaoSincronizada(sessionId);
      sincronizadas.add(sessionId);
    }
    // Nem confirmada nem falhada: a resposta não cobriu esta sessão neste
    // ciclo. Ela fica como estava e volta a ser candidata na próxima rodada.
  }

  // Conta sessões, não envelopes: uma conversa longa parte em vários e
  // continua sendo uma conversa.
  return { synced: sincronizadas.size, failed: falhadas.size };
}

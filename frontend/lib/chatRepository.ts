import { randomUUID } from 'expo-crypto';
import { dbDriver } from '../db/sqlite';
import type { InferenceResult } from './inference';

export type MessageSource = 'LOCAL_SLM' | 'CLOUD_LLM';

export interface ChatAttachment {
  imageUri: string;
  imageS3Key?: string;
  cvResult: InferenceResult;
  /** Nome da doença, quando conhecido — poupa o motor de precisar do catálogo para se referir a ela. */
  diseaseName?: string;
  /** local_id em fila_diagnosticos; necessário para o upload da imagem. */
  diagnosticLocalId?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  originDiagnosticLocalId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  source: MessageSource | null;
  attachment: ChatAttachment | null;
  latencyMs: number | null;
  createdAt: string;
}

export interface MapSession {
  sessionId: string;
  title: string;
  createdAt: string;
  latitude: number;
  longitude: number;
  doencaId: string | null;
  confiancaIa: number | null;
  crossValidationStatus: string | null;
  imageUri: string | null;
}

type SessionRow = Record<string, any>;
type MessageRow = Record<string, any>;

function toSession(row: SessionRow): ChatSession {
  return {
    id: row.id,
    title: row.title,
    originDiagnosticLocalId: row.origin_diagnostic_local_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
  };
}

function toMessage(row: MessageRow): ChatMessage {
  let attachment: ChatAttachment | null = null;
  if (row.attachment_json) {
    try {
      attachment = JSON.parse(row.attachment_json);
    } catch {
      attachment = null;
    }
  }
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content ?? '',
    source: row.source ?? null,
    attachment,
    latencyMs: row.latency_ms ?? null,
    createdAt: row.created_at,
  };
}

export async function createSession(input: {
  title: string;
  originDiagnosticLocalId?: string | null;
}): Promise<ChatSession> {
  const now = new Date().toISOString();
  const session: ChatSession = {
    id: randomUUID(),
    title: input.title,
    originDiagnosticLocalId: input.originDiagnosticLocalId ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await dbDriver.execute(
    `INSERT INTO chat_sessions
       (id, title, origin_diagnostic_local_id, created_at, updated_at, deleted_at, sync_status, retry_count)
     VALUES (?, ?, ?, ?, ?, NULL, 'PENDING', 0);`,
    [session.id, session.title, session.originDiagnosticLocalId, now, now]
  );
  return session;
}

export async function getSession(id: string): Promise<ChatSession | null> {
  const res = await dbDriver.execute('SELECT * FROM chat_sessions WHERE id = ?;', [id]);
  return res.rows.length > 0 ? toSession(res.rows._array[0]) : null;
}

export async function listMessages(sessionId: string): Promise<ChatMessage[]> {
  const res = await dbDriver.execute(
    'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC;',
    [sessionId]
  );
  return res.rows._array.map(toMessage);
}

export async function appendMessage(input: {
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  source?: MessageSource | null;
  attachment?: ChatAttachment | null;
  latencyMs?: number | null;
}): Promise<ChatMessage> {
  const now = new Date().toISOString();
  const message: ChatMessage = {
    id: randomUUID(),
    sessionId: input.sessionId,
    role: input.role,
    content: input.content,
    source: input.source ?? null,
    attachment: input.attachment ?? null,
    latencyMs: input.latencyMs ?? null,
    createdAt: now,
  };
  await dbDriver.execute(
    `INSERT INTO chat_messages
       (id, session_id, role, content, source, attachment_json, latency_ms, created_at, sync_status, retry_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0);`,
    [
      message.id,
      message.sessionId,
      message.role,
      message.content,
      message.source,
      message.attachment ? JSON.stringify(message.attachment) : null,
      message.latencyMs,
      now,
    ]
  );
  await dbDriver.execute('UPDATE chat_sessions SET updated_at = ? WHERE id = ?;', [now, input.sessionId]);
  return message;
}

export async function updateMessageAttachment(messageId: string, attachment: ChatAttachment): Promise<void> {
  await dbDriver.execute('UPDATE chat_messages SET attachment_json = ? WHERE id = ?;', [
    JSON.stringify(attachment),
    messageId,
  ]);
}

export async function softDeleteSession(id: string): Promise<void> {
  const now = new Date().toISOString();
  await dbDriver.execute(
    "UPDATE chat_sessions SET deleted_at = ?, updated_at = ?, sync_status = 'PENDING' WHERE id = ?;",
    [now, now, id]
  );
}

export async function getSessionDiseaseId(sessionId: string): Promise<string | null> {
  const res = await dbDriver.execute(
    `SELECT d.doenca_id
       FROM chat_sessions s
       JOIN fila_diagnosticos d ON d.local_id = s.origin_diagnostic_local_id
      WHERE s.id = ?;`,
    [sessionId]
  );
  return res.rows.length > 0 ? (res.rows._array[0].doenca_id ?? null) : null;
}

/**
 * Última mensagem da sessão, se for do usuário e ainda não respondida —
 * com ou sem foto. Quem chama decide o que fazer: foto dispara sozinha
 * (spec §3.3), texto apenas oferece "gerar resposta".
 */
export async function findUnansweredUserMessage(sessionId: string): Promise<ChatMessage | null> {
  const res = await dbDriver.execute(
    'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 1;',
    [sessionId]
  );
  if (res.rows.length === 0) return null;
  const last = toMessage(res.rows._array[0]);
  return last.role === 'user' ? last : null;
}

/** Rota de conversa que ainda não existe. A sessão nasce no primeiro envio. */
export const SESSAO_NOVA = 'novo';

/** Limite de `conversas.titulo` no Postgres. Passar disso derruba o envelope no sync. */
export const TITULO_MAX = 255;

export interface SessionListItem {
  id: string;
  title: string;
  updatedAt: string;
  /** Conteúdo da última mensagem. Vazio quando ela é a foto, que não tem texto. */
  lastMessageContent: string | null;
  lastMessageRole: 'user' | 'assistant' | null;
  /** Não-nulo quando a conversa nasceu de uma foto. */
  originDiagnosticLocalId: string | null;
  messageCount: number;
}

/**
 * As conversas da lista, da mais recente para a mais antiga.
 *
 * Sem paginação: a linha é leve e a FlatList virtualiza. Se um dia doer, o
 * LIMIT entra aqui sem mudar a interface.
 */
export async function listSessions(): Promise<SessionListItem[]> {
  const res = await dbDriver.execute(
    `SELECT s.id, s.title, s.updated_at, s.origin_diagnostic_local_id,
            (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS message_count,
            (SELECT m.content FROM chat_messages m WHERE m.session_id = s.id
              ORDER BY m.created_at DESC LIMIT 1) AS last_message_content,
            (SELECT m.role FROM chat_messages m WHERE m.session_id = s.id
              ORDER BY m.created_at DESC LIMIT 1) AS last_message_role
       FROM chat_sessions s
      WHERE s.deleted_at IS NULL
      ORDER BY s.updated_at DESC;`
  );
  return (res.rows._array as Array<Record<string, any>>).map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: row.updated_at,
    lastMessageContent: row.last_message_content ?? null,
    lastMessageRole: row.last_message_role ?? null,
    originDiagnosticLocalId: row.origin_diagnostic_local_id ?? null,
    messageCount: row.message_count ?? 0,
  }));
}

/**
 * Renomeia e devolve o título que de fato ficou gravado.
 *
 * O bump em `updated_at` não é cosmético: a guarda monotônica do servidor
 * (sub-projeto 4) descarta em silêncio um título cujo `updated_at` seja
 * anterior ao que ele já tem.
 */
export async function renameSession(id: string, title: string): Promise<string> {
  const limpo = title.trim().slice(0, TITULO_MAX);
  // Vazio não escreve: o servidor exige título com pelo menos um caractere, e
  // conversa sem nome não ajuda ninguém a se reencontrar na lista.
  if (!limpo) {
    const atual = await getSession(id);
    return atual?.title ?? '';
  }

  const now = new Date().toISOString();
  await dbDriver.execute(
    "UPDATE chat_sessions SET title = ?, updated_at = ?, sync_status = 'PENDING' WHERE id = ?;",
    [limpo, now, id]
  );
  return limpo;
}

/**
 * Resolve o id real da conversa, criando-a se a rota ainda é o sentinela.
 *
 * Mora aqui, e não na tela, porque `[sessionId].tsx` já tem mais de 500 linhas
 * e o projeto não testa tela.
 */
export async function ensureSession(
  routeId: string,
  title: string
): Promise<{ id: string; criada: boolean }> {
  if (routeId !== SESSAO_NOVA) return { id: routeId, criada: false };
  const session = await createSession({ title });
  return { id: session.id, criada: true };
}

export async function listMapSessions(): Promise<MapSession[]> {
  const res = await dbDriver.execute(
    `SELECT s.id, s.title, s.created_at,
            d.latitude, d.longitude, d.doenca_id, d.confianca_ia,
            d.cross_validation_status, d.image_uri
       FROM chat_sessions s
       JOIN fila_diagnosticos d ON d.local_id = s.origin_diagnostic_local_id
      WHERE s.deleted_at IS NULL AND d.latitude IS NOT NULL;`
  );
  return res.rows._array.map((row: Record<string, any>) => ({
    sessionId: row.id,
    title: row.title,
    createdAt: row.created_at,
    latitude: row.latitude,
    longitude: row.longitude,
    doencaId: row.doenca_id ?? null,
    confiancaIa: row.confianca_ia ?? null,
    crossValidationStatus: row.cross_validation_status ?? null,
    imageUri: row.image_uri ?? null,
  }));
}

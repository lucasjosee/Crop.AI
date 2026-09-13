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

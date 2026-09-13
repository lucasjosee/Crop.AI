import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  uuid: vi.fn(() => '00000000-0000-4000-8000-00000000000a'),
}));

vi.mock('../db/sqlite', () => ({ dbDriver: { execute: mocks.execute } }));
vi.mock('expo-crypto', () => ({ randomUUID: mocks.uuid }));

import {
  appendMessage,
  createSession,
  findUnansweredUserMessage,
  getSession,
  getSessionDiseaseId,
  listMapSessions,
  listMessages,
  softDeleteSession,
  updateMessageAttachment,
} from './chatRepository';

function rows(list: Array<Record<string, unknown>>) {
  return { rows: { _array: list, length: list.length, item: (i: number) => list[i] }, rowsAffected: 1 };
}

const sessionRow = {
  id: 's1', title: 'Ferrugem', origin_diagnostic_local_id: 'd1',
  created_at: '2026-09-12T10:00:00.000Z', updated_at: '2026-09-12T10:00:00.000Z', deleted_at: null,
};

describe('chatRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue(rows([]));
  });

  it('createSession insere PENDING e devolve a sessão com id gerado', async () => {
    const session = await createSession({ title: 'Ferrugem', originDiagnosticLocalId: 'd1' });

    expect(session.id).toBe('00000000-0000-4000-8000-00000000000a');
    expect(session.originDiagnosticLocalId).toBe('d1');
    const [sql, params] = mocks.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO chat_sessions');
    expect(sql).toContain("'PENDING'");
    expect(params).toEqual(expect.arrayContaining(['Ferrugem', 'd1']));
  });

  it('getSession mapeia snake_case para camelCase e devolve null se não existir', async () => {
    mocks.execute.mockResolvedValueOnce(rows([sessionRow]));
    expect(await getSession('s1')).toMatchObject({ id: 's1', originDiagnosticLocalId: 'd1', deletedAt: null });

    mocks.execute.mockResolvedValueOnce(rows([]));
    expect(await getSession('nope')).toBeNull();
  });

  it('appendMessage persiste PENDING e serializa o attachment', async () => {
    const attachment = {
      imageUri: 'file:///f.jpg',
      cvResult: { diseaseId: 'x', confidence: 0.9, inferenceTimeMs: 40, modelUsed: 'm' },
      diagnosticLocalId: 'd1',
    };
    const msg = await appendMessage({ sessionId: 's1', role: 'user', content: '', attachment });

    expect(msg.attachment).toEqual(attachment);
    const insert = mocks.execute.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO chat_messages'))!;
    expect(insert[0]).toContain("'PENDING'");
    expect(insert[1]).toContain(JSON.stringify(attachment));
    // toda escrita de mensagem toca updated_at da sessão
    expect(mocks.execute.mock.calls.some(([sql]) => String(sql).includes('UPDATE chat_sessions SET updated_at'))).toBe(true);
  });

  it('listMessages devolve em ordem de created_at com attachment desserializado', async () => {
    mocks.execute.mockResolvedValueOnce(rows([
      { id: 'm1', session_id: 's1', role: 'user', content: '', source: null,
        attachment_json: JSON.stringify({ imageUri: 'file:///f.jpg', cvResult: { diseaseId: 'x', confidence: 0.9, inferenceTimeMs: 40, modelUsed: 'm' } }),
        latency_ms: null, created_at: '2026-09-12T10:00:00.000Z' },
      { id: 'm2', session_id: 's1', role: 'assistant', content: 'Olá', source: 'LOCAL_SLM',
        attachment_json: null, latency_ms: 900, created_at: '2026-09-12T10:00:01.000Z' },
    ]));

    const list = await listMessages('s1');

    expect(mocks.execute.mock.calls[0][0]).toContain('ORDER BY created_at');
    expect(list[0].attachment?.imageUri).toBe('file:///f.jpg');
    expect(list[1]).toMatchObject({ role: 'assistant', source: 'LOCAL_SLM', latencyMs: 900, attachment: null });
  });

  it('softDeleteSession marca deleted_at e volta a PENDING para sincronizar a remoção', async () => {
    await softDeleteSession('s1');
    const [sql, params] = mocks.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE chat_sessions SET deleted_at');
    expect(sql).toContain("sync_status = 'PENDING'");
    expect(params).toContain('s1');
  });

  it('getSessionDiseaseId lê o doenca_id do diagnóstico de origem', async () => {
    mocks.execute.mockResolvedValueOnce(rows([{ doenca_id: 'uuid-doenca' }]));
    expect(await getSessionDiseaseId('s1')).toBe('uuid-doenca');
    expect(mocks.execute.mock.calls[0][0]).toContain('JOIN fila_diagnosticos');
  });

  it('findUnansweredUserMessage devolve a última mensagem se for do usuário com foto', async () => {
    mocks.execute.mockResolvedValueOnce(rows([
      { id: 'm9', session_id: 's1', role: 'user', content: '', source: null,
        attachment_json: JSON.stringify({ imageUri: 'file:///f.jpg', cvResult: { diseaseId: 'x', confidence: 0.9, inferenceTimeMs: 40, modelUsed: 'm' } }),
        latency_ms: null, created_at: '2026-09-12T10:00:00.000Z' },
    ]));
    const found = await findUnansweredUserMessage('s1');
    expect(found?.id).toBe('m9');
  });

  it('findUnansweredUserMessage devolve a última mensagem se for do usuário sem foto', async () => {
    mocks.execute.mockResolvedValueOnce(rows([
      { id: 'm9', session_id: 's1', role: 'user', content: 'oi', source: null, attachment_json: null, latency_ms: null, created_at: 'z' },
    ]));
    const found = await findUnansweredUserMessage('s1');
    expect(found?.id).toBe('m9');
  });

  it('findUnansweredUserMessage devolve null se a última é do assistente', async () => {
    mocks.execute.mockResolvedValueOnce(rows([
      { id: 'm9', session_id: 's1', role: 'assistant', content: 'x', source: 'CLOUD_LLM', attachment_json: null, latency_ms: 1, created_at: 'z' },
    ]));
    expect(await findUnansweredUserMessage('s1')).toBeNull();
  });

  it('updateMessageAttachment grava o attachment serializado na mensagem', async () => {
    const attachment = {
      imageUri: 'file:///f.jpg',
      imageS3Key: 'diagnosticos/u/x.jpg',
      cvResult: { diseaseId: 'x', confidence: 0.9, inferenceTimeMs: 40, modelUsed: 'm' },
    };
    await updateMessageAttachment('m1', attachment);

    const [sql, params] = mocks.execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('UPDATE chat_messages SET attachment_json');
    expect(params).toEqual([JSON.stringify(attachment), 'm1']);
  });

  it('listMapSessions faz o join com fila_diagnosticos e exclui sessões apagadas ou sem coordenada', async () => {
    mocks.execute.mockResolvedValueOnce(rows([
      { id: 's1', title: 'Ferrugem', created_at: 'z', latitude: -12.5, longitude: -55.7,
        doenca_id: 'u', confianca_ia: 0.9, cross_validation_status: 'DIVERGENT', image_uri: 'file:///f.jpg' },
    ]));

    const pins = await listMapSessions();

    const sql = String(mocks.execute.mock.calls[0][0]);
    expect(sql).toContain('JOIN fila_diagnosticos');
    expect(sql).toContain('deleted_at IS NULL');
    expect(sql).toContain('latitude IS NOT NULL');
    expect(pins[0]).toMatchObject({ sessionId: 's1', latitude: -12.5, crossValidationStatus: 'DIVERGENT' });
  });
});

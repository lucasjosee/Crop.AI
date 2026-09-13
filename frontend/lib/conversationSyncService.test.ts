import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const sessions: any[] = [];
  const messages: any[] = [];

  const wrap = (arr: any[]) => ({
    rows: { _array: arr, length: arr.length, item: (i: number) => arr[i] },
    rowsAffected: 0,
  });

  const execute = vi.fn(async (sql: string, params: any[] = []) => {
    const s = sql.trim().replace(/\s+/g, ' ');

    if (s.includes('FROM chat_sessions')) {
      const includeFailed = s.includes("'FAILED'");
      return wrap(
        sessions.filter((sessao) => {
          const temPendente = messages.some(
            (m) => m.session_id === sessao.id && m.sync_status === 'PENDING'
          );
          if (includeFailed) {
            return ['PENDING', 'FAILED'].includes(sessao.sync_status) || temPendente;
          }
          return sessao.sync_status === 'PENDING' || (sessao.sync_status === 'SYNCED' && temPendente);
        })
      );
    }

    if (s.includes('FROM chat_messages WHERE session_id')) {
      return wrap(messages.filter((m) => m.session_id === params[0] && m.sync_status === 'PENDING'));
    }

    if (s.startsWith("UPDATE chat_sessions SET sync_status = 'SYNCED'")) {
      const sessao = sessions.find((x) => x.id === params[0]);
      if (sessao) { sessao.sync_status = 'SYNCED'; sessao.retry_count = 0; }
      return wrap([]);
    }

    if (s.startsWith('UPDATE chat_sessions SET sync_status = ?')) {
      const sessao = sessions.find((x) => x.id === params[2]);
      if (sessao) { sessao.sync_status = params[0]; sessao.retry_count = params[1]; }
      return wrap([]);
    }

    if (s.startsWith("UPDATE chat_messages SET sync_status = 'SYNCED'")) {
      for (const id of params) {
        const m = messages.find((x) => x.id === id);
        if (m) m.sync_status = 'SYNCED';
      }
      return wrap([]);
    }

    if (s.startsWith('UPDATE chat_messages SET attachment_json = ?')) {
      const m = messages.find((x) => x.id === params[1]);
      if (m) m.attachment_json = params[0];
      return wrap([]);
    }

    if (s.startsWith('UPDATE chat_sessions SET updated_at')) return wrap([]);

    return wrap([]);
  });

  return { sessions, messages, execute, upload: vi.fn(async () => 'diagnosticos/u1/foto.jpg') };
});

vi.mock('../db/sqlite', () => ({ dbDriver: { execute: mocks.execute } }));
vi.mock('./api', () => ({ api: { post: vi.fn() } }));
vi.mock('./diagnosticImageUploadService', () => ({
  ensureDiagnosticImageUploaded: mocks.upload,
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'gerado' }));

import { api } from './api';
import { syncPendingConversations, MAX_CONVERSAS_POR_LOTE } from './conversationSyncService';

function sessao(over: Record<string, unknown> = {}) {
  return {
    id: 's1',
    title: 'Ferrugem',
    origin_diagnostic_local_id: 'd1',
    created_at: '2026-09-13T08:00:00.000Z',
    updated_at: '2026-09-13T08:05:00.000Z',
    deleted_at: null,
    sync_status: 'PENDING',
    retry_count: 0,
    ...over,
  };
}

function mensagem(over: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    session_id: 's1',
    role: 'user',
    content: 'Como trato?',
    source: null,
    attachment_json: null,
    latency_ms: null,
    created_at: '2026-09-13T08:00:00.000Z',
    sync_status: 'PENDING',
    retry_count: 0,
    ...over,
  };
}

function respostaOk(sessionIds: string[]) {
  return {
    data: {
      status: 'success',
      synced_count: sessionIds.length,
      failed_count: 0,
      synced_items: sessionIds.map((id) => ({ session_id: id, server_id: `srv-${id}` })),
      failed_items: [],
    },
  };
}

describe('conversationSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessions.length = 0;
    mocks.messages.length = 0;
    mocks.upload.mockResolvedValue('diagnosticos/u1/foto.jpg');
  });

  it('monta um envelope por sessão e marca sessão e mensagens como SYNCED', async () => {
    mocks.sessions.push(sessao());
    mocks.messages.push(mensagem(), mensagem({ id: 'm2', role: 'assistant', source: 'LOCAL_SLM' }));
    vi.mocked(api.post).mockResolvedValue(respostaOk(['s1']) as never);

    const resultado = await syncPendingConversations();

    expect(resultado).toEqual({ synced: 1, failed: 0 });
    const [url, body] = vi.mocked(api.post).mock.calls[0] as [string, any];
    expect(url).toBe('/api/v1/sync/conversations');
    expect(body.conversations).toHaveLength(1);
    expect(body.conversations[0].session_id).toBe('s1');
    expect(body.conversations[0].messages).toHaveLength(2);
    expect(body.conversations[0].messages[1].source).toBe('LOCAL_SLM');
    expect(mocks.sessions[0].sync_status).toBe('SYNCED');
    expect(mocks.messages.every((m) => m.sync_status === 'SYNCED')).toBe(true);
  });

  it('leva só as mensagens novas de uma sessão já sincronizada', async () => {
    mocks.sessions.push(sessao({ sync_status: 'SYNCED' }));
    mocks.messages.push(
      mensagem({ id: 'antiga', sync_status: 'SYNCED' }),
      mensagem({ id: 'nova', content: 'E a dosagem?' })
    );
    vi.mocked(api.post).mockResolvedValue(respostaOk(['s1']) as never);

    await syncPendingConversations();

    const [, body] = vi.mocked(api.post).mock.calls[0] as [string, any];
    expect(body.conversations[0].messages).toHaveLength(1);
    expect(body.conversations[0].messages[0].message_id).toBe('nova');
  });

  it('sobe o anexo antes do POST e manda a chave, não o caminho local', async () => {
    mocks.sessions.push(sessao());
    mocks.messages.push(
      mensagem({
        attachment_json: JSON.stringify({
          imageUri: 'file:///local/foto.jpg',
          diagnosticLocalId: 'd1',
          cvResult: { diseaseId: 'x', confidence: 0.9, inferenceTimeMs: 40, modelUsed: 'm' },
        }),
      })
    );
    vi.mocked(api.post).mockResolvedValue(respostaOk(['s1']) as never);

    await syncPendingConversations();

    expect(mocks.upload).toHaveBeenCalledWith(
      expect.objectContaining({ localId: 'd1', imageUri: 'file:///local/foto.jpg' })
    );
    const ordemUpload = mocks.upload.mock.invocationCallOrder[0];
    const ordemPost = vi.mocked(api.post).mock.invocationCallOrder[0];
    expect(ordemUpload).toBeLessThan(ordemPost);

    const [, body] = vi.mocked(api.post).mock.calls[0] as [string, any];
    expect(body.conversations[0].messages[0].attachment_s3_key).toBe('diagnosticos/u1/foto.jpg');
    expect(JSON.stringify(body)).not.toContain('file:///local/foto.jpg');
    // A chave também fica gravada, para o próximo ciclo não subir de novo.
    expect(mocks.messages[0].attachment_json).toContain('diagnosticos/u1/foto.jpg');
  });

  it('anexo que não sobe deixa a conversa PENDING sem consumir tentativa', async () => {
    mocks.sessions.push(sessao());
    mocks.messages.push(
      mensagem({
        attachment_json: JSON.stringify({ imageUri: 'file:///f.jpg', diagnosticLocalId: 'd1' }),
      })
    );
    mocks.upload.mockRejectedValue(new Error('S3 fora do ar'));

    const resultado = await syncPendingConversations();

    expect(api.post).not.toHaveBeenCalled();
    expect(resultado).toEqual({ synced: 0, failed: 0 });
    expect(mocks.sessions[0].sync_status).toBe('PENDING');
    expect(mocks.sessions[0].retry_count).toBe(0);
  });

  it('failed_item incrementa a tentativa e vira FAILED no limite', async () => {
    mocks.sessions.push(sessao({ retry_count: 4 }));
    mocks.messages.push(mensagem());
    vi.mocked(api.post).mockResolvedValue({
      data: {
        status: 'partial',
        synced_count: 0,
        failed_count: 1,
        synced_items: [],
        failed_items: [{ session_id: 's1', error_code: 'VALIDATION_ERROR', message: 'x' }],
      },
    } as never);

    const resultado = await syncPendingConversations();

    expect(resultado).toEqual({ synced: 0, failed: 1 });
    expect(mocks.sessions[0].sync_status).toBe('FAILED');
    expect(mocks.sessions[0].retry_count).toBe(5);
    expect(mocks.messages[0].sync_status).toBe('PENDING');
  });

  it('sessão FAILED só entra com includeFailed', async () => {
    mocks.sessions.push(sessao({ sync_status: 'FAILED', retry_count: 5 }));
    mocks.messages.push(mensagem());
    vi.mocked(api.post).mockResolvedValue(respostaOk(['s1']) as never);

    expect(await syncPendingConversations()).toEqual({ synced: 0, failed: 0 });
    expect(api.post).not.toHaveBeenCalled();

    expect(await syncPendingConversations(true)).toEqual({ synced: 1, failed: 0 });
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('sessão apagada sem mensagem nova sobe com messages vazio', async () => {
    mocks.sessions.push(sessao({ deleted_at: '2026-09-13T11:00:00.000Z' }));
    vi.mocked(api.post).mockResolvedValue(respostaOk(['s1']) as never);

    await syncPendingConversations();

    const [, body] = vi.mocked(api.post).mock.calls[0] as [string, any];
    expect(body.conversations[0].messages).toEqual([]);
    expect(body.conversations[0].deleted_at).toBe('2026-09-13T11:00:00.000Z');
  });

  it('parte o lote em requisições de 20 conversas', async () => {
    for (let i = 0; i < 25; i++) {
      mocks.sessions.push(sessao({ id: `s${i}` }));
      mocks.messages.push(mensagem({ id: `m${i}`, session_id: `s${i}` }));
    }
    vi.mocked(api.post).mockImplementation(async (_url: string, body: any) =>
      respostaOk(body.conversations.map((c: any) => c.session_id)) as never
    );

    const resultado = await syncPendingConversations();

    expect(api.post).toHaveBeenCalledTimes(2);
    const primeiro = (vi.mocked(api.post).mock.calls[0][1] as any).conversations;
    const segundo = (vi.mocked(api.post).mock.calls[1][1] as any).conversations;
    expect(primeiro).toHaveLength(MAX_CONVERSAS_POR_LOTE);
    expect(segundo).toHaveLength(5);
    expect(resultado.synced).toBe(25);
  });

  it('sessão herdada com title vazio sobe como "Conversa"', async () => {
    // A migração v7 monta title com `?? 'Conversa'`, que não pega string
    // vazia. O servidor valida title com min(1); quem cede é o cliente.
    mocks.sessions.push(sessao({ title: '' }));
    mocks.messages.push(mensagem());
    vi.mocked(api.post).mockResolvedValue(respostaOk(['s1']) as never);

    await syncPendingConversations();

    const [, body] = vi.mocked(api.post).mock.calls[0] as [string, any];
    expect(body.conversations[0].title).toBe('Conversa');
  });
});

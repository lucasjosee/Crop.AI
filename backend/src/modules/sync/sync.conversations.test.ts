import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { app } from '../../app';
import { db } from '../../db';
import {
  usuarios, refreshTokens, culturas, doencas, diagnosticos, conversas, mensagens,
} from '../../db/schema';

const culturaId = `cultura-conv-${randomUUID()}`;
let doencaId: string;
let accessToken: string;
let userId: string;

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    message_id: randomUUID(),
    role: 'user',
    content: 'Como trato isso?',
    source: null,
    attachment_s3_key: null,
    latency_ms: null,
    created_at: '2026-09-13T08:00:00Z',
    ...overrides,
  };
}

function makeConversation(sessionId: string, overrides: Record<string, unknown> = {}) {
  return {
    session_id: sessionId,
    title: 'Ferrugem asiática',
    origin_diagnostic_local_id: null,
    created_at: '2026-09-13T08:00:00Z',
    updated_at: '2026-09-13T08:05:00Z',
    deleted_at: null,
    messages: [makeMessage()],
    ...overrides,
  };
}

async function post(payload: unknown, token = accessToken) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/sync/conversations',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    payload: payload as object,
  });
}

describe('POST /api/v1/sync/conversations (integration)', () => {
  beforeAll(async () => {
    await app.ready();
    await db.delete(refreshTokens);
    await db.delete(usuarios);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { nome: 'Conv Tester', email: 'sync-conv@test.com', password: 'senha123!' },
    });
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'sync-conv@test.com', password: 'senha123!' },
    });
    accessToken = JSON.parse(loginRes.body).access_token;
    const [user] = await db.select().from(usuarios).where(eq(usuarios.email, 'sync-conv@test.com'));
    userId = user.id;

    await db.insert(culturas).values({ id: culturaId, nome: 'Soja Conv', estagioFenologicoPadrao: [] });
    const [d] = await db
      .insert(doencas)
      .values({ idCultura: culturaId, nomeComum: 'Doenca Conv Teste', sintomas: 'manchas' })
      .returning({ id: doencas.id });
    doencaId = d.id;
  });

  afterAll(async () => {
    await db.delete(mensagens);
    await db.delete(conversas);
    await db.delete(diagnosticos);
    await db.delete(doencas).where(eq(doencas.id, doencaId));
    await db.delete(culturas).where(eq(culturas.id, culturaId));
    await db.delete(refreshTokens);
    await db.delete(usuarios);
    await app.close();
  });

  it('retorna 401 sem token', async () => {
    const res = await post({ conversations: [makeConversation(randomUUID())] }, '');
    expect(res.statusCode).toBe(401);
  });

  it('cria a conversa e suas mensagens', async () => {
    const sessionId = randomUUID();
    const res = await post({
      conversations: [
        makeConversation(sessionId, {
          messages: [
            makeMessage({ role: 'user', content: '', created_at: '2026-09-13T08:00:00Z' }),
            makeMessage({
              role: 'assistant',
              content: 'É ferrugem asiática.',
              source: 'LOCAL_SLM',
              latency_ms: 1200,
              created_at: '2026-09-13T08:00:02Z',
            }),
          ],
        }),
      ],
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('success');
    expect(body.synced_count).toBe(1);
    expect(body.synced_items[0].session_id).toBe(sessionId);

    const [conversa] = await db.select().from(conversas).where(eq(conversas.mobileSessionId, sessionId));
    expect(conversa.titulo).toBe('Ferrugem asiática');
    expect(conversa.apagadaEm).toBeNull();

    const linhas = await db.select().from(mensagens).where(eq(mensagens.conversaId, conversa.id));
    expect(linhas).toHaveLength(2);
    expect(linhas.map((m) => m.papel).sort()).toEqual(['assistant', 'user']);
    expect(linhas.find((m) => m.papel === 'assistant')?.origem).toBe('LOCAL_SLM');
  });

  it('é idempotente: reenviar a mesma conversa não duplica nada', async () => {
    const sessionId = randomUUID();
    const payload = { conversations: [makeConversation(sessionId)] };

    const first = JSON.parse((await post(payload)).body);
    const second = JSON.parse((await post(payload)).body);

    expect(second.synced_items[0].server_id).toBe(first.synced_items[0].server_id);

    const linhasConversa = await db.select().from(conversas).where(eq(conversas.mobileSessionId, sessionId));
    expect(linhasConversa).toHaveLength(1);
    const linhasMensagem = await db.select().from(mensagens).where(eq(mensagens.conversaId, linhasConversa[0].id));
    expect(linhasMensagem).toHaveLength(1);
  });

  it('acrescenta só as mensagens novas de uma conversa já sincronizada', async () => {
    const sessionId = randomUUID();
    await post({ conversations: [makeConversation(sessionId)] });

    const res = await post({
      conversations: [
        makeConversation(sessionId, {
          updated_at: '2026-09-13T09:00:00Z',
          messages: [makeMessage({ content: 'E a dosagem?', created_at: '2026-09-13T09:00:00Z' })],
        }),
      ],
    });

    expect(res.statusCode).toBe(200);
    const [conversa] = await db.select().from(conversas).where(eq(conversas.mobileSessionId, sessionId));
    const linhas = await db.select().from(mensagens).where(eq(mensagens.conversaId, conversa.id));
    expect(linhas).toHaveLength(2);
  });
});

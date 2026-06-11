import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { app } from '../../app';
import { db } from '../../db';
import { usuarios, refreshTokens, sessoesSlm, interacoesSlm } from '../../db/schema';

let accessToken: string;

describe('POST /api/v1/sync/slm-logs (integration)', () => {
  beforeAll(async () => {
    await app.ready();
    await db.delete(refreshTokens);
    await db.delete(usuarios);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { nome: 'SLM Tester', email: 'sync-slm@test.com', password: 'senha123!' },
    });
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'sync-slm@test.com', password: 'senha123!' },
    });
    accessToken = JSON.parse(loginRes.body).access_token;
  });

  afterAll(async () => {
    await db.delete(interacoesSlm);
    await db.delete(sessoesSlm);
    await db.delete(refreshTokens);
    await db.delete(usuarios);
    await app.close();
  });

  it('persiste sessão e interações (T5.5)', async () => {
    const sessionId = randomUUID();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/slm-logs',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: {
        slm_sessions: [{
          session_id: sessionId,
          started_at: '2026-06-09T14:00:00Z',
          model_version: 'gemma-2b-it-q4_k_m',
          interactions: [
            { prompt: 'Como aplico fungicida?', response: 'Recomenda-se...', latency_ms: 3200, rag_used_documents: [] },
            { prompt: 'E na chuva?', response: 'Evite aplicar...', latency_ms: 2800, rag_used_documents: [] },
          ],
        }],
      },
    });
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('success');
    expect(body.processed_count).toBe(1);

    const [session] = await db.select().from(sessoesSlm).where(eq(sessoesSlm.mobileSessionId, sessionId));
    expect(session).toBeTruthy();
    const interactions = await db.select().from(interacoesSlm).where(eq(interacoesSlm.sessaoId, session.id));
    expect(interactions).toHaveLength(2);
  });

  it('é idempotente por mobile_session_id', async () => {
    const sessionId = randomUUID();
    const payload = {
      slm_sessions: [{
        session_id: sessionId,
        started_at: '2026-06-09T15:00:00Z',
        model_version: 'gemma-2b-it-q4_k_m',
        interactions: [{ prompt: 'Oi', response: 'Olá!', latency_ms: 1000, rag_used_documents: [] }],
      }],
    };
    await app.inject({
      method: 'POST', url: '/api/v1/sync/slm-logs',
      headers: { Authorization: `Bearer ${accessToken}` }, payload,
    });
    const second = await app.inject({
      method: 'POST', url: '/api/v1/sync/slm-logs',
      headers: { Authorization: `Bearer ${accessToken}` }, payload,
    });
    expect(second.statusCode).toBe(202);

    const sessions = await db.select().from(sessoesSlm).where(eq(sessoesSlm.mobileSessionId, sessionId));
    expect(sessions).toHaveLength(1);
  });
});

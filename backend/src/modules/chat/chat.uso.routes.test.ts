// backend/src/modules/chat/chat.uso.routes.test.ts
// Integração: cota diária e registro de uso, com o provedor de LLM falso.
// Nunca chama o provedor de verdade.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('./providers/llm.provider', async (importOriginal) => {
  const original = await importOriginal<typeof import('./providers/llm.provider')>();
  const falso = {
    analyzeImage: async () => '{}',
    stream: async (
      _s: string,
      _h: unknown,
      _m: string,
      callbacks: import('./providers/llm.provider').StreamCallbacks
    ) => {
      await callbacks.onChunk('Olá');
      callbacks.onDone({ tokensEntrada: 11, tokensSaida: 7 });
    },
  };
  return { ...original, createLLMProvider: () => falso };
});

import { app } from '../../app';
import { db } from '../../db';
import { env } from '../../config/env';
import { usuarios, refreshTokens, usoLlm } from '../../db/schema';

describe('POST /api/v1/chat/stream: cota e uso (integração)', () => {
  let accessToken: string;
  let userId: string;

  const conversar = () =>
    app.inject({
      method: 'POST',
      url: '/api/v1/chat/stream',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { session_id: '00000000-0000-4000-8000-000000000099', message: 'Olá', history: [] },
    });

  beforeAll(async () => {
    await app.ready();
    await db.delete(refreshTokens);
    await db.delete(usuarios);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { nome: 'Uso Tester', email: 'uso@test.com', password: 'senha123!' },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'uso@test.com', password: 'senha123!' },
    });
    accessToken = login.json().access_token;
    userId = (await db.select().from(usuarios).where(eq(usuarios.email, 'uso@test.com')))[0].id;
  });

  afterAll(async () => {
    await db.delete(refreshTokens);
    await db.delete(usuarios); // uso_llm cai em cascata
    await app.close();
  });

  it('uma conversa concluída grava a linha de uso com os tokens medidos', async () => {
    const res = await conversar();
    expect(res.body).toContain('"tokens_used":18');

    const linhas = await db.select().from(usoLlm).where(eq(usoLlm.userId, userId));
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      tipo: 'CHAT',
      tokensEntrada: 11,
      tokensSaida: 7,
      comImagem: false,
    });
  });

  it('com a cota diária estourada, responde 429 DAILY_QUOTA_EXCEEDED sem abrir stream', async () => {
    await db.delete(usoLlm).where(eq(usoLlm.userId, userId));
    await db.insert(usoLlm).values(
      Array.from({ length: env.LLM_CHAT_DAILY_LIMIT }, () => ({
        userId,
        tipo: 'CHAT' as const,
        provedor: 'gemini',
        modelo: 'teste',
        tokensEntrada: null,
        tokensSaida: null,
      }))
    );

    const res = await conversar();

    expect(res.statusCode).toBe(429);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.json().error.code).toBe('DAILY_QUOTA_EXCEEDED');
  });
});

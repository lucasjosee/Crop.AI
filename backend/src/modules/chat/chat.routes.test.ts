// backend/src/modules/chat/chat.routes.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../app';
import { db } from '../../db';
import { usuarios, refreshTokens } from '../../db/schema';

describe('POST /api/v1/chat/stream (integration)', () => {
  let accessToken: string;

  beforeAll(async () => {
    await app.ready();
    await db.delete(refreshTokens);
    await db.delete(usuarios);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { nome: 'Chat Tester', email: 'chat@test.com', password: 'senha123!' },
    });
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'chat@test.com', password: 'senha123!' },
    });
    accessToken = JSON.parse(loginRes.body).access_token;
  });

  afterAll(async () => {
    await db.delete(refreshTokens);
    await db.delete(usuarios);
    await app.close();
  });

  it('should return 401 without token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/stream',
      payload: { session_id: '00000000-0000-0000-0000-000000000099', message: 'Olá', history: [] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('should return 400 for invalid session_id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/stream',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { session_id: 'not-a-uuid', message: 'Olá', history: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejeita com 400 o contrato antigo (campo context)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/stream',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: {
        session_id: '00000000-0000-4000-8000-000000000099',
        message: 'Olá',
        history: [],
        context: { doenca_identificada: 'Ferrugem' },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it(
    'aceita catalog_context e cv_result no contrato novo',
    async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/stream',
        headers: { Authorization: `Bearer ${accessToken}` },
        payload: {
          session_id: '00000000-0000-4000-8000-000000000099',
          message: 'Olá',
          history: [],
          catalog_context: 'Doença: Ferrugem',
          cv_result: { doenca_id: null, doenca_nome: 'Saudável', confianca: 0.97, modelo_usado: 'tflite' },
        },
      });
      expect(res.statusCode).not.toBe(400);
    },
    // Sem provider mockado, este teste chama a LLM real (rede) — o timeout
    // padrão de 5s do vitest é apertado demais e gera flakiness.
    15000
  );
});

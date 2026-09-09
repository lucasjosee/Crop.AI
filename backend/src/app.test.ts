import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Este é o arquivo que verifica a limitação, então precisa dela ligada — o
// vitest.config.ts a desliga para as demais suítes de integração.
process.env.RATE_LIMIT_ENABLED = 'true';

import { app } from './app';
import { rateLimitKeyGenerator } from './config/rate-limit';

describe('rate limiting por rota (P1.2)', () => {
  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // Os limites eram passados como `config` no app.register(), que é opção do
  // plugin e não da rota — o @fastify/rate-limit nunca os enxergava e todas as
  // rotas rodavam no global de 60/min.
  it('aplica o limite de 10/min declarado nas rotas de auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'ninguem@test.com', password: 'x' },
    });
    expect(res.headers['x-ratelimit-limit']).toBe('10');
  });

  it('aplica o limite de 30/min declarado nas rotas de sync', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/diagnostics',
      payload: { diagnostics: [] },
    });
    expect(res.headers['x-ratelimit-limit']).toBe('30');
  });

  it('aplica o limite de 20/min declarado na rota de cross-validation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/diagnosis/cross-validate',
      payload: {},
    });
    expect(res.headers['x-ratelimit-limit']).toBe('20');
  });

  // O limite não bastava estar declarado: o errorResponseBuilder devolvia um
  // objeto sem statusCode, então o excesso virava 500 genérico em vez de 429.
  it('responde 429 com código RATE_LIMITED ao exceder o limite', async () => {
    let excedida: { statusCode: number; body: string } | undefined;
    for (let i = 0; i < 15 && !excedida; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'burst@test.com', password: 'errada' },
      });
      if (res.statusCode !== 401) excedida = { statusCode: res.statusCode, body: res.body };
    }
    expect(excedida?.statusCode).toBe(429);
    expect(JSON.parse(excedida!.body).error.code).toBe('RATE_LIMITED');
  });
});

describe('chave do rate limit (P3.3)', () => {
  // Sem keyGenerator, o balde é por IP. Atrás de proxy toda a base compartilha
  // um balde; sem proxy, um usuário rotacionando IP (normal em rede móvel) não
  // tem teto por conta. Em rota autenticada a chave precisa ser o usuário.
  //
  // O rate limit roda em onRequest, antes do preHandler que popula request.user,
  // então o keyGenerator precisa validar o token ele mesmo — senão a chave por
  // usuário nunca acontece em produção.
  function requestComToken(sub: string) {
    return { jwtVerify: async () => ({ sub }), ip: '10.0.0.1' } as never;
  }

  it('usa o id do usuário autenticado como chave', async () => {
    expect(await rateLimitKeyGenerator(requestComToken('user-123'))).toBe('user:user-123');
  });

  it('separa usuários distintos vindos do mesmo IP', async () => {
    const a = await rateLimitKeyGenerator(requestComToken('user-a'));
    const b = await rateLimitKeyGenerator(requestComToken('user-b'));
    expect(a).not.toBe(b);
  });

  it('cai para o IP quando o token é ausente ou inválido', async () => {
    const semToken = {
      jwtVerify: async () => {
        throw new Error('No Authorization was found');
      },
      ip: '10.0.0.1',
    } as never;
    expect(await rateLimitKeyGenerator(semToken)).toBe('ip:10.0.0.1');
  });
});

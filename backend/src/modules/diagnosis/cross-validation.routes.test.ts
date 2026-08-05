import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env';
import { crossValidationRoutes } from './cross-validation.routes';
import { crossValidationService } from './cross-validation.service';

const payload = {
  diagnostic_local_id: '00000000-0000-4000-8000-000000000001',
  image_s3_key: 'diagnosticos/user-from-token/image.jpg',
  cv_result: {
    doenca_id: '00000000-0000-4000-8000-000000000010',
    doenca_nome: 'Ferrugem Asiática',
    confianca: 0.92,
    modelo_usado: 'tflite_v1.0',
  },
};

describe('POST /diagnosis/cross-validate (route integration)', () => {
  const app = Fastify();
  let token: string;

  beforeAll(async () => {
    await app.register(fastifyJwt, { secret: env.JWT_SECRET });
    app.setErrorHandler((error, _request, reply) => {
      if ((error as any).name === 'ZodError' || Array.isArray((error as any).issues)) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR' } });
      }
      return reply.code((error as any).statusCode ?? 500).send({
        error: { code: (error as any).code ?? 'INTERNAL_ERROR' },
      });
    });
    await app.register(crossValidationRoutes, { prefix: '/api/v1/diagnosis' });
    await app.ready();
    token = app.jwt.sign({ sub: 'user-from-token', role: 'PRODUTOR' });
  });

  afterAll(async () => app.close());

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('exige JWT', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/diagnosis/cross-validate',
      payload,
    });

    expect(response.statusCode).toBe(401);
  });

  it('usa o sub do JWT e retorna a segunda opinião mockada', async () => {
    const crossValidate = vi.spyOn(crossValidationService, 'crossValidate').mockResolvedValue({
      status: 'success',
      cross_validation: {
        result_status: 'CONFIRMED',
        llm_agrees_with_cv: true,
        llm_doenca_id: null,
        llm_doenca_nome: null,
        llm_observacoes: 'Confirmado.',
        llm_confianca: 0.9,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/diagnosis/cross-validate',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(crossValidate).toHaveBeenCalledWith('user-from-token', payload);
    expect(response.json().cross_validation.result_status).toBe('CONFIRMED');
  });

  it('rejeita user_id enviado pelo cliente', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/diagnosis/cross-validate',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...payload, user_id: 'attacker' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});

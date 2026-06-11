import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { app } from '../../app';
import { db } from '../../db';
import {
  usuarios, refreshTokens, culturas, doencas, diagnosticos, feedbacksDiagnostico,
} from '../../db/schema';

const culturaId = `cultura-test-${randomUUID()}`;
let doencaId: string;
let accessToken: string;

function makeDiagnostic(localId: string) {
  return {
    local_id: localId,
    timestamp: '2026-06-10T08:30:00Z',
    image_s3_key: `diagnosticos/test/${localId}.jpg`,
    location: { lat: -23.55052, lng: -46.633309 },
    ai_result: {
      doenca_id: doencaId,
      confianca: 0.88,
      modelo_usado: 'tflite_v1.0',
      tempo_inferencia_ms: 45,
    },
  };
}

describe('POST /api/v1/sync/diagnostics (integration)', () => {
  beforeAll(async () => {
    await app.ready();
    await db.delete(refreshTokens);
    await db.delete(usuarios);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { nome: 'Sync Tester', email: 'sync-diag@test.com', password: 'senha123!' },
    });
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'sync-diag@test.com', password: 'senha123!' },
    });
    accessToken = JSON.parse(loginRes.body).access_token;

    await db.insert(culturas).values({ id: culturaId, nome: 'Soja Teste', estagioFenologicoPadrao: [] });
    const [d] = await db
      .insert(doencas)
      .values({ idCultura: culturaId, nomeComum: 'Doenca Sync Teste', sintomas: 'manchas' })
      .returning({ id: doencas.id });
    doencaId = d.id;
  });

  afterAll(async () => {
    await db.delete(feedbacksDiagnostico);
    await db.delete(diagnosticos);
    await db.delete(doencas).where(eq(doencas.id, doencaId));
    await db.delete(culturas).where(eq(culturas.id, culturaId));
    await db.delete(refreshTokens);
    await db.delete(usuarios);
    await app.close();
  });

  it('retorna 401 sem token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/diagnostics',
      payload: { diagnostics: [makeDiagnostic(randomUUID())] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('sincroniza lote de 3 diagnósticos (T5.2)', async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/diagnostics',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { diagnostics: ids.map(makeDiagnostic) },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('success');
    expect(body.synced_count).toBe(3);
    expect(body.failed_count).toBe(0);
    expect(body.synced_items).toHaveLength(3);
    for (const item of body.synced_items) {
      expect(item.server_id).toBeTruthy();
      const [row] = await db.select().from(diagnosticos).where(eq(diagnosticos.mobileLocalId, item.local_id));
      expect(row).toBeTruthy();
      expect(row.imageS3Key).toContain(item.local_id);
    }
  });

  it('é idempotente para o mesmo local_id (T5.3)', async () => {
    const localId = randomUUID();
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/diagnostics',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { diagnostics: [makeDiagnostic(localId)] },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/diagnostics',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { diagnostics: [makeDiagnostic(localId)] },
    });
    expect(second.statusCode).toBe(200);
    const firstBody = JSON.parse(first.body);
    const secondBody = JSON.parse(second.body);
    expect(secondBody.status).toBe('success');
    expect(secondBody.synced_items[0].server_id).toBe(firstBody.synced_items[0].server_id);

    const rows = await db.select().from(diagnosticos).where(eq(diagnosticos.mobileLocalId, localId));
    expect(rows).toHaveLength(1);
  });

  it('retorna partial com INVALID_DOENCA_ID para doença inexistente', async () => {
    const bad = makeDiagnostic(randomUUID());
    bad.ai_result = { ...bad.ai_result, doenca_id: randomUUID() };
    const ok = makeDiagnostic(randomUUID());

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/diagnostics',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { diagnostics: [ok, bad] },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('partial');
    expect(body.synced_count).toBe(1);
    expect(body.failed_count).toBe(1);
    expect(body.failed_items[0].error_code).toBe('INVALID_DOENCA_ID');
  });
});

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
let userId: string;

describe('POST /api/v1/sync/feedback (integration)', () => {
  beforeAll(async () => {
    await app.ready();
    await db.delete(refreshTokens);
    await db.delete(usuarios);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { nome: 'Feedback Tester', email: 'sync-fb@test.com', password: 'senha123!' },
    });
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'sync-fb@test.com', password: 'senha123!' },
    });
    accessToken = JSON.parse(loginRes.body).access_token;
    const [user] = await db.select().from(usuarios).where(eq(usuarios.email, 'sync-fb@test.com'));
    userId = user.id;

    await db.insert(culturas).values({ id: culturaId, nome: 'Soja Teste FB', estagioFenologicoPadrao: [] });
    const [d] = await db
      .insert(doencas)
      .values({ idCultura: culturaId, nomeComum: 'Doenca FB Teste', sintomas: 'manchas' })
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

  function makeFeedback(diagnosticLocalId: string) {
    return {
      diagnostic_server_id: null,
      diagnostic_local_id: diagnosticLocalId,
      timestamp_feedback: '2026-06-10T08:35:00Z',
      is_correct: false,
      user_correction_notes: 'Não era ferrugem.',
      corrected_doenca_id: null,
    };
  }

  it('aceita feedback antes do diagnóstico como PENDING_DIAGNOSTIC (T5.4)', async () => {
    const localId = randomUUID();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/feedback',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { feedbacks: [makeFeedback(localId)] },
    });
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('success');
    expect(body.processed_count).toBe(1);
    expect(body.processed_items[0].feedback_id).toBeTruthy();

    const [row] = await db
      .select()
      .from(feedbacksDiagnostico)
      .where(eq(feedbacksDiagnostico.mobileLocalId, localId));
    expect(row.status).toBe('PENDING_DIAGNOSTIC');
    expect(row.diagnosticoId).toBeNull();

    // Quando o diagnóstico chega depois, o feedback é vinculado retroativamente
    const diagRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/diagnostics',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: {
        diagnostics: [{
          local_id: localId,
          timestamp: '2026-06-10T08:30:00Z',
          image_s3_key: `diagnosticos/${userId}/${localId}.jpg`,
          location: { lat: -23.5, lng: -46.6 },
          ai_result: { doenca_id: doencaId, confianca: 0.9, modelo_usado: 'tflite_v1.0', tempo_inferencia_ms: 40 },
        }],
      },
    });
    const serverId = JSON.parse(diagRes.body).synced_items[0].server_id;

    const [linked] = await db
      .select()
      .from(feedbacksDiagnostico)
      .where(eq(feedbacksDiagnostico.mobileLocalId, localId));
    expect(linked.status).toBe('PROCESSED');
    expect(linked.diagnosticoId).toBe(serverId);
  });

  it('vincula imediatamente quando o diagnóstico já existe', async () => {
    const localId = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/api/v1/sync/diagnostics',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: {
        diagnostics: [{
          local_id: localId,
          timestamp: '2026-06-10T08:30:00Z',
          image_s3_key: `diagnosticos/${userId}/${localId}.jpg`,
          location: { lat: -23.5, lng: -46.6 },
          ai_result: { doenca_id: doencaId, confianca: 0.9, modelo_usado: 'tflite_v1.0', tempo_inferencia_ms: 40 },
        }],
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/feedback',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { feedbacks: [makeFeedback(localId)] },
    });
    expect(res.statusCode).toBe(202);

    const [row] = await db
      .select()
      .from(feedbacksDiagnostico)
      .where(eq(feedbacksDiagnostico.mobileLocalId, localId));
    expect(row.status).toBe('PROCESSED');
    expect(row.diagnosticoId).not.toBeNull();
  });

  it('é idempotente: reenvio do mesmo feedback não duplica', async () => {
    const localId = randomUUID();
    const payload = { feedbacks: [makeFeedback(localId)] };
    const first = await app.inject({
      method: 'POST', url: '/api/v1/sync/feedback',
      headers: { Authorization: `Bearer ${accessToken}` }, payload,
    });
    const second = await app.inject({
      method: 'POST', url: '/api/v1/sync/feedback',
      headers: { Authorization: `Bearer ${accessToken}` }, payload,
    });
    expect(JSON.parse(second.body).processed_items[0].feedback_id)
      .toBe(JSON.parse(first.body).processed_items[0].feedback_id);

    const rows = await db
      .select()
      .from(feedbacksDiagnostico)
      .where(eq(feedbacksDiagnostico.mobileLocalId, localId));
    expect(rows).toHaveLength(1);
  });
});

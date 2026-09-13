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

  it('recusa anexo fora do prefixo do usuário e devolve o envelope como falha', async () => {
    const sessionId = randomUUID();
    const res = await post({
      conversations: [
        makeConversation(sessionId, {
          messages: [makeMessage({ attachment_s3_key: 'diagnosticos/outro-usuario/foto.jpg' })],
        }),
      ],
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('partial');
    expect(body.failed_items[0].error_code).toBe('INVALID_IMAGE_KEY');

    const linhas = await db.select().from(conversas).where(eq(conversas.mobileSessionId, sessionId));
    expect(linhas).toHaveLength(0);
  });

  it('aceita anexo do próprio usuário', async () => {
    const sessionId = randomUUID();
    const res = await post({
      conversations: [
        makeConversation(sessionId, {
          messages: [makeMessage({ attachment_s3_key: `diagnosticos/${userId}/foto.jpg` })],
        }),
      ],
    });

    const body = JSON.parse(res.body);
    expect(body.status).toBe('success');
    const [conversa] = await db.select().from(conversas).where(eq(conversas.mobileSessionId, sessionId));
    const [msg] = await db.select().from(mensagens).where(eq(mensagens.conversaId, conversa.id));
    expect(msg.anexoS3Key).toBe(`diagnosticos/${userId}/foto.jpg`);
  });

  it('um envelope inválido não derruba os válidos que viajam com ele', async () => {
    const bom = randomUUID();
    const res = await post({
      conversations: [
        makeConversation(bom),
        { session_id: 'nao-e-uuid', title: 'x', created_at: 'ontem', updated_at: 'ontem', messages: [] },
      ],
    });

    const body = JSON.parse(res.body);
    expect(body.status).toBe('partial');
    expect(body.synced_count).toBe(1);
    expect(body.failed_count).toBe(1);
    expect(body.failed_items[0].error_code).toBe('VALIDATION_ERROR');
    expect(body.synced_items[0].session_id).toBe(bom);
  });

  it('sessão sem mensagens novas sobe e atualiza o título', async () => {
    const sessionId = randomUUID();
    await post({ conversations: [makeConversation(sessionId)] });

    const res = await post({
      conversations: [
        makeConversation(sessionId, {
          title: 'Renomeada pelo produtor',
          updated_at: '2026-09-13T10:00:00Z',
          messages: [],
        }),
      ],
    });

    expect(JSON.parse(res.body).status).toBe('success');
    const [conversa] = await db.select().from(conversas).where(eq(conversas.mobileSessionId, sessionId));
    expect(conversa.titulo).toBe('Renomeada pelo produtor');
  });

  it('apagada_em é monotônico: nenhum reenvio ressuscita a conversa', async () => {
    const sessionId = randomUUID();
    await post({
      conversations: [makeConversation(sessionId, { deleted_at: '2026-09-13T11:00:00Z' })],
    });

    await post({
      conversations: [
        makeConversation(sessionId, { deleted_at: null, updated_at: '2026-09-13T12:00:00Z' }),
      ],
    });

    const [conversa] = await db.select().from(conversas).where(eq(conversas.mobileSessionId, sessionId));
    expect(conversa.apagadaEm).not.toBeNull();
  });

  it('updated_at mais antigo não rebobina o título', async () => {
    const sessionId = randomUUID();
    await post({
      conversations: [
        makeConversation(sessionId, { title: 'Título novo', updated_at: '2026-09-13T15:00:00Z' }),
      ],
    });

    await post({
      conversations: [
        makeConversation(sessionId, { title: 'Título velho', updated_at: '2026-09-13T09:00:00Z' }),
      ],
    });

    const [conversa] = await db.select().from(conversas).where(eq(conversas.mobileSessionId, sessionId));
    expect(conversa.titulo).toBe('Título novo');
  });

  it('religa o diagnóstico à conversa quando ele sincroniza depois', async () => {
    const sessionId = randomUUID();
    const diagnosticLocalId = randomUUID();

    // A conversa chega primeiro, sem o diagnóstico correspondente.
    await post({
      conversations: [
        makeConversation(sessionId, { origin_diagnostic_local_id: diagnosticLocalId }),
      ],
    });

    const [antes] = await db.select().from(conversas).where(eq(conversas.mobileSessionId, sessionId));
    expect(antes.diagnosticoId).toBeNull();
    expect(antes.mobileDiagnosticLocalId).toBe(diagnosticLocalId);

    await app.inject({
      method: 'POST',
      url: '/api/v1/sync/diagnostics',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: {
        diagnostics: [
          {
            local_id: diagnosticLocalId,
            timestamp: '2026-09-13T08:00:00Z',
            image_s3_key: `diagnosticos/${userId}/${diagnosticLocalId}.jpg`,
            location: { lat: -23.5, lng: -46.6 },
            ai_result: {
              doenca_id: doencaId,
              confianca: 0.9,
              modelo_usado: 'tflite_v1.0',
              tempo_inferencia_ms: 40,
            },
          },
        ],
      },
    });

    const [depois] = await db.select().from(conversas).where(eq(conversas.mobileSessionId, sessionId));
    expect(depois.diagnosticoId).not.toBeNull();
  });

  it('religa a conversa quando o diagnóstico já existia (criado pelo cross-validate) e /sync/diagnostics só o atualiza', async () => {
    const sessionId = randomUUID();
    const diagnosticLocalId = randomUUID();

    // A conversa sobe primeiro: nesse instante não existe nenhuma linha em
    // diagnosticos para esse local_id — nem o cross-validate rodou ainda.
    await post({
      conversations: [
        makeConversation(sessionId, { origin_diagnostic_local_id: diagnosticLocalId }),
      ],
    });

    const [antes] = await db.select().from(conversas).where(eq(conversas.mobileSessionId, sessionId));
    expect(antes.diagnosticoId).toBeNull();

    // O /diagnosis/cross-validate cria a linha (com onConflictDoNothing em
    // mobile_local_id) antes do /sync/diagnostics processar o item completo —
    // é isso que faz o item cair no ramo `existing`, não no de inserção.
    await db.insert(diagnosticos).values({
      userId,
      mobileLocalId: diagnosticLocalId,
      imageS3Key: `diagnosticos/${userId}/${diagnosticLocalId}.jpg`,
      latitude: null,
      longitude: null,
      doencaId,
      confiancaIa: 0.7,
      modeloUsado: 'tflite_v1.0',
      tempoInferenciaMs: 35,
      crossValidationStatus: 'PENDING',
      capturedAt: new Date('2026-09-13T07:00:00Z'),
    });

    await app.inject({
      method: 'POST',
      url: '/api/v1/sync/diagnostics',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: {
        diagnostics: [
          {
            local_id: diagnosticLocalId,
            timestamp: '2026-09-13T08:00:00Z',
            image_s3_key: `diagnosticos/${userId}/${diagnosticLocalId}.jpg`,
            location: { lat: -23.5, lng: -46.6 },
            ai_result: {
              doenca_id: doencaId,
              confianca: 0.9,
              modelo_usado: 'tflite_v1.0',
              tempo_inferencia_ms: 40,
            },
          },
        ],
      },
    });

    const [depois] = await db.select().from(conversas).where(eq(conversas.mobileSessionId, sessionId));
    expect(depois.diagnosticoId).not.toBeNull();
  });

  it('o endpoint /sync/slm-logs foi aposentado', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/slm-logs',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { slm_sessions: [] },
    });
    expect(res.statusCode).toBe(404);
  });
});

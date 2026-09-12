import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

const mocks = vi.hoisted(() => {
  class FakeEventSource {
    static instances: FakeEventSource[] = [];
    listeners: Record<string, Array<(e: unknown) => void>> = {};
    closed = false;
    constructor(public url: string, public options: { headers: Record<string, string>; body: string; method: string }) {
      FakeEventSource.instances.push(this);
    }
    addEventListener(type: string, fn: (e: unknown) => void) {
      (this.listeners[type] ??= []).push(fn);
    }
    removeAllEventListeners() {
      this.listeners = {};
    }
    close() {
      this.closed = true;
    }
    emit(type: string, event: unknown) {
      (this.listeners[type] ?? []).forEach((fn) => fn(event));
    }
    static last() {
      return FakeEventSource.instances[FakeEventSource.instances.length - 1];
    }
    static reset() {
      FakeEventSource.instances = [];
    }
  }
  return {
    FakeEventSource,
    refreshAccessToken: vi.fn(async () => 'token-novo'),
    accessToken: 'token-atual',
    ensureUploaded: vi.fn(async () => 'diagnosticos/u/foto.jpg'),
  };
});

vi.mock('react-native-sse', () => ({ default: mocks.FakeEventSource }));
vi.mock('../api', () => ({ refreshAccessToken: mocks.refreshAccessToken }));
vi.mock('../../store/useAuthStore', () => ({
  useAuthStore: { getState: () => ({ accessToken: mocks.accessToken }) },
}));
vi.mock('../diagnosticImageUploadService', () => ({ ensureDiagnosticImageUploaded: mocks.ensureUploaded }));

import { CloudEngine, CLOUD_INACTIVITY_TIMEOUT_MS } from './cloudEngine';
import { CLOUD_HISTORY_WINDOW } from './types';
import type { ChatMessage } from '../chatRepository';

const { FakeEventSource } = mocks;

function msg(i: number, source: 'LOCAL_SLM' | 'CLOUD_LLM' | null = null): ChatMessage {
  return { id: `m${i}`, sessionId: 's', role: i % 2 === 0 ? 'user' : 'assistant', content: `msg ${i}`, source, attachment: null, latencyMs: null, createdAt: `t${i}` };
}

function callbacks() {
  return { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
}

function baseInput(overrides: Partial<Parameters<CloudEngine['respond']>[0]> = {}) {
  return { sessionId: '00000000-0000-4000-8000-000000000001', history: [], userMessage: 'oi', catalogContext: 'CTX', ...overrides };
}

function bodyOf(es: InstanceType<typeof FakeEventSource>) {
  return JSON.parse(es.options.body);
}

describe('CloudEngine', () => {
  let engine: CloudEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    FakeEventSource.reset();
    engine = new CloudEngine();
  });

  afterEach(() => vi.useRealTimers());

  it('está sempre pronto e prepare/release são no-op', async () => {
    expect(engine.kind).toBe('CLOUD');
    expect(engine.isReady()).toBe(true);
    expect(await engine.prepare(() => {})).toBe(true);
    await expect(engine.release()).resolves.toBeUndefined();
  });

  it('envia o contrato novo: catalog_context, sem context antigo, com o token atual', async () => {
    engine.respond(baseInput(), callbacks(), new AbortController().signal);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    const es = FakeEventSource.last();
    expect(es.url).toContain('/api/v1/chat/stream');
    expect(es.options.method).toBe('POST');
    expect(es.options.headers.Authorization).toBe('Bearer token-atual');
    const body = bodyOf(es);
    expect(body.catalog_context).toBe('CTX');
    expect(body.message).toBe('oi');
    expect(body).not.toHaveProperty('context');
  });

  it(`recorta o histórico nas últimas ${CLOUD_HISTORY_WINDOW} mensagens`, async () => {
    const history = Array.from({ length: CLOUD_HISTORY_WINDOW + 7 }, (_, i) => msg(i));
    engine.respond(baseInput({ history }), callbacks(), new AbortController().signal);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    const body = bodyOf(FakeEventSource.last());
    expect(body.history).toHaveLength(CLOUD_HISTORY_WINDOW);
    expect(body.history[0].content).toBe('msg 7');
  });

  it('prefixa a nota de origem local quando alguma resposta anterior veio da SLM', async () => {
    const history = [msg(0), msg(1, 'LOCAL_SLM')];
    engine.respond(baseInput({ history }), callbacks(), new AbortController().signal);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    const body = bodyOf(FakeEventSource.last());
    expect(body.history[0].role).toBe('user');
    expect(body.history[0].content).toContain('modelo local compacto');
    expect(body.history).toHaveLength(3);
  });

  it('sem resposta local no histórico, não prefixa nada', async () => {
    engine.respond(baseInput({ history: [msg(0), msg(1, 'CLOUD_LLM')] }), callbacks(), new AbortController().signal);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(bodyOf(FakeEventSource.last()).history).toHaveLength(2);
  });

  it('com foto já no S3, envia image_s3_key e cv_result sem subir de novo', async () => {
    const attachment = { imageUri: 'file:///f.jpg', imageS3Key: 'diagnosticos/u/ja.jpg', diseaseName: 'Ferrugem', diagnosticLocalId: 'd1',
      cvResult: { diseaseId: 'uuid-doenca', confidence: 0.92, inferenceTimeMs: 40, modelUsed: 'tflite' } };
    engine.respond(baseInput({ attachment }), callbacks(), new AbortController().signal);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    const body = bodyOf(FakeEventSource.last());
    expect(body.image_s3_key).toBe('diagnosticos/u/ja.jpg');
    expect(body.cv_result).toEqual({ doenca_id: 'uuid-doenca', doenca_nome: 'Ferrugem', confianca: 0.92, modelo_usado: 'tflite' });
    expect(mocks.ensureUploaded).not.toHaveBeenCalled();
  });

  it('com foto sem S3, sobe a imagem antes e informa a chave no onDone', async () => {
    const attachment = { imageUri: 'file:///f.jpg', diagnosticLocalId: 'd1',
      cvResult: { diseaseId: 'Saudável', confidence: 0.97, inferenceTimeMs: 40, modelUsed: 'tflite' } };
    const cb = callbacks();
    engine.respond(baseInput({ attachment }), cb, new AbortController().signal);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    expect(mocks.ensureUploaded).toHaveBeenCalledWith({ localId: 'd1', imageUri: 'file:///f.jpg', imageS3Key: undefined });
    const body = bodyOf(FakeEventSource.last());
    expect(body.image_s3_key).toBe('diagnosticos/u/foto.jpg');
    expect(body.cv_result.doenca_id).toBeNull();
    expect(body.cv_result.doenca_nome).toBe('Saudável');

    FakeEventSource.last().emit('message', { data: JSON.stringify({ done: true, tokens_used: 12 }) });
    expect(cb.onDone).toHaveBeenCalledWith(expect.objectContaining({ imageS3Key: 'diagnosticos/u/foto.jpg', tokensUsed: 12 }));
  });

  it('repassa chunks e conclui no evento done', async () => {
    const cb = callbacks();
    engine.respond(baseInput(), cb, new AbortController().signal);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.last();

    es.emit('message', { data: JSON.stringify({ chunk: 'Olá' }) });
    es.emit('message', { data: JSON.stringify({ chunk: ' produtor' }) });
    es.emit('message', { data: JSON.stringify({ done: true, tokens_used: 5 }) });

    expect(cb.onToken).toHaveBeenNthCalledWith(1, 'Olá');
    expect(cb.onToken).toHaveBeenNthCalledWith(2, ' produtor');
    expect(cb.onDone).toHaveBeenCalledWith(expect.objectContaining({ kind: 'CLOUD', tokensUsed: 5 }));
    expect(es.closed).toBe(true);
  });

  it(`sem token por ${CLOUD_INACTIVITY_TIMEOUT_MS}ms, falha com TIMEOUT`, async () => {
    vi.useFakeTimers();
    const cb = callbacks();
    engine.respond(baseInput(), cb, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeEventSource.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(CLOUD_INACTIVITY_TIMEOUT_MS + 1);

    expect(cb.onError).toHaveBeenCalledWith('TIMEOUT');
    expect(FakeEventSource.last().closed).toBe(true);
  });

  it('cada chunk reinicia o timer de inatividade', async () => {
    vi.useFakeTimers();
    const cb = callbacks();
    engine.respond(baseInput(), cb, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    const es = FakeEventSource.last();

    await vi.advanceTimersByTimeAsync(CLOUD_INACTIVITY_TIMEOUT_MS - 100);
    es.emit('message', { data: JSON.stringify({ chunk: 'x' }) });
    await vi.advanceTimersByTimeAsync(CLOUD_INACTIVITY_TIMEOUT_MS - 100);

    expect(cb.onError).not.toHaveBeenCalled();
  });

  it.each([
    [502, 'LLM_UNAVAILABLE'],
    [503, 'LLM_UNAVAILABLE'],
    [504, 'LLM_UNAVAILABLE'],
    [429, 'RATE_LIMITED'],
    [500, 'UNKNOWN'],
  ])('HTTP %s no evento de erro vira %s', async (status, expected) => {
    const cb = callbacks();
    engine.respond(baseInput(), cb, new AbortController().signal);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    FakeEventSource.last().emit('error', { type: 'error', xhrStatus: status, message: 'x' });

    expect(cb.onError).toHaveBeenCalledWith(expected);
  });

  it('em 401 renova o token pelo mutex compartilhado e tenta uma vez mais', async () => {
    const cb = callbacks();
    engine.respond(baseInput(), cb, new AbortController().signal);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    FakeEventSource.last().emit('error', { type: 'error', xhrStatus: 401, message: 'x' });
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));

    expect(mocks.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.last().options.headers.Authorization).toBe('Bearer token-novo');
    expect(cb.onError).not.toHaveBeenCalled();
  });

  it('um segundo 401 após o refresh vira TOKEN_EXPIRED, sem novo refresh', async () => {
    const cb = callbacks();
    engine.respond(baseInput(), cb, new AbortController().signal);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    FakeEventSource.last().emit('error', { type: 'error', xhrStatus: 401, message: 'x' });
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    FakeEventSource.last().emit('error', { type: 'error', xhrStatus: 401, message: 'x' });

    expect(mocks.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(cb.onError).toHaveBeenCalledWith('TOKEN_EXPIRED');
  });

  it('erro no corpo do SSE é mapeado pelo código', async () => {
    const cb = callbacks();
    engine.respond(baseInput(), cb, new AbortController().signal);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    FakeEventSource.last().emit('message', { data: JSON.stringify({ error: { code: 'LLM_TIMEOUT', status: 504 } }) });

    expect(cb.onError).toHaveBeenCalledWith('TIMEOUT');
  });

  it('abort pelo signal fecha a conexão e reporta ABORTED', async () => {
    const controller = new AbortController();
    const cb = callbacks();
    engine.respond(baseInput(), cb, controller.signal);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    controller.abort();

    expect(FakeEventSource.last().closed).toBe(true);
    expect(cb.onError).toHaveBeenCalledWith('ABORTED');
  });
});

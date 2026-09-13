import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

const mocks = vi.hoisted(() => ({
  loadSlmModel: vi.fn(),
  slmChat: vi.fn(),
  unloadSlmModel: vi.fn(async () => {}),
}));
vi.mock('../slmChatService', () => ({
  loadSlmModel: mocks.loadSlmModel,
  slmChat: mocks.slmChat,
  unloadSlmModel: mocks.unloadSlmModel,
}));

import { LocalEngine } from './localEngine';
import { LOCAL_HISTORY_WINDOW } from './types';
import type { ChatMessage } from '../chatRepository';

function msg(i: number, role: 'user' | 'assistant' = i % 2 === 0 ? 'user' : 'assistant'): ChatMessage {
  return { id: `m${i}`, sessionId: 's', role, content: `msg ${i}`, source: null, attachment: null, latencyMs: null, createdAt: `t${i}` };
}

function callbacks() {
  return { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
}

describe('LocalEngine', () => {
  let engine: LocalEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new LocalEngine();
    mocks.slmChat.mockImplementation(async ({ onToken }: { onToken: (t: string) => void }) => {
      onToken('Olá');
      onToken(' produtor.');
      return { aborted: false };
    });
  });

  it('não está pronto antes de prepare()', () => {
    expect(engine.kind).toBe('LOCAL');
    expect(engine.isReady()).toBe(false);
  });

  it('prepare() carrega o modelo, reporta progresso e marca pronto', async () => {
    mocks.loadSlmModel.mockImplementation(async (onProgress: (p: { progress: number; loaded: boolean }) => void) => {
      onProgress({ progress: 0.5, loaded: false });
      onProgress({ progress: 1, loaded: true });
      return true;
    });
    const progress = vi.fn();

    expect(await engine.prepare(progress)).toBe(true);
    expect(engine.isReady()).toBe(true);
    expect(progress).toHaveBeenCalledWith(0.5);
    expect(progress).toHaveBeenCalledWith(1);
  });

  it('prepare() devolve false e continua não pronto se o .gguf não existe', async () => {
    mocks.loadSlmModel.mockResolvedValue(false);
    expect(await engine.prepare(() => {})).toBe(false);
    expect(engine.isReady()).toBe(false);
  });

  it('respond() sem modelo carregado devolve MODEL_NOT_LOADED sem chamar a SLM', () => {
    const cb = callbacks();
    engine.respond({ sessionId: 's', history: [], userMessage: 'oi', catalogContext: '' }, cb, new AbortController().signal);
    expect(cb.onError).toHaveBeenCalledWith('MODEL_NOT_LOADED');
    expect(mocks.slmChat).not.toHaveBeenCalled();
  });

  describe('com modelo carregado', () => {
    beforeEach(async () => {
      mocks.loadSlmModel.mockResolvedValue(true);
      await engine.prepare(() => {});
    });

    it('repassa tokens e conclui com latência', async () => {
      const cb = callbacks();
      engine.respond({ sessionId: 's', history: [], userMessage: 'oi', catalogContext: 'CTX' }, cb, new AbortController().signal);
      await vi.waitFor(() => expect(cb.onDone).toHaveBeenCalled());

      expect(cb.onToken).toHaveBeenNthCalledWith(1, 'Olá');
      expect(cb.onToken).toHaveBeenNthCalledWith(2, ' produtor.');
      expect(cb.onDone.mock.calls[0][0].latencyMs).toBeGreaterThanOrEqual(0);
      expect(cb.onDone.mock.calls[0][0].kind).toBe('LOCAL');
      expect(cb.onError).not.toHaveBeenCalled();
    });

    it(`recorta o histórico nas últimas ${LOCAL_HISTORY_WINDOW} mensagens e entrega o contexto do catálogo`, async () => {
      const history = Array.from({ length: LOCAL_HISTORY_WINDOW + 5 }, (_, i) => msg(i));
      const cb = callbacks();
      engine.respond({ sessionId: 's', history, userMessage: 'pergunta', catalogContext: 'CTX' }, cb, new AbortController().signal);
      await vi.waitFor(() => expect(cb.onDone).toHaveBeenCalled());

      const call = mocks.slmChat.mock.calls[0][0];
      expect(call.sqliteContext).toBe('CTX');
      expect(call.messages).toHaveLength(LOCAL_HISTORY_WINDOW + 1);
      expect(call.messages[0].content).toBe(`msg 5`);
      expect(call.messages.at(-1)).toEqual({ role: 'user', content: 'pergunta' });
    });

    it('com foto, prefixa a mensagem com o achado do CV e a instrução de apresentar o diagnóstico', async () => {
      const cb = callbacks();
      engine.respond(
        {
          sessionId: 's', history: [], userMessage: '', catalogContext: 'CTX',
          attachment: { imageUri: 'file:///f.jpg', diseaseName: 'Ferrugem Asiática',
            cvResult: { diseaseId: 'u', confidence: 0.92, inferenceTimeMs: 40, modelUsed: 'm' } },
        },
        cb, new AbortController().signal
      );
      await vi.waitFor(() => expect(cb.onDone).toHaveBeenCalled());

      const last = mocks.slmChat.mock.calls[0][0].messages.at(-1);
      expect(last.role).toBe('user');
      expect(last.content).toContain('Ferrugem Asiática');
      expect(last.content).toContain('92%');
      expect(last.content).toContain('Apresente o diagnóstico');
    });

    it('sem nome da doença, refere-se à doença descrita no contexto', async () => {
      const cb = callbacks();
      engine.respond(
        { sessionId: 's', history: [], userMessage: '', catalogContext: 'CTX',
          attachment: { imageUri: 'file:///f.jpg', cvResult: { diseaseId: 'u', confidence: 0.8, inferenceTimeMs: 40, modelUsed: 'm' } } },
        cb, new AbortController().signal
      );
      await vi.waitFor(() => expect(cb.onDone).toHaveBeenCalled());
      expect(mocks.slmChat.mock.calls[0][0].messages.at(-1).content).toContain('descrita no contexto');
    });

    it('abort vira ABORTED, não onDone', async () => {
      mocks.slmChat.mockResolvedValue({ aborted: true });
      const cb = callbacks();
      engine.respond({ sessionId: 's', history: [], userMessage: 'oi', catalogContext: '' }, cb, new AbortController().signal);
      await vi.waitFor(() => expect(cb.onError).toHaveBeenCalledWith('ABORTED'));
      expect(cb.onDone).not.toHaveBeenCalled();
    });

    it('erro inesperado da SLM vira UNKNOWN', async () => {
      mocks.slmChat.mockRejectedValue(new Error('boom'));
      const cb = callbacks();
      engine.respond({ sessionId: 's', history: [], userMessage: 'oi', catalogContext: '' }, cb, new AbortController().signal);
      await vi.waitFor(() => expect(cb.onError).toHaveBeenCalledWith('UNKNOWN'));
    });

    it('propaga MODEL_NOT_LOADED quando a SLM rejeita com esse erro', async () => {
      mocks.slmChat.mockRejectedValue(new Error('MODEL_NOT_LOADED'));
      const cb = callbacks();
      engine.respond({ sessionId: 's', history: [], userMessage: 'oi', catalogContext: '' }, cb, new AbortController().signal);
      await vi.waitFor(() => expect(cb.onError).toHaveBeenCalledWith('MODEL_NOT_LOADED'));
    });

    it('release() descarrega e volta a não pronto', async () => {
      await engine.release();
      expect(mocks.unloadSlmModel).toHaveBeenCalled();
      expect(engine.isReady()).toBe(false);
    });
  });
});

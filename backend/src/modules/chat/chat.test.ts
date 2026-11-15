import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatService, type ChatLogger } from './chat.service';
import { AppError } from '../../shared/errors';
import { chatStreamInputSchema } from './chat.schema';
import { LLMProvider, LLMMessage, StreamCallbacks, StreamOptions } from './providers/llm.provider';

// O serviço grava o uso no Postgres; estes testes são de unidade.
vi.mock('../uso-llm/uso-llm.repository', () => ({
  usoLlmRepository: { registrar: vi.fn(async () => {}), contarChatsDasUltimas24h: vi.fn() },
}));

// Mock LLM Provider that returns predictable chunks
class MockLLMProvider implements LLMProvider {
  lastSystemPrompt = '';
  lastOptions: StreamOptions | undefined;

  async analyzeImage(): Promise<string> {
    return '{}';
  }

  async stream(
    systemPrompt: string,
    _history: LLMMessage[],
    userMessage: string,
    callbacks: StreamCallbacks,
    opcoes?: StreamOptions
  ): Promise<void> {
    this.lastSystemPrompt = systemPrompt;
    this.lastOptions = opcoes;
    await callbacks.onChunk('Resposta ');
    await callbacks.onChunk('de teste.');
    callbacks.onDone({ tokensEntrada: 4, tokensSaida: 6 });
  }
}

const semLog = (): ChatLogger => ({ error: vi.fn(), info: vi.fn() });
const SESSAO = '00000000-0000-4000-8000-000000000001';
const USUARIO = { sub: 'user-1', role: 'PRODUTOR' };
const SEM_CALLBACKS = { onChunk: async () => {}, onDone: () => {} };

describe('ChatService', () => {
  let service: ChatService;
  let mockProvider: MockLLMProvider;

  beforeEach(() => {
    mockProvider = new MockLLMProvider();
    service = new ChatService(mockProvider);
    vi.clearAllMocks();
  });

  it('should stream chunks and call onDone', async () => {
    const chunks: string[] = [];
    let tokensUsed = 0;

    await service.stream(
      { session_id: '00000000-0000-0000-0000-000000000001', message: 'Olá', history: [] },
      { sub: 'user-123', role: 'PRODUTOR' },
      {
        onChunk: async (chunk) => { chunks.push(chunk); },
        onDone: (uso) => { tokensUsed = uso.tokensEntrada + uso.tokensSaida; },
      },
      { log: semLog() }
    );

    expect(chunks).toEqual(['Resposta ', 'de teste.']);
    expect(tokensUsed).toBe(10);
  });

  it('injeta o catalog_context pronto no prompt de sistema, sem consultar o banco', async () => {
    const provider = new MockLLMProvider();
    const service = new ChatService(provider);

    await service.stream(
      {
        session_id: '00000000-0000-4000-8000-000000000001',
        message: 'Qual a dose?',
        history: [],
        catalog_context: 'Doença: Ferrugem Asiática\nDefensivos indicados:\n1. Produto X',
      },
      { sub: 'user-1', role: 'PRODUTOR' },
      { onChunk: async () => {}, onDone: () => {} },
      { log: semLog() }
    );

    const systemPrompt = provider.lastSystemPrompt;
    expect(systemPrompt).toContain('[Contexto do Catálogo]');
    expect(systemPrompt).toContain('Doença: Ferrugem Asiática');
    expect(systemPrompt).toContain('1. Produto X');
  });

  it('com cv_result, informa ao modelo o achado da visão local', async () => {
    const provider = new MockLLMProvider();
    const service = new ChatService(provider);

    await service.stream(
      {
        session_id: '00000000-0000-4000-8000-000000000001',
        message: 'O que é isso?',
        history: [],
        catalog_context: 'Doença: Ferrugem Asiática',
        cv_result: { doenca_id: '00000000-0000-4000-8000-000000000010', doenca_nome: 'Ferrugem Asiática', confianca: 0.92, modelo_usado: 'tflite' },
      },
      { sub: 'user-1', role: 'PRODUTOR' },
      { onChunk: async () => {}, onDone: () => {} },
      { log: semLog() }
    );

    expect(provider.lastSystemPrompt).toContain('O modelo de visão local identificou Ferrugem Asiática com 92% de confiança.');
  });

  it('sem catalog_context nem cv_result, usa só o prompt base', async () => {
    const provider = new MockLLMProvider();
    const service = new ChatService(provider);

    await service.stream(
      { session_id: '00000000-0000-4000-8000-000000000001', message: 'Oi', history: [] },
      { sub: 'user-1', role: 'PRODUTOR' },
      { onChunk: async () => {}, onDone: () => {} },
      { log: semLog() }
    );

    expect(provider.lastSystemPrompt).not.toContain('[Contexto do Catálogo]');
    expect(provider.lastSystemPrompt).not.toContain('modelo de visão local');
  });
});

describe('ChatService: erro, cancelamento e teto', () => {
  const input = { session_id: SESSAO, message: 'Oi', history: [] };

  it('registra o erro do provedor e devolve LLM_UNAVAILABLE', async () => {
    const falha = new Error('API key not valid');
    const provider = new MockLLMProvider();
    provider.stream = async () => { throw falha; };
    const log = semLog();

    await expect(
      new ChatService(provider).stream(input, USUARIO, SEM_CALLBACKS, { log })
    ).rejects.toMatchObject({ statusCode: 502, code: 'LLM_UNAVAILABLE' });

    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: falha, provedor: expect.any(String), modelo: expect.any(String) }),
      expect.any(String)
    );
  });

  it('o sinal do chamador chega ao provedor, e a geração cancelada não é logada como falha', async () => {
    const chamador = new AbortController();
    const provider = new MockLLMProvider();
    provider.stream = async (_s, _h, _m, _c, opcoes) => {
      await new Promise((_, rejeita) => {
        opcoes?.signal?.addEventListener('abort', () => rejeita(new Error('abortado')));
        chamador.abort(); // o cliente sai com a geração em andamento
      });
    };
    const log = semLog();

    const promessa = new ChatService(provider).stream(input, USUARIO, SEM_CALLBACKS, {
      log,
      signal: chamador.signal,
    });

    await expect(promessa).rejects.toBeInstanceOf(AppError);
    expect(log.error).not.toHaveBeenCalled();
  });

  it('ao estourar o teto, aborta o sinal do provedor e lança LLM_TIMEOUT', async () => {
    let sinal: AbortSignal | undefined;
    const provider = new MockLLMProvider();
    provider.stream = async (_s, _h, _m, _c, opcoes) => {
      sinal = opcoes?.signal;
      await new Promise(() => {}); // nunca responde
    };

    await expect(
      new ChatService(provider, { timeoutMs: 20 }).stream(input, USUARIO, SEM_CALLBACKS, { log: semLog() })
    ).rejects.toMatchObject({ statusCode: 504, code: 'LLM_TIMEOUT' });

    expect(sinal?.aborted).toBe(true);
  });
});

describe('ChatService: foto do diagnóstico', () => {
  const comFoto = { session_id: SESSAO, message: 'O que é isso?', history: [], image_s3_key: 'diagnosticos/user-1/a.jpg' };
  const IMAGEM = { dataBase64: 'AAAA', mimeType: 'image/jpeg' as const };

  it('entrega a imagem ao provedor e avisa no prompt de sistema', async () => {
    const provider = new MockLLMProvider();
    const load = vi.fn().mockResolvedValue(IMAGEM);

    await new ChatService(provider, { imageLoader: { load } }).stream(
      comFoto, USUARIO, SEM_CALLBACKS, { log: semLog() }
    );

    expect(load).toHaveBeenCalledWith('diagnosticos/user-1/a.jpg');
    expect(provider.lastOptions?.imagem).toEqual(IMAGEM);
    expect(provider.lastSystemPrompt).toContain('foto da folha está anexada');
  });

  it('se a imagem não carrega, a conversa segue sem ela e o erro é registrado', async () => {
    const provider = new MockLLMProvider();
    const falha = new Error('S3 fora do ar');
    const log = semLog();

    await new ChatService(provider, { imageLoader: { load: vi.fn().mockRejectedValue(falha) } }).stream(
      comFoto, USUARIO, SEM_CALLBACKS, { log }
    );

    expect(provider.lastOptions?.imagem).toBeUndefined();
    expect(provider.lastSystemPrompt).not.toContain('foto da folha está anexada');
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ err: falha }), expect.any(String));
  });
});

describe('chatStreamInputSchema (contrato novo)', () => {
  const base = {
    session_id: '00000000-0000-4000-8000-000000000001',
    message: 'Olá',
    history: [],
  };

  it('aceita catalog_context e cv_result', () => {
    const parsed = chatStreamInputSchema.safeParse({
      ...base,
      catalog_context: 'Doença: Ferrugem Asiática\nDefensivos indicados:\n1. Produto X',
      cv_result: {
        doenca_id: '00000000-0000-4000-8000-000000000010',
        doenca_nome: 'Ferrugem Asiática',
        confianca: 0.92,
        modelo_usado: 'tflite_custom_vision_mobile_v1.0',
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('aceita cv_result com doenca_id nulo (Saudável / Fitotoxicidade)', () => {
    const parsed = chatStreamInputSchema.safeParse({
      ...base,
      cv_result: { doenca_id: null, doenca_nome: 'Saudável', confianca: 0.97, modelo_usado: 'tflite' },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejeita o contrato antigo com o campo context', () => {
    const parsed = chatStreamInputSchema.safeParse({
      ...base,
      context: { doenca_identificada: 'Ferrugem' },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejeita catalog_context acima de 4000 caracteres', () => {
    const parsed = chatStreamInputSchema.safeParse({ ...base, catalog_context: 'x'.repeat(4001) });
    expect(parsed.success).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatService } from './chat.service';
import { chatStreamInputSchema } from './chat.schema';
import { LLMProvider, LLMMessage, StreamCallbacks } from './providers/llm.provider';

// Mock LLM Provider that returns predictable chunks
class MockLLMProvider implements LLMProvider {
  lastSystemPrompt = '';

  async analyzeImage(): Promise<string> {
    return '{}';
  }

  async stream(
    systemPrompt: string,
    _history: LLMMessage[],
    userMessage: string,
    callbacks: StreamCallbacks
  ): Promise<void> {
    this.lastSystemPrompt = systemPrompt;
    await callbacks.onChunk('Resposta ');
    await callbacks.onChunk('de teste.');
    callbacks.onDone(10);
  }
}

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
        onDone: (tokens) => { tokensUsed = tokens; },
      }
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
      { onChunk: async () => {}, onDone: () => {} }
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
      { onChunk: async () => {}, onDone: () => {} }
    );

    expect(provider.lastSystemPrompt).toContain('O modelo de visão local identificou Ferrugem Asiática com 92% de confiança.');
  });

  it('sem catalog_context nem cv_result, usa só o prompt base', async () => {
    const provider = new MockLLMProvider();
    const service = new ChatService(provider);

    await service.stream(
      { session_id: '00000000-0000-4000-8000-000000000001', message: 'Oi', history: [] },
      { sub: 'user-1', role: 'PRODUTOR' },
      { onChunk: async () => {}, onDone: () => {} }
    );

    expect(provider.lastSystemPrompt).not.toContain('[Contexto do Catálogo]');
    expect(provider.lastSystemPrompt).not.toContain('modelo de visão local');
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

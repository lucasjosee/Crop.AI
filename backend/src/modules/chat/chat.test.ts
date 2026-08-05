import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatService } from './chat.service';
import { LLMProvider, LLMMessage, StreamCallbacks } from './providers/llm.provider';

// Mock LLM Provider that returns predictable chunks
class MockLLMProvider implements LLMProvider {
  async analyzeImage(): Promise<string> {
    return '{}';
  }

  async stream(
    _systemPrompt: string,
    _history: LLMMessage[],
    userMessage: string,
    callbacks: StreamCallbacks
  ): Promise<void> {
    await callbacks.onChunk('Resposta ');
    await callbacks.onChunk('de teste.');
    callbacks.onDone(10);
  }
}

// Mock the Drizzle db module
vi.mock('../../db', () => ({
  db: {
    query: {
      doencas: {
        findFirst: vi.fn(),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })),
  },
}));

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

  it('should build empty context when no disease in request', async () => {
    const { db } = await import('../../db');
    const chunks: string[] = [];

    await service.stream(
      { session_id: '00000000-0000-0000-0000-000000000002', message: 'Oi', history: [] },
      { sub: 'user-123', role: 'PRODUTOR' },
      {
        onChunk: async (chunk) => { chunks.push(chunk); },
        onDone: () => {},
      }
    );

    // No disease in request → findFirst should NOT be called
    expect(db.query.doencas.findFirst).not.toHaveBeenCalled();
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('should inject disease context when doenca_identificada is provided', async () => {
    const { db } = await import('../../db');
    const mockDoenca = {
      id: 'doenca-uuid-001',
      nomeComum: 'Ferrugem Asiática',
      nomeCientifico: 'Phakopsora pachyrhizi',
      sintomas: 'Pústulas na face abaxial das folhas',
      nivelSeveridade: 4,
    };

    vi.mocked(db.query.doencas.findFirst).mockResolvedValue(mockDoenca as any);
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([
            {
              nomeComercial: 'Priori Xtra',
              ingredienteAtivo: 'Azoxistrobina + Ciproconazol',
              dosagemRecomendada: '300ml/ha',
              carenciaDias: 30,
            },
          ])),
        })),
      })),
    } as any);

    const systemPromptCapture: string[] = [];
    const originalStream = mockProvider.stream.bind(mockProvider);
    mockProvider.stream = async (systemPrompt, history, userMessage, callbacks) => {
      systemPromptCapture.push(systemPrompt);
      return originalStream(systemPrompt, history, userMessage, callbacks);
    };

    await service.stream(
      {
        session_id: '00000000-0000-0000-0000-000000000003',
        message: 'Qual defensivo usar?',
        history: [],
        context: { doenca_identificada: 'Ferrugem Asiática', cultura: 'Soja', confianca_visao: 0.92 },
      },
      { sub: 'user-123', role: 'PRODUTOR' },
      {
        onChunk: async () => {},
        onDone: () => {},
      }
    );

    expect(systemPromptCapture[0]).toContain('Ferrugem Asiática');
    expect(systemPromptCapture[0]).toContain('Priori Xtra');
    expect(systemPromptCapture[0]).toContain('300ml/ha');
  });
});

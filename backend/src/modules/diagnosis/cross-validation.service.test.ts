import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LLMImageInput,
  LLMMessage,
  LLMProvider,
  StreamCallbacks,
} from '../chat/providers/llm.provider';
import type {
  CrossValidationRepository,
  PersistedDiagnostic,
} from './cross-validation.repository';
import { crossValidationInputSchema } from './cross-validation.schema';
import {
  CrossValidationService,
  type DiagnosticImageLoader,
} from './cross-validation.service';

const input = {
  diagnostic_local_id: '00000000-0000-4000-8000-000000000001',
  image_s3_key: 'diagnosticos/user-1/image.jpg',
  cv_result: {
    doenca_id: '00000000-0000-4000-8000-000000000010',
    doenca_nome: 'Ferrugem Asiática',
    confianca: 0.92,
    modelo_usado: 'tflite_v1.0',
    tempo_inferencia_ms: 45,
  },
};

function diagnostic(overrides: Record<string, unknown> = {}): PersistedDiagnostic {
  return {
    id: '00000000-0000-4000-8000-000000000100',
    userId: 'user-1',
    mobileLocalId: input.diagnostic_local_id,
    imageS3Key: input.image_s3_key,
    crossValidationStatus: 'PENDING',
    llmDoencaId: null,
    llmConfianca: null,
    llmObservacoes: null,
    ...overrides,
  } as PersistedDiagnostic;
}

class MockProvider implements LLMProvider {
  analyzeImage = vi.fn<LLMProvider['analyzeImage']>();

  async stream(
    _systemPrompt: string,
    _history: LLMMessage[],
    _userMessage: string,
    _callbacks: StreamCallbacks
  ): Promise<void> {}
}

describe('CrossValidationService', () => {
  let provider: MockProvider;
  let repository: CrossValidationRepository;
  let imageLoader: DiagnosticImageLoader;

  beforeEach(() => {
    provider = new MockProvider();
    repository = {
      findDiagnostic: vi.fn(async () => undefined),
      findDisease: vi.fn(async () => ({ id: input.cv_result.doenca_id, nome: 'Ferrugem Asiática' })),
      listActiveDiseases: vi.fn(async () => [
        { id: input.cv_result.doenca_id, nome: 'Ferrugem Asiática' },
        { id: '00000000-0000-4000-8000-000000000020', nome: 'Mancha Alvo' },
      ]),
      createPending: vi.fn(async () => diagnostic()),
      saveResult: vi.fn(async () => {}),
    };
    imageLoader = {
      load: vi.fn(async (): Promise<LLMImageInput> => ({
        dataBase64: 'aW1hZ2U=',
        mimeType: 'image/jpeg',
      })),
    };
  });

  it.each([
    ['CONFIRMED', true],
    ['ENRICHED', true],
    ['DIVERGENT', false],
  ] as const)('persiste e retorna %s', async (resultStatus, agrees) => {
    provider.analyzeImage.mockResolvedValue(JSON.stringify({
      result_status: resultStatus,
      llm_doenca_id:
        resultStatus === 'DIVERGENT'
          ? '00000000-0000-4000-8000-000000000020'
          : null,
      llm_doenca_nome: resultStatus === 'DIVERGENT' ? 'Mancha Alvo' : null,
      llm_observacoes: resultStatus === 'CONFIRMED' ? 'Diagnóstico confirmado.' : 'Observação adicional.',
      llm_confianca: 0.84,
    }));
    const service = new CrossValidationService(provider, repository, imageLoader);

    const response = await service.crossValidate('user-1', input);

    expect(response.cross_validation.result_status).toBe(resultStatus);
    expect(response.cross_validation.llm_agrees_with_cv).toBe(agrees);
    expect(repository.saveResult).toHaveBeenCalledTimes(1);
    const prompt = provider.analyzeImage.mock.calls[0][1];
    expect(prompt).toContain('Ferrugem Asiática');
    expect(prompt).toContain('0.92');
  });

  it('é idempotente quando a segunda opinião já foi persistida', async () => {
    vi.mocked(repository.findDiagnostic).mockResolvedValue(
      diagnostic({
        crossValidationStatus: 'ENRICHED',
        llmObservacoes: 'Já analisado.',
        llmConfianca: 0.8,
      })
    );
    const service = new CrossValidationService(provider, repository, imageLoader);

    const response = await service.crossValidate('user-1', input);

    expect(response.cross_validation.result_status).toBe('ENRICHED');
    expect(provider.analyzeImage).not.toHaveBeenCalled();
    expect(imageLoader.load).not.toHaveBeenCalled();
  });

  it('mapeia timeout para 504/LLM_TIMEOUT', async () => {
    provider.analyzeImage.mockImplementation(() => new Promise(() => {}));
    const service = new CrossValidationService(provider, repository, imageLoader, 1);

    await expect(service.crossValidate('user-1', input)).rejects.toMatchObject({
      statusCode: 504,
      code: 'LLM_TIMEOUT',
    });
  });

  it('mapeia falha do provider para 502/LLM_UNAVAILABLE', async () => {
    provider.analyzeImage.mockRejectedValue(new Error('provider down'));
    const service = new CrossValidationService(provider, repository, imageLoader);

    await expect(service.crossValidate('user-1', input)).rejects.toMatchObject({
      statusCode: 502,
      code: 'LLM_UNAVAILABLE',
    });
  });

  it('rejeita user_id no payload e usa apenas o usuário autenticado', () => {
    expect(() => crossValidationInputSchema.parse({ ...input, user_id: 'attacker' })).toThrow();
  });
});

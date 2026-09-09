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
      markSkipped: vi.fn(async () => {}),
    };
    imageLoader = {
      load: vi.fn(async (): Promise<LLMImageInput> => ({
        dataBase64: 'aW1hZ2U=',
        mimeType: 'image/jpeg',
      })),
    };
  });

  // P2.2 — toda falha retornava antes do saveResult, deixando PENDING, que não é
  // terminal. O cliente offline-first re-tenta, e cada ciclo custa um GetObject
  // no S3 mais uma inferência de visão paga, sem teto.
  it('marca SKIPPED quando o provedor estoura o tempo, para não re-cobrar em retry', async () => {
    provider.analyzeImage.mockImplementation(() => new Promise(() => {}));
    const service = new CrossValidationService(provider, repository, imageLoader, 10);

    await expect(service.crossValidate('user-1', input)).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
    expect(repository.markSkipped).toHaveBeenCalledWith(diagnostic().id);
  });

  it('marca SKIPPED quando o provedor devolve resposta ilegível', async () => {
    provider.analyzeImage.mockResolvedValue('isso nao e json');
    const service = new CrossValidationService(provider, repository, imageLoader);

    await expect(service.crossValidate('user-1', input)).rejects.toMatchObject({ code: 'LLM_UNAVAILABLE' });
    expect(repository.markSkipped).toHaveBeenCalledWith(diagnostic().id);
  });

  // P3.1 — a varredura primeiro-{ / último-} engolia qualquer chave em prosa
  // após o JSON. Atinge o Claude, que só é instruído em texto a responder JSON,
  // enquanto o Gemini força responseMimeType: application/json.
  it('aceita JSON em bloco cercado seguido de comentário do modelo', async () => {
    provider.analyzeImage.mockResolvedValue(
      '```json\n{"result_status":"CONFIRMED","llm_doenca_id":null,"llm_doenca_nome":null,' +
        '"llm_observacoes":"Confirmado.","llm_confianca":0.9}\n```\n\n' +
        'Obs: aplicar {dose} conforme a bula.'
    );
    const service = new CrossValidationService(provider, repository, imageLoader);

    const response = await service.crossValidate('user-1', input);

    expect(response.cross_validation.result_status).toBe('CONFIRMED');
  });

  // P3.6 — o nome não era persistido, então o retry idempotente devolvia null
  // onde a primeira chamada devolvera a string do LLM.
  it('devolve o mesmo llm_doenca_nome na repetição de um DIVERGENT fora do catálogo', async () => {
    provider.analyzeImage.mockResolvedValue(JSON.stringify({
      result_status: 'DIVERGENT',
      llm_doenca_id: null,
      llm_doenca_nome: 'Oidio Fora do Catalogo',
      llm_observacoes: 'Sintoma incompatível com o catálogo.',
      llm_confianca: 0.8,
    }));
    const service = new CrossValidationService(provider, repository, imageLoader);

    const primeira = await service.crossValidate('user-1', input);
    const persistido = (repository.saveResult as ReturnType<typeof vi.fn>).mock.calls[0][1];

    repository.findDiagnostic = vi.fn(async () =>
      diagnostic({
        crossValidationStatus: 'DIVERGENT',
        llmDoencaId: null,
        llmDoencaNome: persistido.llm_doenca_nome,
        llmObservacoes: 'Sintoma incompatível com o catálogo.',
        llmConfianca: 0.8,
      })
    );
    const repetida = await new CrossValidationService(
      provider,
      repository,
      imageLoader
    ).crossValidate('user-1', input);

    expect(repetida.cross_validation.llm_doenca_nome).toBe(
      primeira.cross_validation.llm_doenca_nome
    );
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

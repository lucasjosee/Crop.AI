import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { culturas, diagnosticos, doencas, usuarios } from '../../db/schema';
import type {
  LLMImageInput,
  LLMMessage,
  LLMProvider,
  StreamCallbacks,
} from '../chat/providers/llm.provider';
import { SyncService } from '../sync/sync.service';
import { DrizzleCrossValidationRepository } from './cross-validation.repository';
import {
  CrossValidationService,
  type DiagnosticImageLoader,
} from './cross-validation.service';

class MockProvider implements LLMProvider {
  analyzeImage = vi.fn<LLMProvider['analyzeImage']>();

  async stream(
    _systemPrompt: string,
    _history: LLMMessage[],
    _userMessage: string,
    _callbacks: StreamCallbacks
  ): Promise<void> {}
}

describe('Cross-validation persistence + offline sync compatibility (integration)', () => {
  const userId = randomUUID();
  const localId = randomUUID();
  const cvDiseaseId = randomUUID();
  const llmDiseaseId = randomUUID();
  const culturaId = `cultura-cv-${randomUUID()}`;
  const imageS3Key = `diagnosticos/${userId}/leaf.jpg`;
  const provider = new MockProvider();
  const imageLoader: DiagnosticImageLoader = {
    load: vi.fn(async (): Promise<LLMImageInput> => ({
      dataBase64: 'aW1hZ2U=',
      mimeType: 'image/jpeg',
    })),
  };

  beforeAll(async () => {
    await db.insert(usuarios).values({
      id: userId,
      email: `cross-validation-${userId}@test.invalid`,
      nome: 'Cross Validation Test',
      passwordHash: 'not-used-in-this-test',
    });
    await db.insert(culturas).values({
      id: culturaId,
      nome: 'Soja Teste CV',
      estagioFenologicoPadrao: [],
    });
    await db.insert(doencas).values([
      {
        id: cvDiseaseId,
        idCultura: culturaId,
        nomeComum: 'Ferrugem Teste',
        sintomas: 'Pústulas',
      },
      {
        id: llmDiseaseId,
        idCultura: culturaId,
        nomeComum: 'Mancha Alvo Teste',
        sintomas: 'Lesões circulares',
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(diagnosticos).where(eq(diagnosticos.mobileLocalId, localId));
    await db.delete(doencas).where(eq(doencas.id, cvDiseaseId));
    await db.delete(doencas).where(eq(doencas.id, llmDiseaseId));
    await db.delete(culturas).where(eq(culturas.id, culturaId));
    await db.delete(usuarios).where(eq(usuarios.id, userId));
  });

  it('persiste divergência idempotente e o sync posterior hidrata sem sobrescrevê-la', async () => {
    provider.analyzeImage.mockResolvedValue(JSON.stringify({
      result_status: 'DIVERGENT',
      llm_doenca_id: llmDiseaseId,
      llm_doenca_nome: 'Mancha Alvo Teste',
      llm_observacoes: 'O padrão parece mais consistente com mancha alvo.',
      llm_confianca: 0.78,
    }));
    const service = new CrossValidationService(
      provider,
      new DrizzleCrossValidationRepository(),
      imageLoader
    );
    const input = {
      diagnostic_local_id: localId,
      image_s3_key: imageS3Key,
      cv_result: {
        doenca_id: cvDiseaseId,
        doenca_nome: 'Ferrugem Teste',
        confianca: 0.91,
        modelo_usado: 'tflite_v1.0',
        tempo_inferencia_ms: 42,
      },
    };

    const first = await service.crossValidate(userId, input);
    const second = await service.crossValidate(userId, input);

    expect(first.cross_validation.result_status).toBe('DIVERGENT');
    expect(second.cross_validation.llm_doenca_nome).toBe('Mancha Alvo Teste');
    expect(provider.analyzeImage).toHaveBeenCalledTimes(1);

    await new SyncService().syncDiagnostics(userId, {
      diagnostics: [
        {
          local_id: localId,
          timestamp: '2026-07-20T12:00:00Z',
          image_s3_key: imageS3Key,
          location: { lat: -12.5422, lng: -55.7144 },
          ai_result: {
            doenca_id: cvDiseaseId,
            confianca: 0.91,
            modelo_usado: 'tflite_v1.0',
            tempo_inferencia_ms: 42,
          },
          cross_validation: {
            status: 'SKIPPED',
            llm_doenca_id: null,
            llm_confianca: null,
            llm_observacoes: null,
          },
        },
      ],
    });

    const [persisted] = await db
      .select()
      .from(diagnosticos)
      .where(eq(diagnosticos.mobileLocalId, localId));
    expect(persisted.crossValidationStatus).toBe('DIVERGENT');
    expect(persisted.llmDoencaId).toBe(llmDiseaseId);
    expect(persisted.latitude).toBe(-12.5422);
  });
});

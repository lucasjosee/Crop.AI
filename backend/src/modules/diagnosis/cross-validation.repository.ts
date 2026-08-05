import { and, eq } from 'drizzle-orm';
import { db } from '../../db';
import { diagnosticos, doencas } from '../../db/schema';
import type { CrossValidationInput, LlmCrossValidation } from './cross-validation.schema';

export type PersistedDiagnostic = typeof diagnosticos.$inferSelect;

export interface CatalogDisease {
  id: string;
  nome: string;
}

export interface CrossValidationRepository {
  findDiagnostic(userId: string, localId: string): Promise<PersistedDiagnostic | undefined>;
  findDisease(id: string): Promise<CatalogDisease | undefined>;
  listActiveDiseases(): Promise<CatalogDisease[]>;
  createPending(userId: string, input: CrossValidationInput): Promise<PersistedDiagnostic>;
  saveResult(
    diagnosticId: string,
    result: LlmCrossValidation & { llm_doenca_id: string | null }
  ): Promise<void>;
}

export class DrizzleCrossValidationRepository implements CrossValidationRepository {
  async findDiagnostic(userId: string, localId: string) {
    return db.query.diagnosticos.findFirst({
      where: and(
        eq(diagnosticos.userId, userId),
        eq(diagnosticos.mobileLocalId, localId)
      ),
    });
  }

  async findDisease(id: string) {
    const disease = await db.query.doencas.findFirst({
      where: and(eq(doencas.id, id), eq(doencas.isActive, true)),
    });
    return disease ? { id: disease.id, nome: disease.nomeComum } : undefined;
  }

  async listActiveDiseases() {
    const rows = await db
      .select({ id: doencas.id, nome: doencas.nomeComum })
      .from(doencas)
      .where(eq(doencas.isActive, true));
    return rows;
  }

  async createPending(userId: string, input: CrossValidationInput) {
    const [created] = await db
      .insert(diagnosticos)
      .values({
        userId,
        mobileLocalId: input.diagnostic_local_id,
        imageS3Key: input.image_s3_key,
        latitude: 0,
        longitude: 0,
        doencaId: input.cv_result.doenca_id,
        confiancaIa: input.cv_result.confianca,
        modeloUsado: input.cv_result.modelo_usado,
        tempoInferenciaMs: input.cv_result.tempo_inferencia_ms ?? 0,
        crossValidationStatus: 'PENDING',
        capturedAt: new Date(),
      })
      .returning();
    return created;
  }

  async saveResult(
    diagnosticId: string,
    result: LlmCrossValidation & { llm_doenca_id: string | null }
  ) {
    await db
      .update(diagnosticos)
      .set({
        llmDoencaId: result.llm_doenca_id,
        llmConfianca: result.llm_confianca,
        llmObservacoes: result.llm_observacoes,
        crossValidationStatus: result.result_status,
      })
      .where(eq(diagnosticos.id, diagnosticId));
  }
}

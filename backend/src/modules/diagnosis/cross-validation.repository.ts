import { and, eq } from 'drizzle-orm';
import { db } from '../../db';
import { diagnosticos, doencas } from '../../db/schema';
import type { CrossValidationInput, LlmCrossValidation } from './cross-validation.schema';
import { ConflictError } from '../../shared/errors';

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
  markSkipped(diagnosticId: string): Promise<void>;
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
        // Desconhecidas neste ponto; o sync preenche quando o lote offline chega.
        latitude: null,
        longitude: null,
        doencaId: input.cv_result.doenca_id,
        confiancaIa: input.cv_result.confianca,
        modeloUsado: input.cv_result.modelo_usado,
        tempoInferenciaMs: input.cv_result.tempo_inferencia_ms ?? 0,
        crossValidationStatus: 'PENDING',
        capturedAt: new Date(),
      })
      .onConflictDoNothing({ target: diagnosticos.mobileLocalId })
      .returning();

    // mobile_local_id é único globalmente, mas findDiagnostic filtra por
    // (userId, mobileLocalId). Numa corrida — duplo toque, ou retry dentro da
    // janela de 15s do LLM — os dois lookups erram e o segundo insert colide.
    // Sem isso, o 23505 cru virava 500 no lugar do 200 idempotente prometido.
    if (created) return created;

    const existing = await this.findDiagnostic(userId, input.diagnostic_local_id);
    if (!existing) {
      throw new ConflictError('O diagnóstico já está registrado para outro usuário.');
    }
    return existing;
  }

  async markSkipped(diagnosticId: string) {
    await db
      .update(diagnosticos)
      .set({ crossValidationStatus: 'SKIPPED' })
      .where(eq(diagnosticos.id, diagnosticId));
  }

  async saveResult(
    diagnosticId: string,
    result: LlmCrossValidation & { llm_doenca_id: string | null }
  ) {
    await db
      .update(diagnosticos)
      .set({
        llmDoencaId: result.llm_doenca_id,
        llmDoencaNome: result.llm_doenca_nome ?? null,
        llmConfianca: result.llm_confianca,
        llmObservacoes: result.llm_observacoes,
        crossValidationStatus: result.result_status,
      })
      .where(eq(diagnosticos.id, diagnosticId));
  }
}

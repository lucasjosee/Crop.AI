import { and, eq } from 'drizzle-orm';
import { db } from '../../db';
import {
  diagnosticos,
  doencas,
  feedbacksDiagnostico,
  sessoesSlm,
  interacoesSlm,
} from '../../db/schema';
import { SyncDiagnosticsInput, SyncFeedbackInput, SyncSlmLogsInput } from './sync.schema';

interface SyncedItem { local_id: string; server_id: string }
interface FailedItem { local_id: string; error_code: string; message: string }

export class SyncService {
  async syncDiagnostics(userId: string, input: SyncDiagnosticsInput) {
    const synced_items: SyncedItem[] = [];
    const failed_items: FailedItem[] = [];

    for (const item of input.diagnostics) {
      try {
        const existing = await db.query.diagnosticos.findFirst({
          where: eq(diagnosticos.mobileLocalId, item.local_id),
        });
        if (existing) {
          synced_items.push({ local_id: item.local_id, server_id: existing.id });
          continue;
        }

        const doenca = await db.query.doencas.findFirst({
          where: eq(doencas.id, item.ai_result.doenca_id),
        });
        if (!doenca) {
          failed_items.push({
            local_id: item.local_id,
            error_code: 'INVALID_DOENCA_ID',
            message: 'O doenca_id informado não existe no catálogo.',
          });
          continue;
        }

        const [inserted] = await db
          .insert(diagnosticos)
          .values({
            userId,
            mobileLocalId: item.local_id,
            imageS3Key: item.image_s3_key,
            latitude: item.location.lat,
            longitude: item.location.lng,
            doencaId: item.ai_result.doenca_id,
            confiancaIa: item.ai_result.confianca,
            modeloUsado: item.ai_result.modelo_usado,
            tempoInferenciaMs: item.ai_result.tempo_inferencia_ms,
            crossValidationStatus: 'SKIPPED',
            capturedAt: new Date(item.timestamp),
          })
          .returning({ id: diagnosticos.id });

        // Vincula feedbacks que chegaram antes do diagnóstico (T5.4)
        await db
          .update(feedbacksDiagnostico)
          .set({ diagnosticoId: inserted.id, status: 'PROCESSED' })
          .where(
            and(
              eq(feedbacksDiagnostico.mobileLocalId, item.local_id),
              eq(feedbacksDiagnostico.userId, userId),
              eq(feedbacksDiagnostico.status, 'PENDING_DIAGNOSTIC')
            )
          );

        synced_items.push({ local_id: item.local_id, server_id: inserted.id });
      } catch (err) {
        failed_items.push({
          local_id: item.local_id,
          error_code: 'SYNC_ITEM_ERROR',
          message: err instanceof Error ? err.message : 'Erro desconhecido ao persistir item.',
        });
      }
    }

    return {
      status: failed_items.length === 0 ? 'success' : 'partial',
      synced_count: synced_items.length,
      failed_count: failed_items.length,
      synced_items,
      failed_items,
    };
  }

  async syncFeedback(userId: string, input: SyncFeedbackInput) {
    const processed_items: Array<{ diagnostic_local_id: string; feedback_id: string }> = [];
    const failed_items: Array<{ diagnostic_local_id: string; error_code: string; message: string }> = [];

    for (const fb of input.feedbacks) {
      try {
        const existing = await db.query.feedbacksDiagnostico.findFirst({
          where: and(
            eq(feedbacksDiagnostico.userId, userId),
            eq(feedbacksDiagnostico.mobileLocalId, fb.diagnostic_local_id)
          ),
        });
        if (existing) {
          processed_items.push({ diagnostic_local_id: fb.diagnostic_local_id, feedback_id: existing.id });
          continue;
        }

        if (fb.corrected_doenca_id) {
          const doenca = await db.query.doencas.findFirst({
            where: eq(doencas.id, fb.corrected_doenca_id),
          });
          if (!doenca) {
            failed_items.push({
              diagnostic_local_id: fb.diagnostic_local_id,
              error_code: 'INVALID_DOENCA_ID',
              message: 'O corrected_doenca_id informado não existe no catálogo.',
            });
            continue;
          }
        }

        const diagnostic = await db.query.diagnosticos.findFirst({
          where: and(
            eq(diagnosticos.userId, userId),
            eq(diagnosticos.mobileLocalId, fb.diagnostic_local_id)
          ),
        });

        const [inserted] = await db
          .insert(feedbacksDiagnostico)
          .values({
            userId,
            diagnosticoId: diagnostic?.id ?? null,
            mobileLocalId: fb.diagnostic_local_id,
            status: diagnostic ? 'PROCESSED' : 'PENDING_DIAGNOSTIC',
            isCorrect: fb.is_correct,
            correctedDoencaId: fb.corrected_doenca_id ?? null,
            userCorrectionNotes: fb.user_correction_notes ?? null,
            feedbackAt: new Date(fb.timestamp_feedback),
          })
          .returning({ id: feedbacksDiagnostico.id });

        processed_items.push({ diagnostic_local_id: fb.diagnostic_local_id, feedback_id: inserted.id });
      } catch (err) {
        failed_items.push({
          diagnostic_local_id: fb.diagnostic_local_id,
          error_code: 'SYNC_ITEM_ERROR',
          message: err instanceof Error ? err.message : 'Erro desconhecido ao persistir feedback.',
        });
      }
    }

    return {
      status: failed_items.length === 0 ? 'success' : 'partial',
      processed_count: processed_items.length,
      failed_count: failed_items.length,
      processed_items,
      failed_items,
    };
  }

  async syncSlmLogs(userId: string, input: SyncSlmLogsInput) {
    let processed_count = 0;

    for (const session of input.slm_sessions) {
      const existing = await db.query.sessoesSlm.findFirst({
        where: and(
          eq(sessoesSlm.userId, userId),
          eq(sessoesSlm.mobileSessionId, session.session_id)
        ),
      });
      if (existing) {
        processed_count += 1;
        continue;
      }

      const [inserted] = await db
        .insert(sessoesSlm)
        .values({
          userId,
          mobileSessionId: session.session_id,
          modelVersion: session.model_version,
          startedAt: new Date(session.started_at),
          endedAt: new Date(session.ended_at ?? session.started_at),
        })
        .returning({ id: sessoesSlm.id });

      if (session.interactions.length > 0) {
        await db.insert(interacoesSlm).values(
          session.interactions.map((i) => ({
            sessaoId: inserted.id,
            prompt: i.prompt,
            response: i.response,
            latencyMs: i.latency_ms,
            ragUsedDocuments: i.rag_used_documents ?? [],
          }))
        );
      }
      processed_count += 1;
    }

    return { status: 'success', processed_count };
  }
}

export const syncService = new SyncService();

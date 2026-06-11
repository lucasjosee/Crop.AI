import { z } from 'zod';

export const syncDiagnosticsSchema = z.object({
  diagnostics: z
    .array(
      z.object({
        local_id: z.string().uuid(),
        timestamp: z.string(),
        image_s3_key: z.string().min(1),
        location: z.object({ lat: z.number(), lng: z.number() }),
        ai_result: z.object({
          doenca_id: z.string().uuid(),
          confianca: z.number(),
          modelo_usado: z.string().min(1),
          tempo_inferencia_ms: z.number().int(),
        }),
      })
    )
    .min(1)
    .max(50),
});

export const syncFeedbackSchema = z.object({
  feedbacks: z
    .array(
      z.object({
        diagnostic_server_id: z.string().uuid().nullable().optional(),
        diagnostic_local_id: z.string().uuid(),
        timestamp_feedback: z.string(),
        is_correct: z.boolean(),
        user_correction_notes: z.string().nullable().optional(),
        corrected_doenca_id: z.string().uuid().nullable().optional(),
      })
    )
    .min(1)
    .max(50),
});

export const syncSlmLogsSchema = z.object({
  slm_sessions: z
    .array(
      z.object({
        session_id: z.string().uuid(),
        started_at: z.string(),
        ended_at: z.string().optional(),
        model_version: z.string().min(1),
        interactions: z.array(
          z.object({
            prompt: z.string(),
            response: z.string(),
            latency_ms: z.number().int(),
            rag_used_documents: z.array(z.unknown()).default([]),
          })
        ),
      })
    )
    .min(1)
    .max(20),
});

export type SyncDiagnosticsInput = z.infer<typeof syncDiagnosticsSchema>;
export type SyncFeedbackInput = z.infer<typeof syncFeedbackSchema>;
export type SyncSlmLogsInput = z.infer<typeof syncSlmLogsSchema>;

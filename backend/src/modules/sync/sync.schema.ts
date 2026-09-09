import { z } from 'zod';

/**
 * Aceita qualquer string que o Date reconheça. Sem isso, um valor como
 * '20/07/2026 12:00' vira Invalid Date e o serializador do drizzle lança
 * RangeError, derrubando um item que já estava persistido corretamente.
 */
const parsableTimestamp = z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), {
  message: 'timestamp inválido: use um formato de data reconhecido (ISO 8601).',
});

/**
 * `doenca_id` é nulo para os diagnósticos especiais (Saudável e Fitotoxicidade),
 * que não correspondem a nenhuma doença do catálogo.
 */
export const diagnosticItemSchema = z.object({
  local_id: z.string().uuid(),
  timestamp: parsableTimestamp,
  image_s3_key: z.string().min(1),
  location: z.object({ lat: z.number(), lng: z.number() }),
  ai_result: z.object({
    doenca_id: z.string().uuid().nullable(),
    confianca: z.number(),
    modelo_usado: z.string().min(1),
    tempo_inferencia_ms: z.number().int(),
  }),
  cross_validation: z
    .object({
      status: z.enum(['PENDING', 'CONFIRMED', 'ENRICHED', 'DIVERGENT', 'SKIPPED']),
      llm_doenca_id: z.string().uuid().nullable().optional(),
      llm_confianca: z.number().min(0).max(1).nullable().optional(),
      llm_observacoes: z.string().nullable().optional(),
    })
    .optional(),
});

/**
 * O envelope valida só a forma do lote. Cada item é validado individualmente
 * dentro do serviço, para que um item malformado vire `failed_item` em vez de
 * derrubar os até 49 diagnósticos válidos que viajam com ele.
 */
export const syncDiagnosticsSchema = z.object({
  diagnostics: z.array(z.unknown()).min(1).max(50),
});

export type DiagnosticItem = z.infer<typeof diagnosticItemSchema>;

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

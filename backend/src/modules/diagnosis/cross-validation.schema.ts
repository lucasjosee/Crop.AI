import { z } from 'zod';

export const crossValidationInputSchema = z
  .object({
    diagnostic_local_id: z.string().uuid(),
    image_s3_key: z.string().min(1).max(1024),
    cv_result: z
      .object({
        doenca_id: z.string().uuid(),
        doenca_nome: z.string().min(1).max(255),
        confianca: z.number().min(0).max(1),
        modelo_usado: z.string().min(1).max(100),
        tempo_inferencia_ms: z.number().int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();

export const llmCrossValidationSchema = z
  .object({
    result_status: z.enum(['CONFIRMED', 'ENRICHED', 'DIVERGENT']),
    llm_doenca_id: z.string().uuid().nullable().optional(),
    llm_doenca_nome: z.string().max(255).nullable().optional(),
    llm_observacoes: z.string().min(1).max(8000),
    llm_confianca: z.number().min(0).max(1),
  })
  .strict();

export type CrossValidationInput = z.infer<typeof crossValidationInputSchema>;
export type LlmCrossValidation = z.infer<typeof llmCrossValidationSchema>;

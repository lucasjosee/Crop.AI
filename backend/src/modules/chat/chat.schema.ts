// backend/src/modules/chat/chat.schema.ts
import { z } from 'zod';

export const chatHistoryItemSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
});

export const cvResultSchema = z.object({
  doenca_id: z.string().uuid().nullable(),
  doenca_nome: z.string().min(1).max(255),
  confianca: z.number().min(0).max(1),
  modelo_usado: z.string().min(1).max(100),
});

/**
 * O contexto do catálogo chega pronto do cliente, construído por doenca_id.
 * O servidor deixou de montá-lo por nome — o miss era silencioso. `strict()`
 * faz o contrato antigo (campo `context`) falhar com 400 em vez de ser
 * ignorado.
 */
export const chatStreamInputSchema = z
  .object({
    session_id: z.string().uuid('session_id deve ser um UUID válido'),
    message: z.string().min(1, 'Mensagem não pode ser vazia').max(2000),
    image_s3_key: z.string().optional(),
    catalog_context: z.string().max(4000).optional(),
    cv_result: cvResultSchema.optional(),
    history: z
      .array(chatHistoryItemSchema)
      .max(20, 'Histórico não pode exceder 20 mensagens')
      .default([]),
  })
  .strict();

export type CvResultInput = z.infer<typeof cvResultSchema>;
export type ChatStreamInput = z.infer<typeof chatStreamInputSchema>;
export type ChatHistoryItem = z.infer<typeof chatHistoryItemSchema>;

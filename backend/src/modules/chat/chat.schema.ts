// backend/src/modules/chat/chat.schema.ts
import { z } from 'zod';

export const chatHistoryItemSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
});

export const chatStreamInputSchema = z.object({
  session_id: z.string().uuid('session_id deve ser um UUID válido'),
  message: z.string().min(1, 'Mensagem não pode ser vazia').max(2000),
  image_s3_key: z.string().optional(),
  context: z
    .object({
      cultura: z.string().optional(),
      doenca_identificada: z.string().optional(),
      confianca_visao: z.number().min(0).max(1).optional(),
    })
    .optional(),
  history: z
    .array(chatHistoryItemSchema)
    .max(20, 'Histórico não pode exceder 20 mensagens')
    .default([]),
});

export type ChatStreamInput = z.infer<typeof chatStreamInputSchema>;
export type ChatHistoryItem = z.infer<typeof chatHistoryItemSchema>;

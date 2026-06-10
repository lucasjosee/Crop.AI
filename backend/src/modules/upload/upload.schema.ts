import { z } from 'zod';

export const uploadUrlSchema = z.object({
  filename: z.string().min(1),
  content_type: z.enum(['image/jpeg', 'image/png']),
});

export type UploadUrlInput = z.infer<typeof uploadUrlSchema>;

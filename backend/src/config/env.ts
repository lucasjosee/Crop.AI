import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string(),
  LLM_PROVIDER: z.enum(['gemini', 'claude']).default('gemini'),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL_ID: z.string().default('gemini-1.5-pro'),
});

export const env = envSchema.parse(process.env);

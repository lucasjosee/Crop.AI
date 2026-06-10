import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load .env file from root (useful for local dev with tsx)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string(),
  LLM_PROVIDER: z.enum(['gemini', 'claude']).default('gemini'),
  LLM_API_KEY: z.string().min(1),
  // For claude: set LLM_MODEL_ID=claude-3-5-sonnet-20241022 in .env
  LLM_MODEL_ID: z.string().default('gemini-2.5-flash'),
  // S3 / MinIO (dev usa MinIO local; produção AWS S3 = trocar endpoint/keys)
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().default('plant-diagnostics'),
});

export const env = envSchema.parse(process.env);

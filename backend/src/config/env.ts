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
});

export const env = envSchema.parse(process.env);

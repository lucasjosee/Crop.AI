import { S3Client } from '@aws-sdk/client-s3';
import { env } from './env';

// MinIO em dev (endpoint custom + path style); AWS S3 real quando S3_ENDPOINT ausente
export const s3Client = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: !!env.S3_ENDPOINT,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
});

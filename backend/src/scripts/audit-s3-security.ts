import { GetPublicAccessBlockCommand } from '@aws-sdk/client-s3';
import { env } from '../config/env';
import { s3Client } from '../config/s3';

async function auditS3Security(): Promise<void> {
  const response = await s3Client.send(
    new GetPublicAccessBlockCommand({ Bucket: env.S3_BUCKET })
  );
  const config = response.PublicAccessBlockConfiguration;
  const protectedFromPublicAccess =
    config?.BlockPublicAcls === true &&
    config?.IgnorePublicAcls === true &&
    config?.BlockPublicPolicy === true &&
    config?.RestrictPublicBuckets === true;

  if (!protectedFromPublicAccess) {
    throw new Error('S3_PUBLIC_ACCESS_BLOCK_INCOMPLETE');
  }

  console.info(`Bucket ${env.S3_BUCKET}: bloqueio de acesso público confirmado.`);
}

auditS3Security().catch(() => {
  console.error('Falha na auditoria do bloqueio de acesso público do bucket S3.');
  process.exitCode = 1;
});

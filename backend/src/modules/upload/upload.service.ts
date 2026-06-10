import { randomUUID } from 'crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client } from '../../config/s3';
import { env } from '../../config/env';

const EXPIRES_IN_SECONDS = 600;

export class UploadService {
  async createUploadUrl(userId: string, contentType: 'image/jpeg' | 'image/png') {
    const ext = contentType === 'image/png' ? 'png' : 'jpg';
    const s3Key = `diagnosticos/${userId}/${randomUUID()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: s3Key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: EXPIRES_IN_SECONDS });

    return { upload_url: uploadUrl, s3_key: s3Key, expires_in: EXPIRES_IN_SECONDS };
  }
}

export const uploadService = new UploadService();

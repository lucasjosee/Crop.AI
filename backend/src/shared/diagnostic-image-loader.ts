import { GetObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../config/env';
import { s3Client } from '../config/s3';
import type { LLMImageInput } from '../modules/chat/providers/llm.provider';
import { AppError } from './errors';

export interface DiagnosticImageLoader {
  load(s3Key: string): Promise<LLMImageInput>;
}

/**
 * Teto de 10MB, o mesmo que o app valida antes de enviar. O presigned PUT não
 * consegue impor `content-length-range` (é recurso da forma POST), então o
 * tamanho do objeto é controlado pelo cliente: sem este teto, bufferizar o
 * objeto inteiro e ainda gerar um base64 ~33% maior derruba o processo.
 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export class S3DiagnosticImageLoader implements DiagnosticImageLoader {
  async load(s3Key: string): Promise<LLMImageInput> {
    try {
      const response = await s3Client.send(
        new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: s3Key })
      );
      if (typeof response.ContentLength === 'number' && response.ContentLength > MAX_IMAGE_BYTES) {
        throw new AppError(
          413,
          'IMAGE_TOO_LARGE',
          'A imagem excede o limite de 10MB.'
        );
      }
      const body = response.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
      if (!body?.transformToByteArray) throw new Error('S3 retornou uma imagem sem conteúdo.');
      const bytes = await body.transformToByteArray();
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        throw new AppError(
          413,
          'IMAGE_TOO_LARGE',
          'A imagem excede o limite de 10MB.'
        );
      }
      const mimeType = response.ContentType === 'image/png' ? 'image/png' : 'image/jpeg';
      return { dataBase64: Buffer.from(bytes).toString('base64'), mimeType };
    } catch (error: any) {
      if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) {
        throw new AppError(404, 'IMAGE_NOT_FOUND', 'A imagem informada não foi encontrada.');
      }
      if (error instanceof AppError) throw error;
      throw new AppError(502, 'IMAGE_UNAVAILABLE', 'Não foi possível carregar a imagem para análise.');
    }
  }
}

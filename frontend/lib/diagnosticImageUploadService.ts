import { Platform } from 'react-native';
import { api } from './api';
import { dbDriver } from '../db/sqlite';

export interface DiagnosticImageUploadInput {
  localId: string;
  imageUri: string;
  imageS3Key?: string | null;
}

export async function ensureDiagnosticImageUploaded(
  input: DiagnosticImageUploadInput
): Promise<string> {
  if (input.imageS3Key) return input.imageS3Key;

  const contentType = input.imageUri.toLowerCase().endsWith('.png')
    ? 'image/png'
    : 'image/jpeg';
  const filename = input.imageUri.split('/').pop() || 'diagnostico.jpg';
  const { data } = await api.post('/api/v1/upload/url', {
    filename,
    content_type: contentType,
  });

  if (Platform.OS !== 'web' && input.imageUri.startsWith('file://')) {
    const { File } = require('expo-file-system') as typeof import('expo-file-system');
    const { fetch: expoFetch } = require('expo/fetch') as typeof import('expo/fetch');
    const uploadResponse = await expoFetch(data.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: new File(input.imageUri),
    });
    if (!uploadResponse.ok) {
      throw new Error(`S3 upload failed: HTTP ${uploadResponse.status}`);
    }
  } else {
    const source = await fetch(input.imageUri);
    const blob = await source.blob();
    const uploadResponse = await fetch(data.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: blob,
    });
    if (!uploadResponse.ok) {
      throw new Error(`S3 upload failed: HTTP ${uploadResponse.status}`);
    }
  }

  await dbDriver.execute(
    'UPDATE fila_diagnosticos SET image_s3_key = ? WHERE local_id = ?;',
    [data.s3_key, input.localId]
  );
  return data.s3_key;
}

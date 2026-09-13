import { Platform } from 'react-native';
import { api } from './api';
import { dbDriver } from '../db/sqlite';

export interface DiagnosticImageUploadInput {
  localId: string;
  imageUri: string;
  imageS3Key?: string | null;
}

/**
 * A conversa e a cross-validation pedem a mesma imagem ao mesmo tempo. Sem
 * este mapa, as duas subiriam o arquivo antes de qualquer uma gravar a chave:
 * dois PUTs pagos no S3 e duas chaves, a segunda sobrescrevendo a primeira.
 */
const uploadsEmVoo = new Map<string, Promise<string>>();

export function ensureDiagnosticImageUploaded(
  input: DiagnosticImageUploadInput
): Promise<string> {
  if (input.imageS3Key) return Promise.resolve(input.imageS3Key);

  const emVoo = uploadsEmVoo.get(input.localId);
  if (emVoo) return emVoo;

  // Sem await antes do set: duas chamadas no mesmo tick precisam encontrar o
  // mapa já populado pela primeira.
  const upload = uploadDiagnosticImage(input).finally(() => {
    uploadsEmVoo.delete(input.localId);
  });
  uploadsEmVoo.set(input.localId, upload);
  return upload;
}

async function uploadDiagnosticImage(input: DiagnosticImageUploadInput): Promise<string> {
  // O mapa em voo cobre só chamadas concorrentes, e esvazia ao terminar. A
  // chave durável mora aqui: sem esta leitura, uma resposta do motor que falha
  // depois de a segunda opinião já ter subido a imagem faz o disparo
  // automático da próxima abertura subir a foto de novo — segundo PUT pago, e
  // uma chave diferente da que o servidor já registrou.
  const gravado = await dbDriver.execute(
    'SELECT image_s3_key FROM fila_diagnosticos WHERE local_id = ?;',
    [input.localId]
  );
  const chaveGravada = gravado.rows.length > 0 ? gravado.rows._array[0].image_s3_key : null;
  if (chaveGravada) return chaveGravada;

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

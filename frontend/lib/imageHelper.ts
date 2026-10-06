import { File, Paths } from 'expo-file-system';

const EXTENSAO_POR_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
};

// data:<mime>;base64,<payload> — só a variante base64 é suportada.
const DATA_URI_BASE64 = /^data:([^;,]*);base64,(.*)$/s;

/**
 * Salva uma imagem temporária na pasta persistente (documentos) do aparelho.
 *
 * Aceita dois tipos de origem: um `file://` do cache (câmera real), que é
 * copiado, e um `data:` URI em base64 (simulador de diagnóstico em __DEV__),
 * que é decodificado para um arquivo de verdade.
 *
 * Se falhar, devolve o `tempUri` original e registra a causa.
 *
 * @param tempUri URI temporária da imagem capturada ou selecionada.
 * @returns URI persistente da imagem, ou `tempUri` se não foi possível salvar.
 */
export async function saveImagePersistently(tempUri: string): Promise<string> {
  try {
    const dataUri = DATA_URI_BASE64.exec(tempUri);
    const extensao = dataUri ? (EXTENSAO_POR_MIME[dataUri[1].toLowerCase()] ?? 'jpg') : 'jpg';
    const filename = `diag_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${extensao}`;
    const destination = new File(Paths.document, filename);

    if (tempUri.startsWith('data:')) {
      if (!dataUri) {
        throw new Error('data: URI sem codificação base64 não é suportado.');
      }
      console.log(`[ImageHelper] Writing data URI to persistent path ${destination.uri}`);
      destination.create();
      destination.write(dataUri[2], { encoding: 'base64' });
    } else {
      const source = new File(tempUri);
      console.log(`[ImageHelper] Copying image from ${tempUri} to persistent path ${destination.uri}`);
      await source.copy(destination);
    }

    return destination.uri;
  } catch (erro) {
    console.error('[ImageHelper] Failed to save image persistently, returning original cache path.', erro);
    return tempUri;
  }
}

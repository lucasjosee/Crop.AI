import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/** Lado maior, em px, da foto que segue para o modelo, o card e o S3. */
export const LADO_MAXIMO_FOTO = 1600;
/** Qualidade do JPEG regravado (0 a 1). */
export const QUALIDADE_JPEG_FOTO = 0.8;

/** Mesmos valores de `Orientation` da `react-native-vision-camera`. */
export type OrientacaoDaFoto = 'up' | 'left' | 'right' | 'down';

export interface CapturaNativa {
  /** `foto.orientation`, lida antes do `dispose()`. */
  orientacao: OrientacaoDaFoto;
  /** `foto.width` e `foto.height`, lidos antes do `dispose()`. */
  larguraNativa: number;
  alturaNativa: number;
}

export interface EntradaRotacao extends CapturaNativa {
  /** O que o decodificador de imagem enxerga no arquivo. */
  larguraDecodificada: number;
  alturaDecodificada: number;
}

/**
 * Graus, no sentido horário, que endireitam a foto. O sentido positivo de
 * `rotate` na `expo-image-manipulator` é horário (tipagem `ActionRotate` e
 * `ImageManipulatorContext.rotate`). Medido no emulador em 15/11 com `'left'`:
 * o que estava à direita no visor aparece no topo do arquivo, e 90° horário
 * endireita. `'right'` (270°) segue por simetria e não foi medido.
 */
const GIRO_PARA_LEFT = 90;
const GIRO_PARA_RIGHT = 270;

/**
 * Decide a rotação sem confiar no EXIF nem desconfiar dele: se o decodificador
 * já enxerga os lados trocados em relação ao nativo, o EXIF foi aplicado.
 * Foto quadrada não distingue os dois casos e gira.
 */
export function rotacaoParaEndireitar(entrada: EntradaRotacao): 0 | 90 | 180 | 270 {
  const { orientacao, larguraNativa, alturaNativa, larguraDecodificada, alturaDecodificada } = entrada;

  if (orientacao === 'up') return 0;

  if (orientacao === 'down') {
    // 180° não troca os lados: não há como saber se o EXIF já foi aplicado.
    console.warn('[Foto] Orientação "down" informada; a foto não será girada.');
    return 0;
  }

  const ladosTrocados =
    larguraNativa !== alturaNativa &&
    larguraDecodificada === alturaNativa &&
    alturaDecodificada === larguraNativa;
  if (ladosTrocados) return 0;

  return orientacao === 'left' ? GIRO_PARA_LEFT : GIRO_PARA_RIGHT;
}

/**
 * Tamanho que leva o lado maior a `ladoMaximo`, mantendo a proporção.
 * `null` quando a imagem já cabe: nunca se amplia.
 */
export function tamanhoAlvo(
  largura: number,
  altura: number,
  ladoMaximo: number
): { width: number; height: number } | null {
  const maior = Math.max(largura, altura);
  if (maior <= ladoMaximo) return null;
  const escala = ladoMaximo / maior;
  return {
    width: Math.max(1, Math.round(largura * escala)),
    height: Math.max(1, Math.round(altura * escala)),
  };
}

/**
 * Endireita e reduz a foto numa única passada e devolve a URI do JPEG.
 *
 * As dimensões do arquivo vêm da própria `expo-image-manipulator`, com
 * `renderAsync()` e sem `saveAsync()`: é o decodificador que vai girar, e é a
 * visão dele que decide a rotação. Nada é gravado nessa leitura.
 *
 * Nunca lança: uma foto de lado ainda é melhor que nenhuma análise. Se não há
 * o que fazer (sem rotação e já dentro do teto), devolve a URI original sem
 * regravar o JPEG.
 */
export async function normalizarFoto(uri: string, captura?: CapturaNativa): Promise<string> {
  if (uri.startsWith('data:')) return uri;

  try {
    const leitura = ImageManipulator.manipulate(uri);
    let larguraDecodificada: number;
    let alturaDecodificada: number;
    try {
      const ref = await leitura.renderAsync();
      larguraDecodificada = ref.width;
      alturaDecodificada = ref.height;
      ref.release();
    } finally {
      leitura.release();
    }

    const graus = captura
      ? rotacaoParaEndireitar({ ...captura, larguraDecodificada, alturaDecodificada })
      : 0;

    // Depois de 90° ou 270°, largura e altura trocam: o alvo usa as já giradas.
    const girada = graus === 90 || graus === 270;
    const larguraFinal = girada ? alturaDecodificada : larguraDecodificada;
    const alturaFinal = girada ? larguraDecodificada : alturaDecodificada;
    const alvo = tamanhoAlvo(larguraFinal, alturaFinal, LADO_MAXIMO_FOTO);

    if (graus === 0 && !alvo) return uri;

    const contexto = ImageManipulator.manipulate(uri);
    try {
      if (graus !== 0) contexto.rotate(graus);
      if (alvo) contexto.resize(alvo);
      const ref = await contexto.renderAsync();
      try {
        const resultado = await ref.saveAsync({
          format: SaveFormat.JPEG,
          compress: QUALIDADE_JPEG_FOTO,
        });
        return resultado.uri;
      } finally {
        ref.release();
      }
    } finally {
      contexto.release();
    }
  } catch (erro) {
    console.error('[Foto] Falha ao normalizar a foto; seguindo com a original.', erro);
    return uri;
  }
}

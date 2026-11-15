import * as Location from 'expo-location';

export interface Posicao {
  latitude: number;
  longitude: number;
}

/** Quanto a captura espera por uma leitura nova antes de desistir dela. */
export const TETO_LEITURA_MS = 5000;
/** Leitura com raio de incerteza maior que isto é descartada, não guardada com ressalva. */
export const PRECISAO_MAXIMA_M = 100;
/** Idade máxima da última posição conhecida aceita como substituta. */
export const IDADE_MAXIMA_ULTIMA_MS = 120000;

const TEMPO_ESGOTADO = Symbol('tempo-esgotado');

function precisa(loc: Location.LocationObject | null): loc is Location.LocationObject {
  const precisao = loc?.coords.accuracy;
  return typeof precisao === 'number' && precisao <= PRECISAO_MAXIMA_M;
}

function paraPosicao(loc: Location.LocationObject): Posicao {
  return { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
}

/**
 * A posição de AGORA, na hora da captura, ou `null`. Nunca lança.
 *
 * Só consulta a permissão (quem pede é a montagem da câmera). Sem leitura boa
 * o resultado é `null`: o diagnóstico é gravado sem posição e não vira pino,
 * em vez de carregar uma coordenada que não é desta foto.
 */
export async function lerPosicaoDaCaptura(): Promise<Posicao | null> {
  try {
    const permissao = await Location.getForegroundPermissionsAsync();
    if (!permissao.granted) return null;
  } catch (erro) {
    console.warn('[Posição] Falha ao consultar a permissão de localização.', erro);
    return null;
  }

  let temporizador: ReturnType<typeof setTimeout> | undefined;
  try {
    const atual = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<typeof TEMPO_ESGOTADO>((resolve) => {
        temporizador = setTimeout(() => resolve(TEMPO_ESGOTADO), TETO_LEITURA_MS);
      }),
    ]);
    if (atual !== TEMPO_ESGOTADO && precisa(atual)) return paraPosicao(atual);
  } catch (erro) {
    console.warn('[Posição] Falha ao ler a posição atual.', erro);
  } finally {
    if (temporizador !== undefined) clearTimeout(temporizador);
  }

  try {
    const ultima = await Location.getLastKnownPositionAsync({
      maxAge: IDADE_MAXIMA_ULTIMA_MS,
      requiredAccuracy: PRECISAO_MAXIMA_M,
    });
    // Confere de novo: a biblioteca filtra, mas a decisão é nossa.
    if (precisa(ultima) && Date.now() - ultima.timestamp <= IDADE_MAXIMA_ULTIMA_MS) {
      return paraPosicao(ultima);
    }
  } catch (erro) {
    console.warn('[Posição] Falha ao ler a última posição conhecida.', erro);
  }
  return null;
}

import { resolveDiseaseName } from './diagnosisDetails';
import { dataRelativa } from './sessionListFormat';
import { diagnosticoIncerto } from './confianca';
import type { MapSession } from './chatRepository';
import type { ConnectionMode } from '../config/network';

export type TipoPino = 'SAUDAVEL' | 'PROBLEMA';

/**
 * O único id de classe que significa planta sadia. `Fitotoxicidade` também
 * grava `doenca_id` nulo em `fila_diagnosticos`, mas é dano químico — pintá-la
 * de verde seria mentira sobre a lavoura.
 */
const ID_SAUDAVEL = 'Saudável';

/** Quando a classe não é legível, sinalizar é mais seguro que afirmar saúde. */
const NOME_DESCONHECIDO = 'Análise sem classe registrada';

const DELTA_PONTO_UNICO = 0.01;
const MARGEM = 1.2;

export interface PinoMapa {
  sessionId: string;
  latitude: number;
  longitude: number;
  tipo: TipoPino;
  doencaNome: string;
  dataRelativa: string;
  imageUri: string | null;
}

export interface RegiaoMapa {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/** Brasil inteiro: o que mostrar quando ainda não há nenhuma análise localizada. */
export const REGIAO_PADRAO: RegiaoMapa = {
  latitude: -15.78,
  longitude: -47.93,
  latitudeDelta: 30,
  longitudeDelta: 30,
};

function lerCv(attachmentJson: string | null): { diseaseId: string | null; confianca: number | null } {
  if (!attachmentJson) return { diseaseId: null, confianca: null };
  try {
    const anexo = JSON.parse(attachmentJson) as {
      cvResult?: { diseaseId?: unknown; confidence?: unknown };
    };
    const id = anexo?.cvResult?.diseaseId;
    const confianca = anexo?.cvResult?.confidence;
    return {
      diseaseId: typeof id === 'string' ? id : null,
      confianca: typeof confianca === 'number' ? confianca : null,
    };
  } catch {
    return { diseaseId: null, confianca: null };
  }
}

/**
 * A regra de classificação, num lugar só. `Saudável` só é SAUDAVEL com
 * confiança conhecida e suficiente (ou confirmada pelo servidor): na dúvida,
 * sinalizar, nunca afirmar saúde. Confiança ilegível conta como incerta.
 */
function classificarCv(
  diseaseId: string | null,
  confianca: number | null,
  status: string | null
): TipoPino {
  if (diseaseId !== ID_SAUDAVEL) return 'PROBLEMA';
  if (confianca === null || diagnosticoIncerto(confianca, status)) return 'PROBLEMA';
  return 'SAUDAVEL';
}

/**
 * Puro. Classifica pelo `cvResult` do anexo da foto e pelo status da segunda
 * opinião. Anexo ausente ou JSON inválido caem em `PROBLEMA` — na dúvida,
 * sinalizar.
 */
export function classificarPino(attachmentJson: string | null, status: string | null = null): TipoPino {
  const { diseaseId, confianca } = lerCv(attachmentJson);
  return classificarCv(diseaseId, confianca, status);
}

export async function montarPinos(linhas: MapSession[], agora?: Date): Promise<PinoMapa[]> {
  const pinos: PinoMapa[] = [];
  for (const linha of linhas) {
    const { diseaseId, confianca } = lerCv(linha.attachmentJson);
    pinos.push({
      sessionId: linha.sessionId,
      latitude: linha.latitude,
      longitude: linha.longitude,
      tipo: classificarCv(diseaseId, confianca, linha.crossValidationStatus),
      doencaNome: diseaseId ? await resolveDiseaseName(diseaseId) : NOME_DESCONHECIDO,
      dataRelativa: dataRelativa(linha.createdAt, agora),
      imageUri: linha.imageUri,
    });
  }
  return pinos;
}

export interface ResumoMapa {
  total: number;
  problemas: number;
  saudaveis: number;
}

/**
 * Puro e síncrono: conta sem tocar no catálogo.
 *
 * É o que permite o bloco da Home custar uma consulta só. `montarPinos` resolve
 * o nome de cada doença no banco, uma consulta por linha; contagem não precisa
 * de nome nenhum.
 */
export function resumoDoMapa(linhas: MapSession[]): ResumoMapa {
  let saudaveis = 0;
  for (const linha of linhas) {
    if (classificarPino(linha.attachmentJson, linha.crossValidationStatus) === 'SAUDAVEL') saudaveis += 1;
  }
  return { total: linhas.length, problemas: linhas.length - saudaveis, saudaveis };
}

export type EstadoMapa = 'SEM_CHAVE' | 'CARREGANDO' | 'SEM_REDE' | 'MAPA';

/**
 * Se o build tem o que o mapa nativo precisa para montar.
 *
 * No Android, o Google Maps exige a chave no manifesto, e sem ela o `MapView`
 * derruba o app em vez de desenhar em branco. A chave não chega ao JS (a config
 * embutida no app é a pública, sem `android.config`), então `app.config.ts`
 * grava a bandeira `mapaAndroidConfigurado` em `extra`. Só `true` conta: um
 * build anterior ao `app.config.ts` não tem a bandeira, e na dúvida o mapa não
 * monta. No iOS, sem `provider`, o mapa é o Apple Maps, que não pede chave.
 */
export function mapaNativoConfigurado(
  plataforma: string,
  extra: { readonly [chave: string]: unknown } | undefined
): boolean {
  if (plataforma === 'ios') return true;
  if (plataforma === 'android') return extra?.mapaAndroidConfigurado === true;
  return false;
}

/**
 * Três estados de rede, e não dois.
 *
 * `PROBING` é o estado inicial de até ~7 s (2 tentativas de 2 s mais 3 s de
 * debounce, por `config/network.ts`). Nele o app **não sabe** se há rede;
 * tratá-lo como `FIELD` mostraria "o mapa precisa de conexão" a quem tem
 * internet, trocando um erro por outro.
 *
 * `SEM_CHAVE` vem antes da rede: sem a chave o mapa nunca monta, então não há
 * por que esperar a conexão.
 */
export function estadoDoMapa(modo: ConnectionMode, mapaConfigurado: boolean): EstadoMapa {
  if (!mapaConfigurado) return 'SEM_CHAVE';
  if (modo === 'PROBING') return 'CARREGANDO';
  if (modo === 'FIELD') return 'SEM_REDE';
  return 'MAPA';
}

/**
 * Enquadra todos os pinos com folga. Um ponto só, ou vários no mesmo lugar,
 * usam aproximação fixa — o retângulo que os contém teria lado zero.
 */
export function regiaoInicial(pinos: PinoMapa[]): RegiaoMapa {
  if (pinos.length === 0) return REGIAO_PADRAO;

  const lats = pinos.map((p) => p.latitude);
  const lngs = pinos.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * MARGEM, DELTA_PONTO_UNICO),
    longitudeDelta: Math.max((maxLng - minLng) * MARGEM, DELTA_PONTO_UNICO),
  };
}

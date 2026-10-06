import { resolveDiseaseName } from './diagnosisDetails';
import { dataRelativa } from './sessionListFormat';
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

function lerDiseaseId(attachmentJson: string | null): string | null {
  if (!attachmentJson) return null;
  try {
    const anexo = JSON.parse(attachmentJson) as { cvResult?: { diseaseId?: unknown } };
    const id = anexo?.cvResult?.diseaseId;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

/** A regra de classificação, num lugar só. Interna: quem usa entra por `classificarPino`. */
function classificarDiseaseId(diseaseId: string | null): TipoPino {
  return diseaseId === ID_SAUDAVEL ? 'SAUDAVEL' : 'PROBLEMA';
}

/**
 * Puro. Classifica pelo `cvResult.diseaseId` do anexo da foto.
 * Anexo ausente ou JSON inválido caem em `PROBLEMA` — na dúvida, sinalizar.
 */
export function classificarPino(attachmentJson: string | null): TipoPino {
  return classificarDiseaseId(lerDiseaseId(attachmentJson));
}

export async function montarPinos(linhas: MapSession[], agora?: Date): Promise<PinoMapa[]> {
  const pinos: PinoMapa[] = [];
  for (const linha of linhas) {
    const diseaseId = lerDiseaseId(linha.attachmentJson);
    pinos.push({
      sessionId: linha.sessionId,
      latitude: linha.latitude,
      longitude: linha.longitude,
      tipo: classificarDiseaseId(diseaseId),
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
    if (classificarPino(linha.attachmentJson) === 'SAUDAVEL') saudaveis += 1;
  }
  return { total: linhas.length, problemas: linhas.length - saudaveis, saudaveis };
}

export type EstadoMapa = 'CARREGANDO' | 'SEM_REDE' | 'MAPA';

/**
 * Três estados, e não dois.
 *
 * `PROBING` é o estado inicial de até ~7 s (2 tentativas de 2 s mais 3 s de
 * debounce, por `config/network.ts`). Nele o app **não sabe** se há rede;
 * tratá-lo como `FIELD` mostraria "o mapa precisa de conexão" a quem tem
 * internet, trocando um erro por outro.
 */
export function estadoDoMapa(modo: ConnectionMode): EstadoMapa {
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

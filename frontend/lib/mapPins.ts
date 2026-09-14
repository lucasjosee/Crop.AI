import { resolveDiseaseName } from './diagnosisDetails';
import { dataRelativa } from './sessionListFormat';
import type { MapSession } from './chatRepository';

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

export async function montarPinos(linhas: MapSession[], agora?: Date): Promise<PinoMapa[]> {
  const pinos: PinoMapa[] = [];
  for (const linha of linhas) {
    const diseaseId = lerDiseaseId(linha.attachmentJson);
    pinos.push({
      sessionId: linha.sessionId,
      latitude: linha.latitude,
      longitude: linha.longitude,
      tipo: diseaseId === ID_SAUDAVEL ? 'SAUDAVEL' : 'PROBLEMA',
      doencaNome: diseaseId ? await resolveDiseaseName(diseaseId) : NOME_DESCONHECIDO,
      dataRelativa: dataRelativa(linha.createdAt, agora),
      imageUri: linha.imageUri,
    });
  }
  return pinos;
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

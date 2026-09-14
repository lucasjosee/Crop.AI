import { dbDriver } from '../db/sqlite';
import { hasFeedback } from './diagnosisFeedbackService';
import type { ChatAttachment } from './chatRepository';
import type { CrossValidationStatus } from './crossValidationService';

/** Os dois ids que não são UUID e não existem no catálogo. */
export const SAUDAVEL_NOME = 'Planta saudável';
export const FITOTOXICIDADE_NOME = 'Fitotoxicidade';

const ESPECIAIS: Record<string, string> = {
  'Saudável': SAUDAVEL_NOME,
  'Fitotoxicidade': FITOTOXICIDADE_NOME,
};

export interface DiagnosisDoenca {
  nomeComum: string;
  nomeCientifico: string | null;
  causa: string | null;
  sintomas: string | null;
  nivelSeveridade: number;
}

export interface DiagnosisBula {
  modoDeAcao?: string;
  epocaAplicacao?: string;
  volumeCalda?: string;
  episExigidos?: string[];
  restricoesAmbientais?: string;
}

export interface DiagnosisDefensivo {
  id: string;
  nomeComercial: string;
  classe: string | null;
  ingredienteAtivo: string | null;
  grupoQuimicoFrac: string | null;
  dosagemRecomendada: string | null;
  carenciaDias: number | null;
  maxAplicacoesCiclo: number;
  /** Bula estruturada, quando bula_resumida é JSON. */
  bula: DiagnosisBula | null;
  /** O texto cru, quando não é. Some seria pior do que mostrar sem formato. */
  bulaBruta: string | null;
}

export interface DiagnosisCrossValidation {
  status: CrossValidationStatus;
  llmDoencaId: string | null;
  llmDoencaNome: string | null;
  llmConfianca: number | null;
  llmObservacoes: string | null;
}

export interface DiagnosisDetails {
  /** null nos casos especiais, que não existem no catálogo. */
  doenca: DiagnosisDoenca | null;
  defensivos: DiagnosisDefensivo[];
  crossValidation: DiagnosisCrossValidation;
  feedbackJaEnviado: boolean;
}

export interface CatalogDisease {
  id: string;
  nomeComum: string;
  /** Nulos são possíveis: só `id` e `nome_comum` são NOT NULL no schema. */
  nomeCientifico: string | null;
  sintomas: string | null;
  nivelSeveridade: number | null;
}

const SEM_VEREDITO: DiagnosisCrossValidation = {
  status: 'SKIPPED',
  llmDoencaId: null,
  llmDoencaNome: null,
  llmConfianca: null,
  llmObservacoes: null,
};

export async function resolveDiseaseName(diseaseId: string): Promise<string> {
  const especial = ESPECIAIS[diseaseId];
  if (especial) return especial;

  const res = await dbDriver.execute('SELECT nome_comum FROM doencas WHERE id = ?;', [diseaseId]);
  return res.rows.length > 0 ? String(res.rows._array[0].nome_comum) : 'Doença não catalogada';
}

function parseBula(raw: unknown): { bula: DiagnosisBula | null; bulaBruta: string | null } {
  if (typeof raw !== 'string' || raw.trim() === '') return { bula: null, bulaBruta: null };
  if (!raw.trim().startsWith('{')) return { bula: null, bulaBruta: raw };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { bula: null, bulaBruta: raw };
    return {
      bula: {
        modoDeAcao: parsed.modo_de_acao,
        epocaAplicacao: parsed.epoca_aplicacao,
        volumeCalda: parsed.volume_calda,
        episExigidos: Array.isArray(parsed.epis_exigidos) ? parsed.epis_exigidos : undefined,
        restricoesAmbientais: parsed.restricoes_ambientais,
      },
      bulaBruta: null,
    };
  } catch {
    return { bula: null, bulaBruta: raw };
  }
}

async function loadCatalogo(
  diseaseId: string
): Promise<{ doenca: DiagnosisDoenca | null; defensivos: DiagnosisDefensivo[] }> {
  if (ESPECIAIS[diseaseId]) return { doenca: null, defensivos: [] };

  const res = await dbDriver.execute(
    `SELECT d.nome_comum, d.nome_cientifico, d.causa, d.sintomas, d.nivel_severidade,
            def.id AS defensivo_id, def.nome_comercial, def.classe, def.ingrediente_ativo,
            def.grupo_quimico_frac, def.bula_resumida,
            dd.dosagem_recomendada, dd.carencia_dias, dd.max_aplicacoes_ciclo
       FROM doencas d
       LEFT JOIN doenca_defensivo dd ON dd.id_doenca = d.id
       LEFT JOIN defensivos def ON def.id = dd.id_defensivo
      WHERE d.id = ?
      ORDER BY def.nome_comercial;`,
    [diseaseId]
  );

  const linhas = res.rows._array as Array<Record<string, any>>;
  if (linhas.length === 0) return { doenca: null, defensivos: [] };

  const d = linhas[0];
  const doenca: DiagnosisDoenca = {
    nomeComum: d.nome_comum,
    nomeCientifico: d.nome_cientifico ?? null,
    causa: d.causa ?? null,
    sintomas: d.sintomas ?? null,
    nivelSeveridade: d.nivel_severidade ?? 1,
  };

  // O LEFT JOIN devolve uma linha com defensivo nulo quando a doença não tem
  // nenhum cadastrado. Filtrar aqui evita um card fantasma sem nome.
  const defensivos = linhas
    .filter((r) => r.defensivo_id)
    .map((r) => {
      const { bula, bulaBruta } = parseBula(r.bula_resumida);
      return {
        id: r.defensivo_id,
        nomeComercial: r.nome_comercial,
        classe: r.classe ?? null,
        ingredienteAtivo: r.ingrediente_ativo ?? null,
        grupoQuimicoFrac: r.grupo_quimico_frac ?? null,
        dosagemRecomendada: r.dosagem_recomendada ?? null,
        carenciaDias: r.carencia_dias ?? null,
        maxAplicacoesCiclo: r.max_aplicacoes_ciclo ?? 0,
        bula,
        bulaBruta,
      };
    });

  return { doenca, defensivos };
}

async function loadCrossValidation(localId: string): Promise<DiagnosisCrossValidation> {
  const res = await dbDriver.execute(
    `SELECT cross_validation_status, llm_doenca_id, llm_doenca_nome, llm_confianca, llm_observacoes
       FROM fila_diagnosticos WHERE local_id = ?;`,
    [localId]
  );
  if (res.rows.length === 0) return SEM_VEREDITO;

  const r = res.rows._array[0] as Record<string, any>;
  return {
    status: (r.cross_validation_status ?? 'SKIPPED') as CrossValidationStatus,
    llmDoencaId: r.llm_doenca_id ?? null,
    llmDoencaNome: r.llm_doenca_nome ?? null,
    llmConfianca: r.llm_confianca ?? null,
    llmObservacoes: r.llm_observacoes ?? null,
  };
}

/**
 * Tudo que o card mostra, numa leitura. O veredito da cross-validation vem
 * sempre de fila_diagnosticos, nunca de uma cópia no anexo: se ele mudar
 * depois, uma cópia ficaria velha.
 */
export async function loadDiagnosisDetails(attachment: ChatAttachment): Promise<DiagnosisDetails> {
  const { doenca, defensivos } = await loadCatalogo(attachment.cvResult.diseaseId);
  const localId = attachment.diagnosticLocalId;

  const crossValidation = localId ? await loadCrossValidation(localId) : SEM_VEREDITO;
  const feedbackJaEnviado = localId ? await hasFeedback(localId) : false;

  return { doenca, defensivos, crossValidation, feedbackJaEnviado };
}

/** Serve à correção do produtor (RF06) e à tela `/catalogo`; carregada sob demanda. */
export async function listCatalogDiseases(): Promise<CatalogDisease[]> {
  const res = await dbDriver.execute(
    'SELECT id, nome_comum, nome_cientifico, sintomas, nivel_severidade FROM doencas ORDER BY nome_comum;'
  );
  return (res.rows._array as Array<Record<string, any>>).map((r) => ({
    id: r.id,
    nomeComum: r.nome_comum,
    nomeCientifico: r.nome_cientifico ?? null,
    sintomas: r.sintomas ?? null,
    nivelSeveridade: r.nivel_severidade ?? null,
  }));
}

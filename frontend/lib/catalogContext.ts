import { dbDriver } from '../db/sqlite';
import { LIMIAR_CONFIANCA, diagnosticoIncerto } from './confianca';
import type { SessionDiagnosis } from './chatRepository';

/**
 * Orçamento do contexto. A SLM roda com n_ctx: 2048; precisa sobrar para o
 * prompt de sistema (~100 tokens), 10 mensagens de histórico (~600) e 512 de
 * resposta. Pior caso aqui: 3 defensivos × 2 campos de bula × 200 caracteres
 * = 1.200 de bula, mais ~500 de cabeçalho e linhas fixas ≈ 1.700 caracteres —
 * verificado por teste (≤ 2.000). Português tokeniza pior que inglês, então a
 * folga importa. A LLM aguentaria mais, mas o ponto é grounding idêntico nos
 * dois motores.
 */
export const MAX_DEFENSIVOS = 3;
export const MAX_FIELD_CHARS = 200;

const SAUDAVEL = 'Planta saudável. Nenhum tratamento necessário.';
const SAUDAVEL_INCERTO =
  'Análise inconclusiva: o modelo de visão não teve confiança suficiente para dizer que a planta está sadia. Não afirme que a planta está saudável; peça outra foto, com a folha centralizada e boa luz, ou a descrição dos sintomas.';
const FITOTOXICIDADE =
  'Dano abiótico por fitotoxicidade — não é doença. Não há defensivo indicado; avaliar histórico de aplicações recentes.';

function clip(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.length > MAX_FIELD_CHARS ? `${value.slice(0, MAX_FIELD_CHARS - 1)}…` : value;
}

function parseBula(raw: unknown): { modo_de_acao?: string; epoca_aplicacao?: string } {
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function alertaIncerto(nome: string, confianca: number): string {
  return `ATENÇÃO, diagnóstico incerto: o modelo de visão sugeriu ${nome} com ${Math.round(confianca * 100)}% de confiança, abaixo do limiar de ${Math.round(LIMIAR_CONFIANCA * 100)}%. Trate como hipótese, peça outra foto ou mais sintomas e não indique defensivo nem dosagem.`;
}

/**
 * Contexto do catálogo para os dois motores.
 *
 * `null` é conversa livre: não há diagnóstico, então o contexto é vazio. Nunca
 * afirma saúde sem base (invariante do app). Diagnóstico incerto leva o alerta
 * e não traz os defensivos, para que nem a dose chegue ao motor.
 */
export async function buildCatalogContext(diagnostico: SessionDiagnosis | null): Promise<string> {
  if (!diagnostico) return '';
  const { diseaseId } = diagnostico;
  const incerto = diagnosticoIncerto(diagnostico.confidence, diagnostico.crossValidationStatus);

  if (diseaseId === 'Saudável') return incerto ? SAUDAVEL_INCERTO : SAUDAVEL;
  if (diseaseId === 'Fitotoxicidade') {
    return incerto
      ? [alertaIncerto('Fitotoxicidade', diagnostico.confidence), FITOTOXICIDADE].join('\n')
      : FITOTOXICIDADE;
  }

  const res = await dbDriver.execute(
    `SELECT d.nome_comum, d.nome_cientifico, d.sintomas, d.nivel_severidade, d.causa,
            def.nome_comercial, def.ingrediente_ativo, def.bula_resumida,
            dd.dosagem_recomendada, dd.carencia_dias, dd.max_aplicacoes_ciclo
       FROM doencas d
       LEFT JOIN doenca_defensivo dd ON dd.id_doenca = d.id
       LEFT JOIN defensivos def ON def.id = dd.id_defensivo
      WHERE d.id = ?
      ORDER BY def.nome_comercial
      LIMIT ?;`,
    [diseaseId, MAX_DEFENSIVOS]
  );

  const rows = res.rows._array as Array<Record<string, any>>;
  if (rows.length === 0) return '';

  const d = rows[0];
  const lines: string[] = [
    ...(incerto ? [alertaIncerto(d.nome_comum, diagnostico.confidence)] : []),
    `Doença: ${d.nome_comum}${d.nome_cientifico ? ` (${d.nome_cientifico})` : ''}`,
    `Causa: ${d.causa ?? 'não informada'} · Severidade: ${d.nivel_severidade ?? '?'}/5`,
    `Sintomas: ${d.sintomas ?? ''}`,
    '',
  ];

  if (incerto) return lines.join('\n').trimEnd();

  const defensivos = rows.filter((r) => r.nome_comercial);
  if (defensivos.length === 0) {
    lines.push('Nenhum defensivo cadastrado para esta doença.');
    return lines.join('\n');
  }

  lines.push('Defensivos indicados:');
  defensivos.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.nome_comercial} (${r.ingrediente_ativo})`);
    lines.push(
      `   Dose: ${r.dosagem_recomendada} · Carência: ${r.carencia_dias} dias · Máx. ${r.max_aplicacoes_ciclo ?? 0} aplicações/ciclo`
    );
    const bula = parseBula(r.bula_resumida);
    if (bula.modo_de_acao) lines.push(`   Modo de ação: ${clip(bula.modo_de_acao)}`);
    if (bula.epoca_aplicacao) lines.push(`   Quando aplicar: ${clip(bula.epoca_aplicacao)}`);
  });

  return lines.join('\n');
}

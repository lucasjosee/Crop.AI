import { dbDriver } from '../db/sqlite';

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

export async function buildCatalogContext(diseaseId: string | null): Promise<string> {
  if (!diseaseId || diseaseId === 'Saudável') return SAUDAVEL;
  if (diseaseId === 'Fitotoxicidade') return FITOTOXICIDADE;

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
    `Doença: ${d.nome_comum}${d.nome_cientifico ? ` (${d.nome_cientifico})` : ''}`,
    `Causa: ${d.causa ?? 'não informada'} · Severidade: ${d.nivel_severidade ?? '?'}/5`,
    `Sintomas: ${d.sintomas ?? ''}`,
    '',
  ];

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

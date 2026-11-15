/**
 * Confiança do diagnóstico. Spec: especificacoes/2026-10-27-confianca-baixa-design.md.
 *
 * Invariante do app: na dúvida sobre a classe, sinalizar — nunca afirmar saúde.
 * O limiar mora aqui, num lugar só, para que a prioridade da segunda opinião e
 * a regra de "diagnóstico incerto" não divirjam.
 */
export const LIMIAR_CONFIANCA = 0.7;

/**
 * Incerto: o CV ficou abaixo do limiar e o servidor não confirmou. Só o
 * servidor produz veredito terminal, e `CONFIRMED`/`ENRICHED` são duas opiniões
 * independentes concordando. `DIVERGENT`, `PENDING` e `SKIPPED` não tiram a
 * incerteza.
 */
export function diagnosticoIncerto(confianca: number, status: string | null): boolean {
  return confianca < LIMIAR_CONFIANCA && status !== 'CONFIRMED' && status !== 'ENRICHED';
}

/**
 * Título da conversa na criação. O status ainda é `PENDING` ou `SKIPPED`, então
 * só a confiança decide. Abaixo do limiar, não afirma o que não sabe.
 */
export function tituloDaAnalise(diseaseId: string, diseaseName: string, confianca: number): string {
  if (confianca >= LIMIAR_CONFIANCA) return diseaseName;
  return diseaseId === 'Saudável' ? 'Análise inconclusiva' : `Possível ${diseaseName}`;
}

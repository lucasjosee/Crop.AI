// A lógica da tela `/catalogo`, fora da tela para poder ter teste — o padrão
// que o sub-projeto 5 estabeleceu, já que o projeto não testa tela.
import type { CatalogDisease } from './diagnosisDetails';

/** Procura em nome comum, nome científico e sintomas. Busca vazia devolve tudo. */
export function filtrarDoencas(lista: CatalogDisease[], busca: string): CatalogDisease[] {
  const termo = busca.trim().toLowerCase();
  if (!termo) return lista;

  return lista.filter(
    (d) =>
      d.nomeComum.toLowerCase().includes(termo) ||
      (d.nomeCientifico ?? '').toLowerCase().includes(termo) ||
      (d.sintomas ?? '').toLowerCase().includes(termo)
  );
}

/**
 * `nivel_severidade` é `CHECK(BETWEEN 1 AND 5)` mas aceita nulo no schema.
 * Nulo não vira "baixa": afirmar severidade que não se sabe é pior que calar.
 */
export function rotuloSeveridade(nivel: number | null): string {
  if (nivel === null) return 'Severidade não informada';
  if (nivel <= 2) return 'Severidade Baixa';
  if (nivel <= 3) return 'Severidade Média';
  return 'Severidade Alta';
}

export function tipoSeveridade(nivel: number | null): 'success' | 'warning' | 'error' | 'info' {
  if (nivel === null) return 'info';
  if (nivel <= 2) return 'success';
  if (nivel <= 3) return 'warning';
  return 'error';
}

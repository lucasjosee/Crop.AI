import { describe, it, expect } from 'vitest';

import { filtrarDoencas, rotuloSeveridade, tipoSeveridade } from './catalogo';
import type { CatalogDisease } from './diagnosisDetails';

function doenca(over: Partial<CatalogDisease> = {}): CatalogDisease {
  return {
    id: 'a',
    nomeComum: 'Ferrugem Asiática',
    nomeCientifico: 'Phakopsora pachyrhizi',
    sintomas: 'Pústulas marrons na face inferior da folha',
    nivelSeveridade: 5,
    ...over,
  };
}

describe('filtrarDoencas', () => {
  const lista = [
    doenca(),
    doenca({
      id: 'b',
      nomeComum: 'Mancha Alvo',
      nomeCientifico: 'Corynespora cassiicola',
      sintomas: 'Lesões circulares com anéis concêntricos',
      nivelSeveridade: 3,
    }),
  ];

  it('busca vazia devolve a lista inteira', () => {
    expect(filtrarDoencas(lista, '')).toEqual(lista);
  });

  it('busca só de espaços devolve a lista inteira', () => {
    expect(filtrarDoencas(lista, '   ')).toEqual(lista);
  });

  it('encontra pelo nome comum', () => {
    expect(filtrarDoencas(lista, 'mancha').map((d) => d.id)).toEqual(['b']);
  });

  it('encontra pelo nome científico', () => {
    expect(filtrarDoencas(lista, 'phakopsora').map((d) => d.id)).toEqual(['a']);
  });

  it('encontra pelos sintomas', () => {
    expect(filtrarDoencas(lista, 'concêntricos').map((d) => d.id)).toEqual(['b']);
  });

  it('não diferencia maiúsculas de minúsculas', () => {
    expect(filtrarDoencas(lista, 'FERRUGEM').map((d) => d.id)).toEqual(['a']);
  });

  it('devolve lista vazia quando nada casa', () => {
    expect(filtrarDoencas(lista, 'oídio')).toEqual([]);
  });

  it('não quebra com campos nulos', () => {
    const semTexto = [doenca({ id: 'c', nomeCientifico: null, sintomas: null })];
    expect(filtrarDoencas(semTexto, 'phakopsora')).toEqual([]);
    expect(filtrarDoencas(semTexto, 'ferrugem').map((d) => d.id)).toEqual(['c']);
  });
});

describe('rotuloSeveridade', () => {
  it('1 e 2 são baixa', () => {
    expect(rotuloSeveridade(1)).toBe('Severidade Baixa');
    expect(rotuloSeveridade(2)).toBe('Severidade Baixa');
  });

  it('3 é média', () => {
    expect(rotuloSeveridade(3)).toBe('Severidade Média');
  });

  it('4 e 5 são alta', () => {
    expect(rotuloSeveridade(4)).toBe('Severidade Alta');
    expect(rotuloSeveridade(5)).toBe('Severidade Alta');
  });

  it('nulo não inventa severidade', () => {
    expect(rotuloSeveridade(null)).toBe('Severidade não informada');
  });
});

describe('tipoSeveridade', () => {
  it('mapeia os cinco níveis para as cores do tema', () => {
    expect(tipoSeveridade(1)).toBe('success');
    expect(tipoSeveridade(2)).toBe('success');
    expect(tipoSeveridade(3)).toBe('warning');
    expect(tipoSeveridade(4)).toBe('error');
    expect(tipoSeveridade(5)).toBe('error');
  });

  it('nulo é informativo, não alarme', () => {
    expect(tipoSeveridade(null)).toBe('info');
  });
});

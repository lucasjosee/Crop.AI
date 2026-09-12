import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../db/sqlite', () => ({ dbDriver: { execute: mocks.execute } }));

import { buildCatalogContext, MAX_DEFENSIVOS, MAX_FIELD_CHARS } from './catalogContext';

function rows(list: Array<Record<string, unknown>>) {
  return { rows: { _array: list, length: list.length, item: (i: number) => list[i] } };
}

const doenca = {
  nome_comum: 'Ferrugem Asiática',
  nome_cientifico: 'Phakopsora pachyrhizi',
  sintomas: 'Pústulas na face inferior da folha.',
  nivel_severidade: 5,
  causa: 'fungo',
};

function defensivo(n: number, extra: Record<string, unknown> = {}) {
  return {
    ...doenca,
    nome_comercial: `Produto ${n}`,
    ingrediente_ativo: `ativo ${n}`,
    dosagem_recomendada: '300 mL/ha',
    carencia_dias: 30,
    max_aplicacoes_ciclo: 2,
    bula_resumida: JSON.stringify({ modo_de_acao: 'Sistêmico.', epoca_aplicacao: 'No R1.' }),
    ...extra,
  };
}

describe('buildCatalogContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue(rows([]));
  });

  it('planta saudável não consulta o banco', async () => {
    expect(await buildCatalogContext(null)).toContain('Planta saudável');
    expect(await buildCatalogContext('Saudável')).toContain('Planta saudável');
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('fitotoxicidade explica que não é doença e não indica defensivo', async () => {
    const ctx = await buildCatalogContext('Fitotoxicidade');
    expect(ctx).toContain('não é doença');
    expect(ctx).toContain('Não há defensivo');
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('consulta por id, nunca por nome, e monta o cabeçalho da doença', async () => {
    mocks.execute.mockResolvedValueOnce(rows([defensivo(1)]));

    const ctx = await buildCatalogContext('uuid-ferrugem');

    const [sql, params] = mocks.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE d.id = ?');
    expect(sql).not.toContain('nome_comum = ?');
    expect(params[0]).toBe('uuid-ferrugem');
    expect(ctx).toContain('Doença: Ferrugem Asiática (Phakopsora pachyrhizi)');
    expect(ctx).toContain('Causa: fungo · Severidade: 5/5');
    expect(ctx).toContain('Sintomas: Pústulas');
  });

  it('inclui dose, carência, máximo de aplicações e os campos da bula', async () => {
    mocks.execute.mockResolvedValueOnce(rows([defensivo(1)]));

    const ctx = await buildCatalogContext('uuid-ferrugem');

    expect(ctx).toContain('1. Produto 1 (ativo 1)');
    expect(ctx).toContain('Dose: 300 mL/ha · Carência: 30 dias · Máx. 2 aplicações/ciclo');
    expect(ctx).toContain('Modo de ação: Sistêmico.');
    expect(ctx).toContain('Quando aplicar: No R1.');
  });

  it(`limita a ${MAX_DEFENSIVOS} defensivos pelo LIMIT da consulta`, async () => {
    mocks.execute.mockResolvedValueOnce(rows([defensivo(1), defensivo(2), defensivo(3)]));

    await buildCatalogContext('uuid-ferrugem');

    const [sql, params] = mocks.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('LIMIT ?');
    expect(params).toContain(MAX_DEFENSIVOS);
  });

  it(`trunca cada campo da bula em ${MAX_FIELD_CHARS} caracteres`, async () => {
    const longo = 'x'.repeat(MAX_FIELD_CHARS + 200);
    mocks.execute.mockResolvedValueOnce(rows([
      defensivo(1, { bula_resumida: JSON.stringify({ modo_de_acao: longo, epoca_aplicacao: longo }) }),
    ]));

    const ctx = await buildCatalogContext('uuid-ferrugem');

    const linhaModo = ctx.split('\n').find((l) => l.includes('Modo de ação:'))!;
    expect(linhaModo.length).toBeLessThanOrEqual(MAX_FIELD_CHARS + 'Modo de ação: '.length + 4);
    expect(linhaModo).toContain('…');
  });

  it('doença sem defensivo cadastrado ainda monta o cabeçalho', async () => {
    mocks.execute.mockResolvedValueOnce(rows([{ ...doenca, nome_comercial: null }]));

    const ctx = await buildCatalogContext('uuid-ferrugem');

    expect(ctx).toContain('Doença: Ferrugem Asiática');
    expect(ctx).toContain('Nenhum defensivo cadastrado');
  });

  it('bula malformada não derruba o contexto', async () => {
    mocks.execute.mockResolvedValueOnce(rows([defensivo(1, { bula_resumida: '{nao e json' })]));

    const ctx = await buildCatalogContext('uuid-ferrugem');

    expect(ctx).toContain('1. Produto 1');
    expect(ctx).not.toContain('Modo de ação:');
  });

  it('id desconhecido devolve string vazia', async () => {
    mocks.execute.mockResolvedValueOnce(rows([]));
    expect(await buildCatalogContext('uuid-inexistente')).toBe('');
  });
});

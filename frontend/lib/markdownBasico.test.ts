import { describe, it, expect } from 'vitest';
import { interpretarMarkdown } from './markdownBasico';

const t = (texto: string, negrito = false) => ({ texto, negrito });

describe('interpretarMarkdown', () => {
  it('texto simples vira um parágrafo', () => {
    expect(interpretarMarkdown('Olá, produtor.')).toEqual([
      { tipo: 'paragrafo', trechos: [t('Olá, produtor.')] },
    ]);
  });

  it('negrito no meio da linha', () => {
    expect(interpretarMarkdown('Isto é **muito** importante')[0].trechos).toEqual([
      t('Isto é '),
      t('muito', true),
      t(' importante'),
    ]);
  });

  it('negrito no começo da linha', () => {
    expect(interpretarMarkdown('**Conclusão:** aplicar agora')[0].trechos).toEqual([
      t('Conclusão:', true),
      t(' aplicar agora'),
    ]);
  });

  it('dois negritos na mesma linha', () => {
    expect(interpretarMarkdown('**a** e **b**')[0].trechos).toEqual([
      t('a', true),
      t(' e '),
      t('b', true),
    ]);
  });

  it('** sem par (streaming) fica literal', () => {
    expect(interpretarMarkdown('Veja **Concl')[0].trechos).toEqual([t('Veja **Concl')]);
    expect(interpretarMarkdown('**a** e **b')[0].trechos).toEqual([
      t('a', true),
      t(' e **b'),
    ]);
  });

  it('lista sem número usa • e com número guarda o próprio número', () => {
    const blocos = interpretarMarkdown('- um\n* dois\n1. tres\n2. quatro');
    expect(blocos.map((b) => [b.tipo, b.marcador])).toEqual([
      ['item', '•'],
      ['item', '•'],
      ['item', '1.'],
      ['item', '2.'],
    ]);
    expect(blocos[0].trechos).toEqual([t('um')]);
  });

  it('negrito dentro de item de lista', () => {
    expect(interpretarMarkdown('- **Dose:** 1 L')[0]).toEqual({
      tipo: 'item',
      marcador: '•',
      trechos: [t('Dose:', true), t(' 1 L')],
    });
  });

  it('título com #, ## e ### perde os #', () => {
    const blocos = interpretarMarkdown('# A\n## B\n### C');
    expect(blocos.map((b) => b.tipo)).toEqual(['titulo', 'titulo', 'titulo']);
    expect(blocos.map((b) => b.trechos[0].texto)).toEqual(['A', 'B', 'C']);
  });

  it('linhas em branco não geram bloco', () => {
    expect(interpretarMarkdown('a\n\n\nb').map((b) => b.trechos[0].texto)).toEqual(['a', 'b']);
  });

  it('string vazia devolve lista vazia', () => {
    expect(interpretarMarkdown('')).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { LIMIAR_CONFIANCA, diagnosticoIncerto, tituloDaAnalise } from './confianca';

describe('diagnosticoIncerto', () => {
  it('0,69 é incerto e 0,70 é certo', () => {
    expect(diagnosticoIncerto(0.69, 'PENDING')).toBe(true);
    expect(diagnosticoIncerto(LIMIAR_CONFIANCA, 'PENDING')).toBe(false);
  });

  it('CONFIRMED e ENRICHED tiram a incerteza', () => {
    expect(diagnosticoIncerto(0.2, 'CONFIRMED')).toBe(false);
    expect(diagnosticoIncerto(0.2, 'ENRICHED')).toBe(false);
  });

  it('DIVERGENT, PENDING, SKIPPED e ausência de status não tiram', () => {
    for (const status of ['DIVERGENT', 'PENDING', 'SKIPPED', null]) {
      expect(diagnosticoIncerto(0.2, status)).toBe(true);
    }
  });
});

describe('tituloDaAnalise', () => {
  it('abaixo do limiar, doença vira "Possível" e Saudável vira inconclusiva', () => {
    expect(tituloDaAnalise('uuid', 'Mancha Parda', 0.16)).toBe('Possível Mancha Parda');
    expect(tituloDaAnalise('Saudável', 'Saudável', 0.16)).toBe('Análise inconclusiva');
  });

  it('com confiança suficiente o título não muda', () => {
    expect(tituloDaAnalise('uuid', 'Mancha Parda', 0.9)).toBe('Mancha Parda');
  });
});

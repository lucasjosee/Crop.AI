import { describe, it, expect } from 'vitest';
import { textoDaConfirmacaoDeSaida } from './confirmacaoDeSaida';

describe('textoDaConfirmacaoDeSaida', () => {
  it('online e sem pendências só avisa que os dados ficam no aparelho', () => {
    const { mensagem } = textoDaConfirmacaoDeSaida({ modo: 'ONLINE', pendentes: 0 });
    expect(mensagem).toBe('As análises e conversas continuam neste aparelho.');
  });

  it('usa o singular com 1 pendência', () => {
    const { mensagem } = textoDaConfirmacaoDeSaida({ modo: 'ONLINE', pendentes: 1 });
    expect(mensagem).toContain('1 item ainda não foi enviado.');
  });

  it('usa o plural com várias pendências, também em DEGRADED', () => {
    const { mensagem } = textoDaConfirmacaoDeSaida({ modo: 'DEGRADED', pendentes: 4 });
    expect(mensagem).toContain('4 itens ainda não foram enviados.');
    expect(mensagem).not.toContain('sem conexão');
  });

  it.each(['FIELD', 'PROBING'] as const)('em %s avisa que só volta a entrar com sinal', (modo) => {
    const { mensagem } = textoDaConfirmacaoDeSaida({ modo, pendentes: 0 });
    expect(mensagem).toContain('Você está sem conexão.');
    expect(mensagem).toContain('só vai conseguir entrar de novo quando houver sinal');
  });
});

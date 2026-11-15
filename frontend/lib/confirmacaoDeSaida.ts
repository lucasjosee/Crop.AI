import type { ConnectionMode } from '../config/network';

export interface EntradaConfirmacaoDeSaida {
  modo: ConnectionMode;
  /** Soma das três contagens de pendentes do useSyncStore. */
  pendentes: number;
}

/**
 * Texto do aviso ao sair da conta. Os dados locais continuam no aparelho
 * (ainda não são separados por usuário), e sem rede o produtor só volta a
 * entrar quando houver sinal: o login exige o servidor.
 */
export function textoDaConfirmacaoDeSaida({ modo, pendentes }: EntradaConfirmacaoDeSaida): {
  titulo: string;
  mensagem: string;
} {
  const linhas = ['As análises e conversas continuam neste aparelho.'];

  if (pendentes > 0) {
    linhas.push(
      pendentes === 1
        ? '1 item ainda não foi enviado.'
        : `${pendentes} itens ainda não foram enviados.`
    );
  }

  if (modo !== 'ONLINE' && modo !== 'DEGRADED') {
    linhas.push(
      'Você está sem conexão. Se sair agora, só vai conseguir entrar de novo quando houver sinal.'
    );
  }

  return { titulo: 'Sair da conta?', mensagem: linhas.join('\n\n') };
}

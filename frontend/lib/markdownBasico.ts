// Markdown mínimo das respostas do assistente: negrito, lista e título.
// Itálico, link, código e tabela ficam como texto. O texto chega em streaming,
// então um `**` sem par é literal e a função nunca lança.

export interface Trecho {
  texto: string;
  negrito: boolean;
}

export interface Bloco {
  tipo: 'paragrafo' | 'item' | 'titulo';
  /** Só em `item`: o marcador a exibir ('•' ou o número, como '1.'). */
  marcador?: string;
  trechos: Trecho[];
}

/** Divide a linha em trechos; só `**...**` com par fecha negrito. */
function interpretarLinha(linha: string): Trecho[] {
  const partes = linha.split('**');
  // Quantidade par de partes = número ímpar de `**`: o último não tem par.
  const temOrfao = partes.length % 2 === 0;
  const trechos: Trecho[] = [];
  const acrescentar = (texto: string, negrito: boolean) => {
    if (texto === '') return;
    const ultimo = trechos[trechos.length - 1];
    if (ultimo && ultimo.negrito === negrito) ultimo.texto += texto;
    else trechos.push({ texto, negrito });
  };
  partes.forEach((parte, i) => {
    const ultimaParte = i === partes.length - 1;
    if (i === 0) return acrescentar(parte, false);
    if (temOrfao && ultimaParte) {
      // Abertura sem fechamento: devolve o `**` como texto.
      return acrescentar('**' + parte, false);
    }
    acrescentar(parte, i % 2 === 1);
  });
  return trechos;
}

/**
 * Um bloco por linha não vazia. Linhas em branco não geram bloco: a separação
 * de parágrafos fica por conta de quem renderiza (espaço entre blocos).
 */
export function interpretarMarkdown(texto: string): Bloco[] {
  const blocos: Bloco[] = [];
  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.trim();
    if (linha === '') continue;

    const titulo = /^#{1,3}\s+(.*)$/.exec(linha);
    if (titulo) {
      blocos.push({ tipo: 'titulo', trechos: interpretarLinha(titulo[1]) });
      continue;
    }
    const item = /^(?:[-*]|(\d+\.))\s+(.*)$/.exec(linha);
    if (item) {
      blocos.push({
        tipo: 'item',
        marcador: item[1] ?? '•',
        trechos: interpretarLinha(item[2]),
      });
      continue;
    }
    blocos.push({ tipo: 'paragrafo', trechos: interpretarLinha(linha) });
  }
  return blocos;
}

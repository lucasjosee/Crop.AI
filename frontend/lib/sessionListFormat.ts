import type { SessionListItem } from './chatRepository';

export const PREVIA_VAZIA = 'Conversa vazia';
export const PREVIA_FOTO = 'Foto analisada';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function doisDigitos(n: number): string {
  return String(n).padStart(2, '0');
}

function mesmoDia(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * A linha de prévia da lista.
 *
 * A foto vira mensagem do usuário **sem texto nenhum** — inventar um resumo
 * seria mentira no histórico, e deixar em branco esconderia a conversa.
 */
export function previewDaSessao(item: SessionListItem): string {
  if (item.messageCount === 0) return PREVIA_VAZIA;

  const conteudo = (item.lastMessageContent ?? '').trim();
  if (!conteudo) return PREVIA_FOTO;

  return item.lastMessageRole === 'user' ? `Você: ${conteudo}` : conteudo;
}

/**
 * Data para a lista: nunca absoluta para hoje, porque "13 set" numa conversa
 * de dez minutos atrás não diz nada ao produtor.
 */
export function dataRelativa(iso: string, agora: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const minutos = Math.floor((agora.getTime() - d.getTime()) / 60000);
  if (minutos < 1) return 'Agora';
  if (mesmoDia(d, agora)) return `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;

  const ontem = new Date(agora);
  ontem.setDate(agora.getDate() - 1);
  if (mesmoDia(d, ontem)) return 'Ontem';

  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}

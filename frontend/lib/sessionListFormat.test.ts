import { describe, it, expect } from 'vitest';
import {
  dataRelativa,
  previewDaSessao,
  PREVIA_FOTO,
  PREVIA_VAZIA,
} from './sessionListFormat';
import type { SessionListItem } from './chatRepository';

function item(over: Partial<SessionListItem> = {}): SessionListItem {
  return {
    id: 's1',
    title: 'Ferrugem',
    updatedAt: '2026-09-13T10:00:00.000Z',
    lastMessageContent: 'Use o defensivo X',
    lastMessageRole: 'assistant',
    originDiagnosticLocalId: null,
    messageCount: 2,
    ...over,
  };
}

describe('previewDaSessao', () => {
  it('sessão sem mensagem nenhuma', () => {
    expect(previewDaSessao(item({ messageCount: 0 }))).toBe(PREVIA_VAZIA);
  });

  it('mensagem sem texto é a foto, não uma conversa em branco', () => {
    expect(previewDaSessao(item({ lastMessageContent: '', lastMessageRole: 'user' }))).toBe(
      PREVIA_FOTO
    );
  });

  it('resposta do assistente aparece sem prefixo', () => {
    expect(previewDaSessao(item())).toBe('Use o defensivo X');
  });

  it('pergunta do produtor leva prefixo', () => {
    expect(
      previewDaSessao(item({ lastMessageContent: 'E a dosagem?', lastMessageRole: 'user' }))
    ).toBe('Você: E a dosagem?');
  });

  it('conteúdo nulo é tratado como a foto, não como erro', () => {
    expect(previewDaSessao(item({ lastMessageContent: null, lastMessageRole: 'user' }))).toBe(
      PREVIA_FOTO
    );
  });
});

describe('dataRelativa', () => {
  // Construído por componentes locais, não por string UTC: `dataRelativa`
  // compara dia e hora em hora local, e misturar as duas convenções fazia o
  // teste falhar em fusos a oeste de Greenwich.
  const agora = new Date(2026, 8, 13, 15, 0, 0); // 13 set 2026, 15:00 local

  it('menos de um minuto é "Agora"', () => {
    const trintaSegundosAntes = new Date(agora.getTime() - 30_000);
    expect(dataRelativa(trintaSegundosAntes.toISOString(), agora)).toBe('Agora');
  });

  it('mesmo dia mostra a hora', () => {
    const cedo = new Date(2026, 8, 13, 8, 5, 0);
    expect(dataRelativa(cedo.toISOString(), agora)).toBe('08:05');
  });

  it('dia anterior é "Ontem"', () => {
    const ontem = new Date(2026, 8, 12, 10, 0, 0);
    expect(dataRelativa(ontem.toISOString(), agora)).toBe('Ontem');
  });

  it('mais antigo mostra dia e mês', () => {
    const antigo = new Date(2026, 8, 8, 10, 0, 0);
    expect(dataRelativa(antigo.toISOString(), agora)).toBe('8 set');
  });

  it('data inválida não quebra a lista', () => {
    expect(dataRelativa('não é data', agora)).toBe('');
  });
});

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
});

describe('dataRelativa', () => {
  const agora = new Date('2026-09-13T15:00:00.000Z');

  it('menos de um minuto é "Agora"', () => {
    expect(dataRelativa('2026-09-13T14:59:30.000Z', agora)).toBe('Agora');
  });

  it('mesmo dia mostra a hora', () => {
    const cedo = new Date('2026-09-13T15:00:00.000Z');
    cedo.setHours(8, 5, 0, 0);
    expect(dataRelativa(cedo.toISOString(), agora)).toBe('08:05');
  });

  it('dia anterior é "Ontem"', () => {
    const ontem = new Date(agora);
    ontem.setDate(agora.getDate() - 1);
    expect(dataRelativa(ontem.toISOString(), agora)).toBe('Ontem');
  });

  it('mais antigo mostra dia e mês', () => {
    const antigo = new Date(agora);
    antigo.setDate(agora.getDate() - 5);
    expect(dataRelativa(antigo.toISOString(), agora)).toMatch(/^\d{1,2} \w{3}$/);
  });

  it('data inválida não quebra a lista', () => {
    expect(dataRelativa('não é data', agora)).toBe('');
  });
});

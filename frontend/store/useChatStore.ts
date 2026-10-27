// frontend/store/useChatStore.ts
import { create } from 'zustand';

import type { ChatMessage } from '../lib/chatRepository';

export type { ChatMessage, MessageSource } from '../lib/chatRepository';

/**
 * O que a tela precisa mostrar do fim de uma resposta que não terminou bem.
 * Mora na store, por sessão, e não em useState: a resposta disparada antes do
 * router.replace da conversa livre termina em outra instância da tela, e os
 * setters da instância antiga escreveriam num componente que já saiu de cena.
 */
export interface DesfechoResposta {
  /** O texto da faixa de erro. */
  mensagem: string;
  /** A mensagem do usuário para "tentar de novo". */
  falhou: ChatMessage | null;
  /** O que chegou antes da falha. */
  parcial: string | null;
  /** A resposta chegou inteira mas não pôde ser salva (rótulo "não salva"). */
  parcialNaoSalvo: boolean;
}

/**
 * Só estado efêmero de UI. O histórico mora em chat_messages (lib/chatRepository)
 * e nunca passa por aqui.
 */
interface ChatState {
  activeSessionId: string | null;
  isStreaming: boolean;
  streamingContent: string;
  /**
   * Sessões com resposta em voo. Mapa, e não campo único, porque a lista do
   * sub-projeto 5 torna a troca de conversa cotidiana: com um campo só, a
   * conclusão tardia de uma sessão limpava a flag de outra que ainda respondia.
   *
   * `Record` e não `Set` porque o zustand compara por referência — um `Set`
   * mutado no lugar não dispara re-render.
   */
  pendingResponses: Record<string, true>;
  /** Desfecho de falha por sessão, até a próxima tentativa ou mensagem. */
  desfechos: Record<string, DesfechoResposta>;
  /** Progresso 0–1 do carregamento do .gguf; null quando não está carregando. */
  modelLoadProgress: number | null;

  setActiveSession: (id: string | null) => void;
  appendToStreaming: (chunk: string) => void;
  resetStreaming: () => void;
  marcarRespostaEmVoo: (sessionId: string) => void;
  limparRespostaEmVoo: (sessionId: string) => void;
  registrarDesfecho: (sessionId: string, desfecho: DesfechoResposta) => void;
  limparDesfecho: (sessionId: string) => void;
  setModelLoadProgress: (progress: number | null) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  activeSessionId: null,
  isStreaming: false,
  streamingContent: '',
  pendingResponses: {},
  desfechos: {},
  modelLoadProgress: null,

  setActiveSession: (id) => set({ activeSessionId: id }),
  appendToStreaming: (chunk) =>
    set((state) => ({ isStreaming: true, streamingContent: state.streamingContent + chunk })),
  resetStreaming: () => set({ isStreaming: false, streamingContent: '' }),
  marcarRespostaEmVoo: (sessionId) =>
    set((state) => ({ pendingResponses: { ...state.pendingResponses, [sessionId]: true } })),
  limparRespostaEmVoo: (sessionId) =>
    set((state) => {
      if (!state.pendingResponses[sessionId]) return state;
      const { [sessionId]: _removida, ...resto } = state.pendingResponses;
      return { pendingResponses: resto };
    }),
  registrarDesfecho: (sessionId, desfecho) =>
    set((state) => ({ desfechos: { ...state.desfechos, [sessionId]: desfecho } })),
  limparDesfecho: (sessionId) =>
    set((state) => {
      if (!state.desfechos[sessionId]) return state;
      const { [sessionId]: _removido, ...resto } = state.desfechos;
      return { desfechos: resto };
    }),
  setModelLoadProgress: (progress) => set({ modelLoadProgress: progress }),
}));

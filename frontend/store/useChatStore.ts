// frontend/store/useChatStore.ts
import { create } from 'zustand';

export type { ChatMessage, MessageSource } from '../lib/chatRepository';

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
  /** Progresso 0–1 do carregamento do .gguf; null quando não está carregando. */
  modelLoadProgress: number | null;

  setActiveSession: (id: string | null) => void;
  appendToStreaming: (chunk: string) => void;
  resetStreaming: () => void;
  marcarRespostaEmVoo: (sessionId: string) => void;
  limparRespostaEmVoo: (sessionId: string) => void;
  setModelLoadProgress: (progress: number | null) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  activeSessionId: null,
  isStreaming: false,
  streamingContent: '',
  pendingResponses: {},
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
  setModelLoadProgress: (progress) => set({ modelLoadProgress: progress }),
}));

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
  /** Sessão com resposta em voo — guarda contra disparo automático duplo. */
  pendingResponseFor: string | null;
  /** Progresso 0–1 do carregamento do .gguf; null quando não está carregando. */
  modelLoadProgress: number | null;

  setActiveSession: (id: string | null) => void;
  appendToStreaming: (chunk: string) => void;
  resetStreaming: () => void;
  setPendingResponseFor: (sessionId: string | null) => void;
  setModelLoadProgress: (progress: number | null) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  activeSessionId: null,
  isStreaming: false,
  streamingContent: '',
  pendingResponseFor: null,
  modelLoadProgress: null,

  setActiveSession: (id) => set({ activeSessionId: id }),
  appendToStreaming: (chunk) =>
    set((state) => ({ isStreaming: true, streamingContent: state.streamingContent + chunk })),
  resetStreaming: () => set({ isStreaming: false, streamingContent: '' }),
  setPendingResponseFor: (sessionId) => set({ pendingResponseFor: sessionId }),
  setModelLoadProgress: (progress) => set({ modelLoadProgress: progress }),
}));

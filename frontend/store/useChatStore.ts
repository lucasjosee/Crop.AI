// frontend/store/useChatStore.ts
import { create } from 'zustand';

export type { ChatMessage, MessageSource } from '../lib/chatRepository';

export interface DiagnosticContext {
  cultura?: string;
  doenca_identificada?: string;
  /** id no catálogo, ou 'Saudável' / 'Fitotoxicidade'. É por ele que o contexto é construído. */
  doenca_id?: string | null;
  confianca_visao?: number;
  image_s3_key?: string;
  /** local_id em fila_diagnosticos; a sessão de conversa aponta para ele. */
  diagnostic_local_id?: string;
}

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
  /** Ponte com a câmera até o sub-projeto 3 reescrever o fluxo da foto. */
  diagnosticContext: DiagnosticContext | null;

  setActiveSession: (id: string | null) => void;
  appendToStreaming: (chunk: string) => void;
  resetStreaming: () => void;
  setPendingResponseFor: (sessionId: string | null) => void;
  setModelLoadProgress: (progress: number | null) => void;
  setDiagnosticContext: (context: DiagnosticContext | null) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  activeSessionId: null,
  isStreaming: false,
  streamingContent: '',
  pendingResponseFor: null,
  modelLoadProgress: null,
  diagnosticContext: null,

  setActiveSession: (id) => set({ activeSessionId: id }),
  appendToStreaming: (chunk) =>
    set((state) => ({ isStreaming: true, streamingContent: state.streamingContent + chunk })),
  resetStreaming: () => set({ isStreaming: false, streamingContent: '' }),
  setPendingResponseFor: (sessionId) => set({ pendingResponseFor: sessionId }),
  setModelLoadProgress: (progress) => set({ modelLoadProgress: progress }),
  setDiagnosticContext: (context) => set({ diagnosticContext: context }),
}));

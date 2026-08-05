// frontend/store/useChatStore.ts
import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import { dbDriver } from '../db/sqlite';

const SLM_MODEL_VERSION = 'gemma-2b-it-q4_k_m';

export type MessageSource = 'CLOUD_LLM' | 'LOCAL_SLM';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  source: MessageSource;
  timestamp: string;
}

export interface DiagnosticContext {
  cultura?: string;
  doenca_identificada?: string;
  confianca_visao?: number;
  image_s3_key?: string;
}

interface ChatState {
  sessionId: string;
  history: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  diagnosticContext: DiagnosticContext | null;

  addUserMessage: (content: string) => ChatMessage;
  addAssistantMessage: (content: string, source: MessageSource) => void;
  appendToStreaming: (chunk: string) => void;
  finalizeStreaming: (source: MessageSource) => void;
  setDiagnosticContext: (context: DiagnosticContext | null) => void;
  clearHistory: () => void;
  getCloudHistory: () => Array<{ role: 'user' | 'assistant'; content: string }>;
  getSlmHistory: () => Array<{ role: 'user' | 'assistant'; content: string }>;
  condenseForSlm: () => void;
  expandForCloud: () => string;
  logSlmInteraction: (prompt: string, response: string, latencyMs: number) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessionId: Crypto.randomUUID(),
  history: [],
  isStreaming: false,
  streamingContent: '',
  diagnosticContext: null,

  addUserMessage: (content) => {
    const msg: ChatMessage = {
      id: Crypto.randomUUID(),
      role: 'user',
      content,
      source: 'CLOUD_LLM',
      timestamp: new Date().toISOString(),
    };
    set((state) => ({ history: [...state.history, msg] }));
    return msg;
  },

  addAssistantMessage: (content, source) => {
    const msg: ChatMessage = {
      id: Crypto.randomUUID(),
      role: 'assistant',
      content,
      source,
      timestamp: new Date().toISOString(),
    };
    set((state) => ({
      history: [...state.history, msg],
      isStreaming: false,
      streamingContent: '',
    }));
  },

  appendToStreaming: (chunk) => {
    set((state) => ({
      isStreaming: true,
      streamingContent: state.streamingContent + chunk,
    }));
  },

  finalizeStreaming: (source) => {
    const content = get().streamingContent;
    if (!content.trim()) {
      set({ isStreaming: false, streamingContent: '' });
      return;
    }
    get().addAssistantMessage(content, source);
  },

  setDiagnosticContext: (context) => set({ diagnosticContext: context }),

  clearHistory: () =>
    set({
      history: [],
      sessionId: Crypto.randomUUID(),
      isStreaming: false,
      streamingContent: '',
    }),

  getCloudHistory: () => {
    return get()
      .history.filter((m) => m.role !== 'system')
      .slice(-20)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  },

  getSlmHistory: () => {
    return get()
      .history.filter((m) => m.role !== 'system')
      .slice(-10)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  },

  condenseForSlm: () => {
    const condensed = get()
      .history.filter((m) => m.role !== 'system')
      .slice(-10);

    const offlineNote: ChatMessage = {
      id: Crypto.randomUUID(),
      role: 'system',
      content:
        'A partir deste ponto, você está operando no modo offline. Use apenas as informações do contexto fornecido.',
      source: 'LOCAL_SLM',
      timestamp: new Date().toISOString(),
    };

    set({ history: [...condensed, offlineNote] });
  },

  expandForCloud: () =>
    'Algumas das respostas anteriores foram geradas por um modelo local compacto durante operação offline. Você pode corrigir ou complementar informações se necessário.',

  logSlmInteraction: async (prompt, response, latencyMs) => {
    try {
      const sessionId = get().sessionId;
      const interaction = {
        prompt,
        response,
        latency_ms: Math.round(latencyMs),
        rag_used_documents: [] as unknown[],
      };

      const res = await dbDriver.execute(
        'SELECT * FROM fila_slm_logs WHERE session_id = ?;',
        [sessionId]
      );

      if (res.rows.length > 0) {
        const interactions = JSON.parse(res.rows.item(0).interactions_json || '[]');
        interactions.push(interaction);
        await dbDriver.execute(
          'UPDATE fila_slm_logs SET interactions_json = ?, sync_status = ? WHERE session_id = ?;',
          [JSON.stringify(interactions), 'PENDING', sessionId]
        );
      } else {
        await dbDriver.execute(
          'INSERT INTO fila_slm_logs (session_id, started_at, model_version, interactions_json, sync_status, retry_count) VALUES (?, ?, ?, ?, ?, ?);',
          [sessionId, new Date().toISOString(), SLM_MODEL_VERSION, JSON.stringify([interaction]), 'PENDING', 0]
        );
      }
    } catch {
      console.warn('[ChatStore] Falha ao registrar log SLM local.');
    }
  },
}));

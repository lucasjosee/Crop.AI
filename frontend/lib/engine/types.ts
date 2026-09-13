import type { ChatAttachment, ChatMessage } from '../chatRepository';

export type EngineKind = 'LOCAL' | 'CLOUD';

export interface EngineInput {
  sessionId: string;
  /** Histórico completo da sessão; cada motor recorta a própria janela. */
  history: ChatMessage[];
  userMessage: string;
  /** Presente só na primeira mensagem de uma foto. */
  attachment?: ChatAttachment;
  /** Construído uma vez por buildCatalogContext; idêntico para os dois motores. */
  catalogContext: string;
}

export interface EngineDoneMeta {
  /** Motor que efetivamente respondeu — inclusive após fallback da cloud para a local. */
  kind: EngineKind;
  latencyMs: number;
  tokensUsed?: number;
  /** Preenchido pelo CloudEngine quando ele mesmo subiu a imagem. */
  imageS3Key?: string;
}

export type EngineError =
  | 'MODEL_NOT_LOADED'
  | 'TIMEOUT'
  | 'LLM_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'TOKEN_EXPIRED'
  | 'ABORTED'
  | 'UNKNOWN';

export interface EngineCallbacks {
  onToken(token: string): void;
  onDone(meta: EngineDoneMeta): void;
  onError(error: EngineError): void;
}

export interface ConversationEngine {
  readonly kind: EngineKind;
  isReady(): boolean;
  /** LOCAL carrega o .gguf e reporta progresso 0–1; CLOUD resolve true sem fazer nada. */
  prepare(onProgress: (progress: number) => void): Promise<boolean>;
  /** LOCAL descarrega o modelo; CLOUD é no-op. */
  release(): Promise<void>;
  respond(input: EngineInput, callbacks: EngineCallbacks, signal: AbortSignal): void;
}

export const LOCAL_HISTORY_WINDOW = 10;
export const CLOUD_HISTORY_WINDOW = 20;

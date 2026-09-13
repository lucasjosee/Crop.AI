import type { ConnectionMode } from '../../config/network';
import type { ConversationEngine, EngineCallbacks, EngineError, EngineInput, EngineKind } from './types';

export const RELEASE_AFTER_ONLINE_MS = 60_000;
export const PROBING_WAIT_MS = 2_000;

/** Erros da cloud que autorizam a local a assumir — só antes do primeiro token. */
const FALLBACK_ERRORS: ReadonlySet<EngineError> = new Set(['TIMEOUT', 'LLM_UNAVAILABLE']);

export interface NetworkSource {
  getState(): { connectionMode: ConnectionMode };
  subscribe(listener: (state: { connectionMode: ConnectionMode }) => void): () => void;
}

export interface EngineRouterOptions {
  /** Progresso 0–1 do carregamento do .gguf; null quando termina (com ou sem sucesso). */
  onModelProgress?: (progress: number | null) => void;
  releaseAfterOnlineMs?: number;
  probingWaitMs?: number;
}

/**
 * Único lugar do app que sabe que existem dois motores. A tela chama
 * respond(); qual motor responde é decisão daqui, invisível para ela.
 */
export class EngineRouter {
  private unsubscribe: (() => void) | null = null;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private preparing: Promise<boolean> | null = null;
  private readonly releaseAfterOnlineMs: number;
  private readonly probingWaitMs: number;
  private readonly onModelProgress?: (progress: number | null) => void;

  constructor(
    private readonly local: ConversationEngine,
    private readonly cloud: ConversationEngine,
    private readonly network: NetworkSource,
    options: EngineRouterOptions = {}
  ) {
    this.onModelProgress = options.onModelProgress;
    this.releaseAfterOnlineMs = options.releaseAfterOnlineMs ?? RELEASE_AFTER_ONLINE_MS;
    this.probingWaitMs = options.probingWaitMs ?? PROBING_WAIT_MS;
  }

  start(): void {
    this.stop();
    this.unsubscribe = this.network.subscribe((state) => this.onModeChange(state.connectionMode));
    this.onModeChange(this.network.getState().connectionMode);
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.cancelRelease();
  }

  currentKind(): EngineKind {
    return this.network.getState().connectionMode === 'FIELD' ? 'LOCAL' : 'CLOUD';
  }

  respond(input: EngineInput, callbacks: EngineCallbacks, signal: AbortSignal): void {
    void this.route(input, callbacks, signal);
  }

  private async route(input: EngineInput, callbacks: EngineCallbacks, signal: AbortSignal): Promise<void> {
    let mode = this.network.getState().connectionMode;
    if (mode === 'PROBING') mode = await this.waitForResolution();
    if (signal.aborted) {
      callbacks.onError('ABORTED');
      return;
    }

    if (mode === 'FIELD') {
      await this.respondLocal(input, callbacks, signal);
      return;
    }

    // ONLINE ou DEGRADED: cloud primeiro. Em DEGRADED, aproveita a janela para
    // subir o .gguf em background — se a cloud cair, a local já estará pronta.
    if (mode === 'DEGRADED') void this.ensureLocalPrepared();

    let tokensSeen = false;
    this.cloud.respond(
      input,
      {
        onToken: (token) => {
          tokensSeen = true;
          callbacks.onToken(token);
        },
        onDone: callbacks.onDone,
        onError: (error) => {
          // Fallback só antes do primeiro token: trocar de modelo no meio de uma
          // frase produz resposta incoerente. Depois disso, o parcial vai com o erro.
          const canFallback =
            !tokensSeen && FALLBACK_ERRORS.has(error) && this.local.isReady() && !signal.aborted;
          if (canFallback) {
            this.local.respond(input, callbacks, signal);
          } else {
            callbacks.onError(error);
          }
        },
      },
      signal
    );
  }

  private async respondLocal(input: EngineInput, callbacks: EngineCallbacks, signal: AbortSignal): Promise<void> {
    if (!this.local.isReady()) {
      const ok = await this.ensureLocalPrepared();
      if (!ok) {
        callbacks.onError('MODEL_NOT_LOADED');
        return;
      }
      if (signal.aborted) {
        callbacks.onError('ABORTED');
        return;
      }
    }
    this.local.respond(input, callbacks, signal);
  }

  private ensureLocalPrepared(): Promise<boolean> {
    if (this.local.isReady()) return Promise.resolve(true);
    if (!this.preparing) {
      this.onModelProgress?.(0);
      this.preparing = this.local
        .prepare((progress) => this.onModelProgress?.(progress))
        .catch(() => false)
        .finally(() => {
          this.preparing = null;
          this.onModelProgress?.(null);
        });
    }
    return this.preparing;
  }

  private waitForResolution(): Promise<ConnectionMode> {
    return new Promise((resolve) => {
      let settled = false;
      let unsubscribe: () => void = () => {};
      const finish = (mode: ConnectionMode) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        unsubscribe();
        resolve(mode);
      };
      // Sem resolução no prazo, o caminho seguro num app offline-first é o local.
      const deadline = setTimeout(() => finish('FIELD'), this.probingWaitMs);
      unsubscribe = this.network.subscribe((state) => {
        if (state.connectionMode !== 'PROBING') finish(state.connectionMode);
      });
      const now = this.network.getState().connectionMode;
      if (now !== 'PROBING') finish(now);
    });
  }

  private onModeChange(mode: ConnectionMode): void {
    if (mode === 'FIELD' || mode === 'DEGRADED') {
      this.cancelRelease();
      void this.ensureLocalPrepared();
      return;
    }
    if (mode === 'ONLINE') {
      this.scheduleRelease();
      return;
    }
    this.cancelRelease();
  }

  /** Histerese: só descarrega depois de ONLINE contínuo, para a oscilação de sinal não recarregar 1,5 GB. */
  private scheduleRelease(): void {
    if (this.releaseTimer) return;
    this.releaseTimer = setTimeout(() => {
      this.releaseTimer = null;
      if (this.local.isReady()) void this.local.release();
    }, this.releaseAfterOnlineMs);
  }

  private cancelRelease(): void {
    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
  }
}

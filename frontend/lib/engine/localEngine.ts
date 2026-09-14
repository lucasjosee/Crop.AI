import { loadSlmModel, slmChat, unloadSlmModel } from '../slmChatService';
import type { ChatAttachment } from '../chatRepository';
import {
  LOCAL_HISTORY_WINDOW,
  type ConversationEngine,
  type EngineCallbacks,
  type EngineInput,
} from './types';

/** A SLM é texto: a foto é ignorada e o achado do CV entra como preâmbulo. */
function attachmentPreamble(attachment: ChatAttachment): string {
  const confianca = Math.round(attachment.cvResult.confidence * 100);
  const alvo = attachment.diseaseName ?? 'a doença descrita no contexto';
  return `O modelo de visão identificou ${alvo} com ${confianca}% de confiança. Apresente o diagnóstico, o tratamento e os defensivos indicados.`;
}

export class LocalEngine implements ConversationEngine {
  readonly kind = 'LOCAL' as const;
  private ready = false;

  isReady(): boolean {
    return this.ready;
  }

  async prepare(onProgress: (progress: number) => void): Promise<boolean> {
    const ok = await loadSlmModel((p) => onProgress(p.progress));
    this.ready = ok;
    return ok;
  }

  async release(): Promise<void> {
    await unloadSlmModel();
    this.ready = false;
  }

  respond(input: EngineInput, callbacks: EngineCallbacks, signal: AbortSignal): void {
    if (!this.ready) {
      callbacks.onError('MODEL_NOT_LOADED');
      return;
    }

    const window = input.history
      .slice(-LOCAL_HISTORY_WINDOW)
      .map((m) => ({ role: m.role, content: m.content }));

    const userContent = input.attachment
      ? [attachmentPreamble(input.attachment), input.userMessage].filter(Boolean).join('\n\n')
      : input.userMessage;

    const start = Date.now();
    slmChat({
      messages: [...window, { role: 'user', content: userContent }],
      sqliteContext: input.catalogContext,
      onToken: callbacks.onToken,
      signal,
    })
      .then(({ aborted }) => {
        if (aborted) callbacks.onError('ABORTED');
        else callbacks.onDone({ kind: 'LOCAL', latencyMs: Date.now() - start });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '';
        callbacks.onError(message === 'MODEL_NOT_LOADED' ? 'MODEL_NOT_LOADED' : 'UNKNOWN');
      });
  }
}

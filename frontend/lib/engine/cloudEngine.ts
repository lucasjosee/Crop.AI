import EventSource from 'react-native-sse';
import { refreshAccessToken } from '../api';
import { useAuthStore } from '../../store/useAuthStore';
import { ensureDiagnosticImageUploaded } from '../diagnosticImageUploadService';
import type { ChatAttachment, ChatMessage } from '../chatRepository';
import {
  CLOUD_HISTORY_WINDOW,
  type ConversationEngine,
  type EngineCallbacks,
  type EngineError,
  type EngineInput,
} from './types';

export const CLOUD_INACTIVITY_TIMEOUT_MS = 10_000;

const LOCAL_ORIGIN_NOTE =
  '[Contexto do sistema: Algumas das respostas anteriores foram geradas por um modelo local compacto durante operação offline. Você pode corrigir ou complementar informações se necessário.]';

const baseURL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

type HistoryItem = { role: 'user' | 'assistant'; content: string };

function windowedHistory(history: ChatMessage[]): HistoryItem[] {
  const items: HistoryItem[] = history
    .slice(-CLOUD_HISTORY_WINDOW)
    .map((m) => ({ role: m.role, content: m.content }));
  const cameFromLocal = history.some((m) => m.source === 'LOCAL_SLM');
  return cameFromLocal && items.length > 0 ? [{ role: 'user', content: LOCAL_ORIGIN_NOTE }, ...items] : items;
}

function cvResultPayload(attachment: ChatAttachment) {
  const { cvResult } = attachment;
  const isSpecial = cvResult.diseaseId === 'Saudável' || cvResult.diseaseId === 'Fitotoxicidade';
  return {
    doenca_id: isSpecial ? null : cvResult.diseaseId,
    doenca_nome: attachment.diseaseName ?? (isSpecial ? cvResult.diseaseId : 'doença identificada'),
    confianca: cvResult.confidence,
    modelo_usado: cvResult.modelUsed,
  };
}

function mapHttpStatus(status: number | undefined): EngineError {
  if (status === 401) return 'TOKEN_EXPIRED';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 502 || status === 503 || status === 504) return 'LLM_UNAVAILABLE';
  return 'UNKNOWN';
}

function mapBodyError(code: string | undefined): EngineError {
  if (code === 'LLM_TIMEOUT') return 'TIMEOUT';
  if (code === 'RATE_LIMITED') return 'RATE_LIMITED';
  if (code === 'TOKEN_EXPIRED') return 'TOKEN_EXPIRED';
  return 'LLM_UNAVAILABLE';
}

export class CloudEngine implements ConversationEngine {
  readonly kind = 'CLOUD' as const;

  isReady(): boolean {
    return true;
  }

  async prepare(_onProgress: (progress: number) => void): Promise<boolean> {
    return true;
  }

  async release(): Promise<void> {}

  respond(input: EngineInput, callbacks: EngineCallbacks, signal: AbortSignal): void {
    void this.run(input, callbacks, signal);
  }

  private async run(input: EngineInput, callbacks: EngineCallbacks, signal: AbortSignal): Promise<void> {
    let imageS3Key: string | undefined;
    try {
      imageS3Key = await this.resolveImageKey(input.attachment);
    } catch {
      callbacks.onError('UNKNOWN');
      return;
    }

    const body = JSON.stringify({
      session_id: input.sessionId,
      message: input.userMessage,
      history: windowedHistory(input.history),
      catalog_context: input.catalogContext,
      ...(imageS3Key && { image_s3_key: imageS3Key }),
      ...(input.attachment && { cv_result: cvResultPayload(input.attachment) }),
    });

    const start = Date.now();
    let token = useAuthStore.getState().accessToken ?? '';
    let refreshed = false;

    const attempt = (): void => {
      let es: InstanceType<typeof EventSource> | null = new EventSource(`${baseURL}/api/v1/chat/stream`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        method: 'POST',
        body,
      });
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let settled = false;

      const close = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = null;
        if (es) {
          es.removeAllEventListeners();
          es.close();
          es = null;
        }
        signal.removeEventListener('abort', onAbort);
      };

      const fail = (error: EngineError) => {
        if (settled) return;
        settled = true;
        close();
        callbacks.onError(error);
      };

      const onAbort = () => fail('ABORTED');
      signal.addEventListener('abort', onAbort);

      const armTimeout = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fail('TIMEOUT'), CLOUD_INACTIVITY_TIMEOUT_MS);
      };
      armTimeout();

      es.addEventListener('message', (event: unknown) => {
        if (settled) return;
        let data: { chunk?: string; done?: boolean; tokens_used?: number; error?: { code?: string } };
        try {
          data = JSON.parse((event as { data: string }).data);
        } catch {
          return;
        }
        if (data.chunk !== undefined) {
          armTimeout();
          callbacks.onToken(data.chunk);
        }
        if (data.done === true) {
          settled = true;
          close();
          callbacks.onDone({
            kind: 'CLOUD',
            latencyMs: Date.now() - start,
            tokensUsed: data.tokens_used ?? 0,
            ...(imageS3Key && { imageS3Key }),
          });
        }
        if (data.error) {
          fail(mapBodyError(data.error.code));
        }
      });

      es.addEventListener('error', (event: unknown) => {
        if (settled) return;
        const status = (event as { xhrStatus?: number })?.xhrStatus;
        if (status === 401 && !refreshed) {
          refreshed = true;
          settled = true;
          close();
          refreshAccessToken()
            .then((newToken) => {
              token = newToken;
              attempt();
            })
            .catch(() => callbacks.onError('TOKEN_EXPIRED'));
          return;
        }
        fail(mapHttpStatus(status));
      });
    };

    if (signal.aborted) {
      callbacks.onError('ABORTED');
      return;
    }
    attempt();
  }

  private async resolveImageKey(attachment?: ChatAttachment): Promise<string | undefined> {
    if (!attachment) return undefined;
    if (attachment.imageS3Key) return attachment.imageS3Key;
    if (!attachment.diagnosticLocalId) return undefined;
    return ensureDiagnosticImageUploaded({
      localId: attachment.diagnosticLocalId,
      imageUri: attachment.imageUri,
      imageS3Key: attachment.imageS3Key,
    });
  }
}

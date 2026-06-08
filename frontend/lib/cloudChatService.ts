// frontend/lib/cloudChatService.ts
import EventSource from 'react-native-sse';
import { secureStorage } from './secureStorage';

const baseURL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

export interface CloudChatOptions {
  sessionId: string;
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  context?: {
    cultura?: string;
    doenca_identificada?: string;
    confianca_visao?: number;
  };
  imageS3Key?: string;
  onChunk: (chunk: string) => void;
  onDone: (tokensUsed: number) => void;
  onError: (error: Error) => void;
}

// Returns a cleanup function to cancel the stream
export function streamCloudChat(options: CloudChatOptions): () => void {
  const {
    sessionId,
    message,
    history,
    context,
    imageS3Key,
    onChunk,
    onDone,
    onError,
  } = options;

  let es: any = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let firstTokenReceived = false;

  const cleanup = () => {
    if (timeoutId) clearTimeout(timeoutId);
    if (es) {
      es.removeAllEventListeners?.();
      es.close();
      es = null;
    }
  };

  // 10s timeout if no token received
  const resetTimeout = () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      cleanup();
      onError(new Error('TIMEOUT'));
    }, 10_000);
  };

  (async () => {
    try {
      const token = await secureStorage.getItem('access_token');

      const body = JSON.stringify({
        session_id: sessionId,
        message,
        history,
        ...(context && { context }),
        ...(imageS3Key && { image_s3_key: imageS3Key }),
      });

      es = new EventSource(`${baseURL}/api/v1/chat/stream`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        method: 'POST',
        body,
      });

      resetTimeout(); // Start timeout waiting for first token

      es.addEventListener('message', (event: any) => {
        try {
          const data = JSON.parse(event.data);

          if (data.chunk !== undefined) {
            if (!firstTokenReceived) {
              firstTokenReceived = true;
            }
            resetTimeout(); // Reset timeout on each token
            onChunk(data.chunk);
          }

          if (data.done === true) {
            cleanup();
            onDone(data.tokens_used ?? 0);
          }

          if (data.error) {
            cleanup();
            onError(new Error(data.error.code ?? 'LLM_UNAVAILABLE'));
          }
        } catch {
          // Ignore heartbeat or malformed events
        }
      });

      es.addEventListener('error', () => {
        cleanup();
        onError(new Error('SSE_CONNECTION_ERROR'));
      });
    } catch (err) {
      cleanup();
      onError(err instanceof Error ? err : new Error('UNKNOWN_ERROR'));
    }
  })();

  return cleanup;
}

// frontend/lib/cloudChatService.ts
import { Platform } from 'react-native';
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
  if (Platform.OS === 'web') {
    return streamCloudChatWeb(options);
  }
  return streamCloudChatNative(options);
}

// --- Web: fetch + ReadableStream ---
function streamCloudChatWeb(options: CloudChatOptions): () => void {
  const { sessionId, message, history, context, imageS3Key, onChunk, onDone, onError } = options;
  const abortController = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const resetTimeout = () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      abortController.abort();
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

      resetTimeout();

      const response = await fetch(`${baseURL}/api/v1/chat/stream`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token ?? ''}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body,
        signal: abortController.signal,
      });

      if (!response.ok) {
        if (timeoutId) clearTimeout(timeoutId);
        onError(new Error(`HTTP_${response.status}`));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        if (timeoutId) clearTimeout(timeoutId);
        onError(new Error('NO_STREAM'));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.chunk !== undefined) {
              resetTimeout();
              onChunk(data.chunk);
            }
            if (data.done === true) {
              if (timeoutId) clearTimeout(timeoutId);
              onDone(data.tokens_used ?? 0);
              return;
            }
            if (data.error) {
              if (timeoutId) clearTimeout(timeoutId);
              onError(new Error(data.error.code ?? 'LLM_UNAVAILABLE'));
              return;
            }
          } catch {
            // ignore malformed lines
          }
        }
      }
    } catch (err: any) {
      if (timeoutId) clearTimeout(timeoutId);
      if (err?.name !== 'AbortError') {
        onError(err instanceof Error ? err : new Error('UNKNOWN_ERROR'));
      }
    }
  })();

  return () => {
    if (timeoutId) clearTimeout(timeoutId);
    abortController.abort();
  };
}

// --- Native (Android/iOS): react-native-sse ---
function streamCloudChatNative(options: CloudChatOptions): () => void {
  const { sessionId, message, history, context, imageS3Key, onChunk, onDone, onError } = options;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const EventSource = require('react-native-sse').default;

  let es: any = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    if (timeoutId) clearTimeout(timeoutId);
    if (es) {
      es.removeAllEventListeners?.();
      es.close();
      es = null;
    }
  };

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

      resetTimeout();

      es.addEventListener('message', (event: any) => {
        try {
          const data = JSON.parse(event.data);
          if (data.chunk !== undefined) {
            resetTimeout();
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
          // ignore malformed events
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

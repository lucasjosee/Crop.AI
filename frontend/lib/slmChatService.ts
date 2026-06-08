// frontend/lib/slmChatService.ts
import * as FileSystem from 'expo-file-system';

// Path where the .gguf file must exist on the device.
// Dev: copy manually to documentDirectory/models/
// Prod: Play Asset Delivery (Android) / On-Demand Resources (iOS)
export const SLM_MODEL_FILENAME = 'gemma-2b-it-q4_k_m.gguf';
export const SLM_MODEL_PATH = `${FileSystem.documentDirectory ?? ''}models/${SLM_MODEL_FILENAME}`;

export const SLM_SYSTEM_PROMPT = `Você é um Agrônomo Virtual especializado em soja e milho.
Responda de forma clara e objetiva usando APENAS as informações do contexto fornecido.
Se não encontrar informação no contexto, diga que não tem essa informação disponível offline.
Seja conciso — máximo 3 parágrafos.
SEMPRE inclua ao final: "⚠️ Consulte um engenheiro agrônomo registrado no CREA antes de aplicar qualquer defensivo."`;

export interface SlmLoadProgress {
  progress: number; // 0.0 to 1.0
  loaded: boolean;
}

let llamaContext: any = null;

export async function loadSlmModel(
  onProgress: (p: SlmLoadProgress) => void
): Promise<boolean> {
  if (llamaContext) {
    onProgress({ progress: 1, loaded: true });
    return true;
  }

  try {
    const info = await FileSystem.getInfoAsync(SLM_MODEL_PATH);
    if (!info.exists) {
      console.warn(`[SLM] Model not found at: ${SLM_MODEL_PATH}`);
      console.warn(`[SLM] Copy the .gguf file to: ${FileSystem.documentDirectory ?? ''}models/`);
      return false;
    }

    const { initLlama } = require('llama.rn');
    onProgress({ progress: 0.05, loaded: false });

    llamaContext = await initLlama(
      {
        model: SLM_MODEL_PATH,
        use_mlock: true,
        n_ctx: 2048,
        n_threads: 4,
        n_gpu_layers: 0,
      },
      (loadProgress: number) => {
        onProgress({ progress: loadProgress / 100, loaded: false });
      }
    );

    onProgress({ progress: 1, loaded: true });
    return true;
  } catch (err) {
    console.error('[SLM] Failed to initialize model:', err);
    llamaContext = null;
    return false;
  }
}

export async function unloadSlmModel(): Promise<void> {
  if (llamaContext) {
    try {
      await llamaContext.release();
    } catch (err) {
      console.warn('[SLM] Error releasing model:', err);
    }
    llamaContext = null;
  }
}

export interface SlmChatOptions {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  sqliteContext: string;
  onToken: (token: string) => void;
  signal?: AbortSignal;
}

const STOP_WORDS = ['</s>', '<end_of_turn>', '<|eot_id|>', '<|end|>'];

export async function slmChat(options: SlmChatOptions): Promise<{ aborted: boolean }> {
  if (!llamaContext) {
    throw new Error('MODEL_NOT_LOADED');
  }

  const { messages, sqliteContext, onToken, signal } = options;

  const systemContent = sqliteContext
    ? `${SLM_SYSTEM_PROMPT}\n\n[Dados do Catálogo Local]\n${sqliteContext}`
    : SLM_SYSTEM_PROMPT;

  const llamaMessages = [
    { role: 'system', content: systemContent },
    ...messages,
  ];

  let aborted = false;

  const abortHandler = () => {
    aborted = true;
  };
  signal?.addEventListener('abort', abortHandler);

  try {
    await llamaContext.completion(
      {
        messages: llamaMessages,
        n_predict: 512,
        temperature: 0.7,
        stop: STOP_WORDS,
      },
      (data: { token: string }) => {
        if (aborted) return;
        const token = data.token;
        if (token && !STOP_WORDS.includes(token)) {
          onToken(token);
        }
      }
    );
  } finally {
    signal?.removeEventListener('abort', abortHandler);
  }

  return { aborted };
}

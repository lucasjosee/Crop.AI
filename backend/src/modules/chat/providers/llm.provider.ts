// backend/src/modules/chat/providers/llm.provider.ts
import { env } from '../../../config/env';
import { GeminiProvider } from './gemini.provider';
import { ClaudeProvider } from './claude.provider';

export interface StreamCallbacks {
  onChunk: (text: string) => Promise<void> | void;
  onDone: (uso: LLMUsage) => void;
}

/** Uso medido pelo provedor. No Gemini a saída inclui o raciocínio. */
export interface LLMUsage {
  tokensEntrada: number;
  tokensSaida: number;
}

export interface StreamOptions {
  /** Aborta a geração: o cliente saiu ou o teto de tempo estourou. */
  signal?: AbortSignal;
  /** Foto anexada à mensagem do usuário. */
  imagem?: LLMImageInput;
}

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMImageInput {
  dataBase64: string;
  mimeType: 'image/jpeg' | 'image/png';
}

export interface LLMProvider {
  stream(
    systemPrompt: string,
    history: LLMMessage[],
    userMessage: string,
    callbacks: StreamCallbacks,
    opcoes?: StreamOptions
  ): Promise<void>;
  analyzeImage(
    systemPrompt: string,
    userPrompt: string,
    image: LLMImageInput
  ): Promise<string>;
}

export function createLLMProvider(): LLMProvider {
  if (env.LLM_PROVIDER === 'claude') {
    return new ClaudeProvider(env.LLM_API_KEY, env.LLM_MODEL_ID);
  }
  return new GeminiProvider(env.LLM_API_KEY, env.LLM_MODEL_ID);
}

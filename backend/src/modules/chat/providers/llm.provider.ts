// backend/src/modules/chat/providers/llm.provider.ts
import { env } from '../../../config/env';

export interface StreamCallbacks {
  onChunk: (text: string) => Promise<void> | void;
  onDone: (tokensUsed: number) => void;
}

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMProvider {
  stream(
    systemPrompt: string,
    history: LLMMessage[],
    userMessage: string,
    callbacks: StreamCallbacks
  ): Promise<void>;
}

export function createLLMProvider(): LLMProvider {
  const { GeminiProvider } = require('./gemini.provider');
  const { ClaudeProvider } = require('./claude.provider');

  if (env.LLM_PROVIDER === 'claude') {
    return new ClaudeProvider(env.LLM_API_KEY, env.LLM_MODEL_ID);
  }
  return new GeminiProvider(env.LLM_API_KEY, env.LLM_MODEL_ID);
}

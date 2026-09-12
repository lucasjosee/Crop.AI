// backend/src/modules/chat/chat.service.ts
import { AGRONOMO_SYSTEM_PROMPT } from '../../config/llm';
import { createLLMProvider, LLMProvider, StreamCallbacks } from './providers/llm.provider';
import { ChatStreamInput } from './chat.schema';
import { AppError } from '../../shared/errors';

interface JwtUser {
  sub: string;
  role: string;
}

export class ChatService {
  private provider: LLMProvider;

  constructor(provider?: LLMProvider) {
    this.provider = provider ?? createLLMProvider();
  }

  async stream(input: ChatStreamInput, user: JwtUser, callbacks: StreamCallbacks): Promise<void> {
    const systemPrompt = this.buildSystemPrompt(input);
    try {
      await this.provider.stream(systemPrompt, input.history, input.message, callbacks);
    } catch {
      throw new AppError(502, 'LLM_UNAVAILABLE', 'O serviço de IA está temporariamente indisponível.');
    }
  }

  /**
   * Prompt base + contexto do catálogo (pronto, do cliente) + achado do CV.
   * O contexto é idêntico ao que a SLM local recebe: grounding igual nos dois
   * motores é o ponto.
   */
  private buildSystemPrompt(input: ChatStreamInput): string {
    const parts = [AGRONOMO_SYSTEM_PROMPT];
    if (input.catalog_context) {
      parts.push(`[Contexto do Catálogo]\n${input.catalog_context}`);
    }
    if (input.cv_result) {
      const confianca = Math.round(input.cv_result.confianca * 100);
      parts.push(
        `O modelo de visão local identificou ${input.cv_result.doenca_nome} com ${confianca}% de confiança.`
      );
    }
    return parts.join('\n\n');
  }
}

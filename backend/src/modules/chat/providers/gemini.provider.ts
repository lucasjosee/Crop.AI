// backend/src/modules/chat/providers/gemini.provider.ts
import { GoogleGenerativeAI, Content, GenerationConfig, Part } from '@google/generative-ai';
import type { LLMProvider, LLMMessage, StreamCallbacks, StreamOptions, LLMImageInput } from './llm.provider';
import { env } from '../../../config/env';
import { LLM_MAX_TOKENS, LLM_TEMPERATURE } from '../../../config/llm';

/**
 * O SDK 0.24.1 não tipa `thinkingConfig`, mas serializa o `generationConfig`
 * inteiro no corpo da requisição (JSON.stringify dos params), então o campo
 * chega à API.
 */
export type ChatGenerationConfig = GenerationConfig & {
  thinkingConfig: { thinkingBudget: number };
};

export function montarGenerationConfigDoChat(thinkingBudget: number): ChatGenerationConfig {
  return {
    temperature: LLM_TEMPERATURE,
    maxOutputTokens: LLM_MAX_TOKENS,
    thinkingConfig: { thinkingBudget },
  };
}

export class GeminiProvider implements LLMProvider {
  private client: GoogleGenerativeAI;

  constructor(
    private readonly apiKey: string,
    private readonly modelId: string
  ) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async stream(
    systemPrompt: string,
    history: LLMMessage[],
    userMessage: string,
    callbacks: StreamCallbacks,
    opcoes: StreamOptions = {}
  ): Promise<void> {
    const model = this.client.getGenerativeModel({
      model: this.modelId,
      systemInstruction: systemPrompt,
      generationConfig: montarGenerationConfigDoChat(env.LLM_CHAT_THINKING_BUDGET),
    });

    // Build Gemini content history (all messages except the last user message)
    const geminiHistory: Content[] = history.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    const chat = model.startChat({ history: geminiHistory });
    const partes: Part[] = opcoes.imagem
      ? [
          { inlineData: { data: opcoes.imagem.dataBase64, mimeType: opcoes.imagem.mimeType } },
          { text: userMessage },
        ]
      : [{ text: userMessage }];
    const result = await chat.sendMessageStream(partes, { signal: opcoes.signal });

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        await callbacks.onChunk(text);
      }
    }

    const finalResponse = await result.response;
    const tokensEntrada = finalResponse.usageMetadata?.promptTokenCount ?? 0;
    const total = finalResponse.usageMetadata?.totalTokenCount ?? tokensEntrada;
    // A saída é o total menos a entrada, então inclui os tokens de raciocínio.
    callbacks.onDone({ tokensEntrada, tokensSaida: Math.max(0, total - tokensEntrada) });
  }

  async analyzeImage(
    systemPrompt: string,
    userPrompt: string,
    image: LLMImageInput
  ): Promise<string> {
    const model = this.client.getGenerativeModel({
      model: this.modelId,
      systemInstruction: systemPrompt,
      generationConfig: {
        maxOutputTokens: LLM_MAX_TOKENS,
        temperature: LLM_TEMPERATURE,
        responseMimeType: 'application/json',
      },
    });

    const response = await model.generateContent([
      { inlineData: { data: image.dataBase64, mimeType: image.mimeType } },
      { text: userPrompt },
    ]);

    return response.response.text();
  }
}

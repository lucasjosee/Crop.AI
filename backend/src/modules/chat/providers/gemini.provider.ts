// backend/src/modules/chat/providers/gemini.provider.ts
import { GoogleGenerativeAI, Content } from '@google/generative-ai';
import type { LLMProvider, LLMMessage, StreamCallbacks } from './llm.provider';
import { LLM_MAX_TOKENS, LLM_TEMPERATURE } from '../../../config/llm';

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
    callbacks: StreamCallbacks
  ): Promise<void> {
    const model = this.client.getGenerativeModel({
      model: this.modelId,
      systemInstruction: systemPrompt,
    });

    // Build Gemini content history (all messages except the last user message)
    const geminiHistory: Content[] = history.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    const chat = model.startChat({ history: geminiHistory });
    const result = await chat.sendMessageStream(userMessage);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        await callbacks.onChunk(text);
      }
    }

    const finalResponse = await result.response;
    const tokensUsed = finalResponse.usageMetadata?.totalTokenCount ?? 0;
    callbacks.onDone(tokensUsed);
  }
}

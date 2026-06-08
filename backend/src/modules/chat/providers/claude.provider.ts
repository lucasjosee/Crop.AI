// backend/src/modules/chat/providers/claude.provider.ts
import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMMessage, StreamCallbacks } from './llm.provider';
import { LLM_MAX_TOKENS, LLM_TEMPERATURE } from '../../../config/llm';

export class ClaudeProvider implements LLMProvider {
  private client: Anthropic;

  constructor(
    private readonly apiKey: string,
    private readonly modelId: string
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async stream(
    systemPrompt: string,
    history: LLMMessage[],
    userMessage: string,
    callbacks: StreamCallbacks
  ): Promise<void> {
    const messages: Anthropic.Messages.MessageParam[] = [
      ...history.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      { role: 'user', content: userMessage },
    ];

    const stream = await this.client.messages.create({
      model: this.modelId,
      max_tokens: LLM_MAX_TOKENS,
      temperature: LLM_TEMPERATURE,
      system: systemPrompt,
      messages,
      stream: true,
    });

    let outputTokens = 0;

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        await callbacks.onChunk(event.delta.text);
      }
      if (event.type === 'message_delta') {
        outputTokens = event.usage?.output_tokens ?? 0;
      }
    }

    callbacks.onDone(outputTokens);
  }
}

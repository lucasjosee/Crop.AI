import { describe, it, expect } from 'vitest';
import { montarGenerationConfigDoChat } from './gemini.provider';
import { LLM_MAX_TOKENS, LLM_TEMPERATURE } from '../../../config/llm';

describe('montarGenerationConfigDoChat', () => {
  it('leva temperatura, teto de saída e o orçamento de raciocínio', () => {
    expect(montarGenerationConfigDoChat(0)).toEqual({
      temperature: LLM_TEMPERATURE,
      maxOutputTokens: LLM_MAX_TOKENS,
      thinkingConfig: { thinkingBudget: 0 },
    });
    expect(montarGenerationConfigDoChat(512).thinkingConfig.thinkingBudget).toBe(512);
  });
});

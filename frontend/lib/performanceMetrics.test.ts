import { describe, expect, it } from 'vitest';
import { summarizeInferencePerformance } from './performanceSummary';

describe('summarizeInferencePerformance', () => {
  it('calcula média e p90 e valida o target de 500 ms', () => {
    const summary = summarizeInferencePerformance([100, 200, 300, 400, 450, 480, 490, 495, 500, 800]);

    expect(summary).toEqual({
      sampleCount: 10,
      averageMs: 422,
      p90Ms: 500,
      targetMs: 500,
      targetMet: true,
    });
  });

  it('ignora amostras inválidas e não inventa resultado sem dados', () => {
    expect(summarizeInferencePerformance([null, undefined, -1, Number.NaN])).toEqual({
      sampleCount: 0,
      averageMs: null,
      p90Ms: null,
      targetMs: 500,
      targetMet: null,
    });
  });
});

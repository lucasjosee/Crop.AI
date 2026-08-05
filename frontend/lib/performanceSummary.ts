export const CV_INFERENCE_TARGET_MS = 500;

export interface InferencePerformanceSummary {
  sampleCount: number;
  averageMs: number | null;
  p90Ms: number | null;
  targetMs: number;
  targetMet: boolean | null;
}

export function summarizeInferencePerformance(
  measurements: Array<number | null | undefined>,
  targetMs = CV_INFERENCE_TARGET_MS
): InferencePerformanceSummary {
  const valid = measurements
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);

  if (valid.length === 0) {
    return { sampleCount: 0, averageMs: null, p90Ms: null, targetMs, targetMet: null };
  }

  const averageMs = Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
  const percentileIndex = Math.max(0, Math.ceil(valid.length * 0.9) - 1);
  const p90Ms = valid[percentileIndex];

  return {
    sampleCount: valid.length,
    averageMs,
    p90Ms,
    targetMs,
    targetMet: p90Ms <= targetMs,
  };
}

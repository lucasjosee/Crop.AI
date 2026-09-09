import { dbDriver } from '../db/sqlite';
import {
  InferencePerformanceSummary,
  summarizeInferencePerformance,
} from './performanceSummary';

export { CV_INFERENCE_TARGET_MS, summarizeInferencePerformance } from './performanceSummary';
export type { InferencePerformanceSummary } from './performanceSummary';

export async function readLocalInferencePerformance(): Promise<InferencePerformanceSummary> {
  const result = await dbDriver.execute('SELECT * FROM fila_diagnosticos;');
  return summarizeInferencePerformance(
    result.rows._array.map((row) => row.tempo_inferencia_ms)
  );
}

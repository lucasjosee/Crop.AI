import * as Crypto from 'expo-crypto';
import { dbDriver } from '../db/sqlite';
import type { DiagnosticContext } from '../store/useChatStore';
import type { InferenceResult } from './inference';

export interface QueueFeedbackInput {
  diagnosticLocalId: string;
  isCorrect: boolean;
  correctedDoencaId?: string | null;
  notes?: string | null;
}

export async function queueDiagnosisFeedback(input: QueueFeedbackInput): Promise<string> {
  const id = Crypto.randomUUID();
  await dbDriver.execute(
    `INSERT INTO fila_feedbacks (
      id, diagnostic_local_id, is_correct, corrected_doenca_id,
      user_correction_notes, timestamp, sync_status, retry_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      input.diagnosticLocalId,
      input.isCorrect ? 1 : 0,
      input.correctedDoencaId ?? null,
      input.notes?.trim() || null,
      new Date().toISOString(),
      'PENDING',
      0,
    ]
  );
  return id;
}

export function buildDiagnosticChatContext(
  inference: InferenceResult,
  diseaseName: string | null | undefined,
  imageS3Key?: string | null
): DiagnosticContext {
  const specialName =
    inference.diseaseId === 'Saudável'
      ? 'Saudável'
      : inference.diseaseId === 'Fitotoxicidade'
        ? 'Fitotoxicidade'
        : null;
  return {
    doenca_identificada: diseaseName ?? specialName ?? undefined,
    cultura: 'Soja',
    confianca_visao: inference.confidence,
    image_s3_key: imageS3Key ?? undefined,
  };
}

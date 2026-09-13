import * as Crypto from 'expo-crypto';
import { dbDriver } from '../db/sqlite';

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

/**
 * O card de diagnóstico vive dentro de uma conversa que persiste, então
 * "já avaliei isto" não pode ser estado de componente — sairia da tela e o
 * app pediria a mesma avaliação de novo a cada abertura.
 */
export async function hasFeedback(diagnosticLocalId: string): Promise<boolean> {
  const res = await dbDriver.execute(
    'SELECT 1 FROM fila_feedbacks WHERE diagnostic_local_id = ? LIMIT 1;',
    [diagnosticLocalId]
  );
  return res.rows.length > 0;
}

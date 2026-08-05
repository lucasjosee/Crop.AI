import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(async () => ({
    rows: { _array: [], length: 0, item: () => null },
    rowsAffected: 1,
  })),
}));

vi.mock('expo-crypto', () => ({ randomUUID: () => 'feedback-uuid' }));
vi.mock('../db/sqlite', () => ({ dbDriver: { execute: mocks.execute } }));

import {
  buildDiagnosticChatContext,
  queueDiagnosisFeedback,
} from './diagnosisFeedbackService';

describe('diagnosisFeedbackService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('enfileira correção por diagnostic_local_id no formato do sync da Sprint 5', async () => {
    await queueDiagnosisFeedback({
      diagnosticLocalId: 'diagnostic-local-1',
      isCorrect: false,
      correctedDoencaId: 'doenca-correta',
      notes: 'Parece mancha alvo.',
    });

    const calls = mocks.execute.mock.calls as unknown as Array<[string, unknown[]]>;
    const params = calls[0][1];
    expect(params).toEqual(expect.arrayContaining([
      'feedback-uuid',
      'diagnostic-local-1',
      0,
      'doenca-correta',
      'Parece mancha alvo.',
      'PENDING',
    ]));
  });

  it('monta o contexto diagnóstico → chat, incluindo especiais e image_s3_key disponível', () => {
    const healthy = buildDiagnosticChatContext(
      { diseaseId: 'Saudável', confidence: 0.97, inferenceTimeMs: 30, modelUsed: 'tflite_v1.0' },
      null,
      'diagnosticos/user/leaf.jpg'
    );
    expect(healthy).toEqual({
      doenca_identificada: 'Saudável',
      cultura: 'Soja',
      confianca_visao: 0.97,
      image_s3_key: 'diagnosticos/user/leaf.jpg',
    });
  });
});

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
  hasFeedback,
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
      doenca_id: 'Saudável',
      cultura: 'Soja',
      confianca_visao: 0.97,
      image_s3_key: 'diagnosticos/user/leaf.jpg',
      diagnostic_local_id: undefined,
    });
  });

  it('carrega doenca_id e diagnostic_local_id para a sessão de conversa poder apontar ao diagnóstico', () => {
    const ctx = buildDiagnosticChatContext(
      { diseaseId: 'uuid-ferrugem', confidence: 0.9, inferenceTimeMs: 40, modelUsed: 'm' },
      'Ferrugem Asiática',
      'diagnosticos/u/x.jpg',
      'local-123'
    );
    expect(ctx.doenca_id).toBe('uuid-ferrugem');
    expect(ctx.diagnostic_local_id).toBe('local-123');
  });

  it('hasFeedback devolve true quando já existe avaliação para o diagnóstico', async () => {
    // mockResolvedValueOnce e mock.calls[0] herdam o tipo do fake default acima
    // (vi.fn(async () => ({ rows: { _array: [] ... } }))); os casts aqui seguem
    // o mesmo "as unknown as" já usado nos outros arquivos de teste do banco.
    mocks.execute.mockResolvedValueOnce({
      rows: { _array: [{ um: 1 }], length: 1, item: () => ({ um: 1 }) },
      rowsAffected: 0,
    } as any);

    expect(await hasFeedback('diagnostic-local-1')).toBe(true);

    const [sql, params] = mocks.execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('FROM fila_feedbacks');
    expect(params).toEqual(['diagnostic-local-1']);
  });

  it('hasFeedback devolve false quando o diagnóstico ainda não foi avaliado', async () => {
    expect(await hasFeedback('diagnostic-local-1')).toBe(false);
  });
});

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

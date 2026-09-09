import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(async () => ({ rows: { _array: [], length: 0, item: () => null }, rowsAffected: 1 })),
}));

vi.mock('../db/sqlite', () => ({ dbDriver: { execute: mocks.execute } }));

import { discardDiagnosticDraft } from './diagnosticDraftService';

describe('discardDiagnosticDraft (P2.1)', () => {
  beforeEach(() => vi.clearAllMocks());

  // O INSERT saiu de handleSaveToHistory, que o produtor acionava, para o fluxo
  // automático pós-inferência. O Retake limpa só o state do React, então cada
  // tentativa descartada virava linha no servidor e upload no S3 — num app cuja
  // própria documentação registra 3 a 5 tentativas até um bom enquadramento.
  it('remove o rascunho ainda não sincronizado', async () => {
    await discardDiagnosticDraft('local-1');

    const [sql, params] = mocks.execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('DELETE FROM fila_diagnosticos');
    expect(params).toContain('local-1');
  });

  // Um diagnóstico já sincronizado é histórico do produtor, não rascunho.
  it('não remove diagnóstico já sincronizado', async () => {
    await discardDiagnosticDraft('local-1');

    const [sql] = mocks.execute.mock.calls[0] as unknown as [string];
    expect(sql).toContain('sync_status');
  });

  it('ignora chamada sem local_id', async () => {
    await discardDiagnosticDraft(null);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

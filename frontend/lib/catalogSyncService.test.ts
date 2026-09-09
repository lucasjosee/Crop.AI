import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const execute = vi.fn(async () => ({
    rows: { _array: [], length: 0, item: () => null },
    rowsAffected: 0,
  }));
  return {
    execute,
    getSyncMeta: vi.fn(async () => null as string | null),
    setSyncMeta: vi.fn(async () => {}),
  };
});

vi.mock('../db/sqlite', () => ({
  dbDriver: { execute: mocks.execute },
  getSyncMeta: mocks.getSyncMeta,
  setSyncMeta: mocks.setSyncMeta,
  getCausaByNomeCientifico: (n: string | null) => (n ? `Fungo (${n})` : 'Fatores abióticos'),
}));

vi.mock('./api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from './api';
import { syncCatalog } from './catalogSyncService';

describe('catalogSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSyncMeta.mockResolvedValue(null);
  });

  it('em 304 não aplica nada e não troca o ETag (T5.7 app-side)', async () => {
    mocks.getSyncMeta.mockResolvedValue('v1|abc');
    vi.mocked(api.get).mockResolvedValue({ status: 304, data: '' } as any);

    const result = await syncCatalog();

    expect(result.updated).toBe(false);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.setSyncMeta).not.toHaveBeenCalled();
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/api/v1/catalog/sync',
      expect.objectContaining({
        headers: expect.objectContaining({ 'If-None-Match': 'v1|abc' }),
      })
    );
  });

  it('aplica upserts e deletes e persiste o novo ETag (T5.6 app-side)', async () => {
    vi.mocked(api.get).mockResolvedValue({
      status: 200,
      data: {
        catalog_version_hash: 'v2|def',
        has_more: false,
        next_cursor: null,
        updates: {
          culturas: [],
          doencas: [
            { action: 'upsert', data: { id: 'do-1', id_cultura: 'cultura-soja-id', nome_comum: 'Mancha Alvo', nome_cientifico: 'Corynespora cassiicola', sintomas: 'lesões circulares', nivel_severidade: 3 } },
          ],
          defensivos: [
            { action: 'delete', id: 'def-9' },
          ],
          doenca_defensivo: [
            { action: 'upsert', data: { id_doenca: 'do-1', id_defensivo: 'def-1', dosagem_recomendada: '300ml/ha', carencia_dias: 30, max_aplicacoes_ciclo: 2 } },
          ],
        },
      },
    } as any);

    const result = await syncCatalog();

    expect(result.updated).toBe(true);

    const executeCalls = mocks.execute.mock.calls as unknown as Array<[string, any[]?]>;
    const sqls = executeCalls.map((call) => call[0]);
    expect(sqls.some((s) => s.startsWith('INSERT OR REPLACE INTO doencas'))).toBe(true);
    expect(sqls.some((s) => s.startsWith('DELETE FROM doenca_defensivo WHERE id_defensivo'))).toBe(true);
    expect(sqls.some((s) => s.startsWith('DELETE FROM defensivos WHERE id'))).toBe(true);
    expect(sqls.some((s) => s.startsWith('INSERT OR REPLACE INTO doenca_defensivo'))).toBe(true);

    // causa calculada no upsert de doença
    const doencaCall = executeCalls.find((call) => call[0].startsWith('INSERT OR REPLACE INTO doencas'));
    expect(doencaCall![1]).toContain('Fungo (Corynespora cassiicola)');

    expect(mocks.setSyncMeta).toHaveBeenCalledWith('catalog_etag', 'v2|def');
  });

  it('multi-página: só persiste o ETag após a última página', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({
        status: 200,
        data: {
          catalog_version_hash: 'v3|ghi',
          has_more: true,
          next_cursor: 'cursor-page-2',
          updates: { culturas: [], doencas: [{ action: 'upsert', data: { id: 'p1', id_cultura: 'c', nome_comum: 'A', nome_cientifico: null, sintomas: 's', nivel_severidade: 1 } }], defensivos: [], doenca_defensivo: [] },
        },
      } as any)
      .mockResolvedValueOnce({
        status: 200,
        data: {
          catalog_version_hash: 'v3|ghi',
          has_more: false,
          next_cursor: null,
          updates: { culturas: [], doencas: [{ action: 'upsert', data: { id: 'p2', id_cultura: 'c', nome_comum: 'B', nome_cientifico: null, sintomas: 's', nivel_severidade: 1 } }], defensivos: [], doenca_defensivo: [] },
        },
      } as any);

    await syncCatalog();

    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.get)).toHaveBeenNthCalledWith(
      2,
      '/api/v1/catalog/sync',
      expect.objectContaining({
        params: expect.objectContaining({ cursor: 'cursor-page-2' }),
      })
    );
    expect(mocks.setSyncMeta).toHaveBeenCalledTimes(1);
    expect(mocks.setSyncMeta).toHaveBeenCalledWith('catalog_etag', 'v3|ghi');
  });
});

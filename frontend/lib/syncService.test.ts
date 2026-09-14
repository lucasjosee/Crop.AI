import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const tables: Record<string, any[]> = {
    fila_diagnosticos: [],
    fila_feedbacks: [],
  };

  const wrap = (arr: any[]) => ({
    rows: { _array: arr, length: arr.length, item: (i: number) => arr[i] },
    rowsAffected: 0,
  });
  const empty = wrap([]);

  const execute = vi.fn(async (sql: string, params: any[] = []) => {
    const s = sql.trim().replace(/\s+/g, ' ').toLowerCase();

    const selStatus = s.match(/^select \* from (\w+) where sync_status = \?/);
    if (selStatus) return wrap(tables[selStatus[1]].filter((r) => r.sync_status === params[0]));

    const selAll = s.match(/^select \* from (\w+);?$/);
    if (selAll) return wrap([...tables[selAll[1]]]);

    const upd = s.match(/^update (\w+) set (.+?) where (\w+) = \?;?$/);
    if (upd) {
      const cols = upd[2].split(',').map((x) => x.trim().split('=')[0].trim());
      const row = tables[upd[1]].find((r) => r[upd[3]] === params[params.length - 1]);
      if (row) cols.forEach((c, i) => { row[c] = params[i]; });
      return empty;
    }

    if (s.startsWith('delete')) return empty;
    return empty;
  });

  return {
    tables,
    execute,
    network: { connectionMode: 'ONLINE' },
    auth: { isAuthenticated: true },
  };
});

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('../db/sqlite', () => ({
  dbDriver: { execute: mocks.execute },
  getSyncMeta: vi.fn(async () => null),
  setSyncMeta: vi.fn(async () => {}),
}));
vi.mock('./api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('./catalogSyncService', () => ({ syncCatalog: vi.fn(async () => ({ updated: false })) }));
vi.mock('../store/useNetworkStore', () => ({ useNetworkStore: { getState: () => mocks.network } }));
vi.mock('../store/useAuthStore', () => ({ useAuthStore: { getState: () => mocks.auth } }));
vi.mock('./conversationSyncService', () => ({
  syncPendingConversations: vi.fn(async () => ({ synced: 2, failed: 0 })),
}));
vi.mock('./pendingSecondOpinionService', () => ({
  sweepPendingSecondOpinions: vi.fn(async () => ({ synced: 1, failed: 0 })),
}));

import { api } from './api';
import {
  runFullSync, syncPendingDiagnostics, MAX_RETRIES,
} from './syncService';

function seedDiagnostic(overrides: Record<string, any> = {}) {
  const row = {
    local_id: 'l1',
    server_id: null,
    image_uri: 'https://example.com/leaf.jpg',
    image_s3_key: null,
    latitude: -23.5,
    longitude: -46.6,
    doenca_id: 'doenca-1',
    confianca_ia: 0.9,
    modelo_usado: 'tflite_v1.0',
    tempo_inferencia_ms: 40,
    timestamp: '2026-06-10 12:00:00',
    sync_status: 'PENDING',
    retry_count: 0,
    ...overrides,
  };
  mocks.tables.fila_diagnosticos.push(row);
  return row;
}

describe('syncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tables.fila_diagnosticos.length = 0;
    mocks.tables.fila_feedbacks.length = 0;
    mocks.network.connectionMode = 'ONLINE';
    mocks.auth.isAuthenticated = true;

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('example.com')) {
        return { ok: true, status: 200, blob: async () => new Uint8Array([1, 2, 3]) } as any;
      }
      return { ok: true, status: 200 } as any; // PUT no S3
    }));
  });

  it('fluxo feliz: upload + batch + SYNCED com server_id (T5.2 app-side)', async () => {
    const row = seedDiagnostic();
    vi.mocked(api.post).mockImplementation(async (url: string) => {
      if (url.includes('/upload/url')) {
        return { data: { upload_url: 'https://s3.local/put', s3_key: 'diagnosticos/u/x.jpg', expires_in: 600 } } as any;
      }
      return {
        data: {
          status: 'success', synced_count: 1, failed_count: 0,
          synced_items: [{ local_id: 'l1', server_id: 'srv-1' }],
          failed_items: [],
        },
      } as any;
    });

    const result = await syncPendingDiagnostics();

    expect(result.synced).toBe(1);
    expect(row.image_s3_key).toBe('diagnosticos/u/x.jpg');
    expect(row.sync_status).toBe('SYNCED');
    expect(row.server_id).toBe('srv-1');
    const syncCall = vi.mocked(api.post).mock.calls.find((call) =>
      String(call[0]).includes('/sync/diagnostics')
    );
    expect((syncCall?.[1] as any).diagnostics[0].cross_validation.status).toBe('SKIPPED');
  });

  it('falha no upload mantém PENDING e não envia o lote (T5.8)', async () => {
    const row = seedDiagnostic();
    vi.mocked(api.post).mockResolvedValue({
      data: { upload_url: 'https://s3.local/put', s3_key: 'diagnosticos/u/x.jpg', expires_in: 600 },
    } as any);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('example.com')) {
        return { ok: true, status: 200, blob: async () => new Uint8Array([1]) } as any;
      }
      return { ok: false, status: 500 } as any; // PUT no S3 falha
    }));

    const result = await syncPendingDiagnostics();

    expect(result.synced).toBe(0);
    expect(row.sync_status).toBe('PENDING');
    const syncCalls = vi.mocked(api.post).mock.calls.filter((c) => String(c[0]).includes('/sync/diagnostics'));
    expect(syncCalls).toHaveLength(0);
  });

  it('failed_item incrementa retry e vira FAILED no limite', async () => {
    const row = seedDiagnostic({ image_s3_key: 'diagnosticos/u/x.jpg', retry_count: MAX_RETRIES - 1 });
    vi.mocked(api.post).mockResolvedValue({
      data: {
        status: 'partial', synced_count: 0, failed_count: 1,
        synced_items: [],
        failed_items: [{ local_id: 'l1', error_code: 'INVALID_DOENCA_ID', message: 'x' }],
      },
    } as any);

    await syncPendingDiagnostics();

    expect(row.sync_status).toBe('FAILED');
    expect(row.retry_count).toBe(MAX_RETRIES);
  });

  it('itens FAILED só entram com includeFailed (sync manual)', async () => {
    seedDiagnostic({ local_id: 'lf', sync_status: 'FAILED', retry_count: MAX_RETRIES, image_s3_key: 'diagnosticos/u/f.jpg' });
    vi.mocked(api.post).mockResolvedValue({
      data: { status: 'success', synced_count: 1, failed_count: 0, synced_items: [{ local_id: 'lf', server_id: 'srv-f' }], failed_items: [] },
    } as any);

    const auto = await syncPendingDiagnostics(false);
    expect(auto.synced).toBe(0);

    const manual = await syncPendingDiagnostics(true);
    expect(manual.synced).toBe(1);
  });

  it('runFullSync roda conversas e segundas opiniões, e não fala mais de slm-logs', async () => {
    const resultado = await runFullSync();

    expect(resultado.ran).toBe(true);
    expect(resultado.conversations).toEqual({ synced: 2, failed: 0 });
    expect(resultado.secondOpinions).toEqual({ synced: 1, failed: 0 });
    expect(resultado).not.toHaveProperty('slmLogs');
    expect(vi.mocked(api.post).mock.calls.every(([url]) => !String(url).includes('slm-logs'))).toBe(true);
  });

  it('runFullSync não roda em modo FIELD', async () => {
    mocks.network.connectionMode = 'FIELD';
    seedDiagnostic();

    const result = await runFullSync();

    expect(result.ran).toBe(false);
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });
});

import './test-globals';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const tables: Record<string, any[]> = {
    fila_diagnosticos: [],
    fila_feedbacks: [],
    fila_slm_logs: [],
  };
  const wrap = (arr: any[]) => ({
    rows: { _array: arr, length: arr.length, item: (i: number) => arr[i] },
    rowsAffected: 0,
  });
  const execute = vi.fn(async (sql: string) => {
    const m = sql.trim().toLowerCase().match(/^select \* from (\w+)/);
    if (m) return wrap([...tables[m[1]]]);
    return wrap([]);
  });
  return { tables, execute };
});

vi.mock('../db/sqlite', () => ({ dbDriver: { execute: mocks.execute } }));
vi.mock('../lib/syncService', () => ({
  runFullSync: vi.fn(async () => ({
    ran: true,
    diagnostics: { synced: 1, failed: 0 },
    feedbacks: { synced: 0, failed: 0 },
    slmLogs: { synced: 0, failed: 0 },
    catalogUpdated: false,
  })),
}));

import { runFullSync } from '../lib/syncService';
import { useSyncStore } from './useSyncStore';

describe('useSyncStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tables.fila_diagnosticos.length = 0;
    mocks.tables.fila_feedbacks.length = 0;
    mocks.tables.fila_slm_logs.length = 0;
    useSyncStore.setState({
      pendingDiagnostics: 0, pendingFeedbacks: 0, pendingSlmLogs: 0,
      isSyncing: false, lastSyncAt: null, lastError: null,
    });
  });

  it('refreshCounts conta PENDING e FAILED (T5.9 logic-level)', async () => {
    mocks.tables.fila_diagnosticos.push(
      { local_id: 'a', sync_status: 'PENDING' },
      { local_id: 'b', sync_status: 'FAILED' },
      { local_id: 'c', sync_status: 'SYNCED' },
    );
    mocks.tables.fila_slm_logs.push({ session_id: 's', sync_status: 'PENDING' });

    await useSyncStore.getState().refreshCounts();

    expect(useSyncStore.getState().pendingDiagnostics).toBe(2);
    expect(useSyncStore.getState().pendingFeedbacks).toBe(0);
    expect(useSyncStore.getState().pendingSlmLogs).toBe(1);
  });

  it('syncNow roda o sync, atualiza lastSyncAt e contagens', async () => {
    await useSyncStore.getState().syncNow({ manual: true });

    expect(vi.mocked(runFullSync)).toHaveBeenCalledWith({ includeFailed: true });
    expect(useSyncStore.getState().isSyncing).toBe(false);
    expect(useSyncStore.getState().lastSyncAt).toBeTruthy();
    expect(useSyncStore.getState().lastError).toBeNull();
  });

  it('syncNow concorrente é no-op (guard isSyncing)', async () => {
    let resolveSync!: () => void;
    vi.mocked(runFullSync).mockImplementation(
      () => new Promise((resolve) => {
        resolveSync = () => resolve({
          ran: true,
          diagnostics: { synced: 0, failed: 0 },
          feedbacks: { synced: 0, failed: 0 },
          slmLogs: { synced: 0, failed: 0 },
          catalogUpdated: false,
        });
      })
    );

    const first = useSyncStore.getState().syncNow();
    expect(useSyncStore.getState().isSyncing).toBe(true);

    const second = useSyncStore.getState().syncNow();
    resolveSync();
    await Promise.all([first, second]);

    expect(vi.mocked(runFullSync)).toHaveBeenCalledTimes(1);
  });

  it('erro no sync popula lastError', async () => {
    vi.mocked(runFullSync).mockRejectedValue(new Error('Network down'));

    await useSyncStore.getState().syncNow();

    expect(useSyncStore.getState().lastError).toBe('Network down');
    expect(useSyncStore.getState().isSyncing).toBe(false);
  });
});

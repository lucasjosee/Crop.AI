import '../store/test-globals';
import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  banco: null as null | { execute: (sql: string, params?: any[]) => Promise<any> },
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-secure-store', () => ({
  setItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock('../db/sqlite', async (importOriginal) => {
  const real = await importOriginal<typeof import('../db/sqlite')>();
  return { ...real, dbDriver: { execute: (sql: string, p?: any[]) => mocks.banco!.execute(sql, p) } };
});
vi.mock('./api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('./catalogSyncService', () => ({ syncCatalog: vi.fn() }));
vi.mock('./conversationSyncService', () => ({ syncPendingConversations: vi.fn() }));
vi.mock('./pendingSecondOpinionService', () => ({ sweepPendingSecondOpinions: vi.fn() }));
vi.mock('./diagnosticImageUploadService', () => ({ ensureDiagnosticImageUploaded: vi.fn() }));
vi.mock('../store/useNetworkStore', () => ({ useNetworkStore: { getState: () => ({}) } }));
vi.mock('../store/useAuthStore', () => ({ useAuthStore: { getState: () => ({}) } }));

import { criarBancoMigrado } from '../db/sqliteReal.testutil';
import { api } from './api';
import { syncPendingFeedbacks } from './syncService';

describe('syncPendingFeedbacks em SQLite real', () => {
  it('vincula cada feedback ao server_id do seu diagnóstico, sem tocar nos outros', async () => {
    const db = (mocks.banco = await criarBancoMigrado());
    const doenca = (await db.execute('SELECT id FROM doencas LIMIT 1;')).rows._array[0].id;
    for (const [id, server] of [['a', 'srv-a'], ['b', null], ['c', 'srv-c']]) {
      await db.execute(
        `INSERT INTO fila_diagnosticos (local_id, server_id, image_uri, doenca_id, modelo_usado)
         VALUES (?, ?, 'file:///x.jpg', ?, 'm');`,
        [id, server, doenca]
      );
    }
    await db.execute(
      `INSERT INTO fila_feedbacks (id, diagnostic_local_id, is_correct) VALUES ('f1', 'a', 1), ('f2', 'b', 0);`
    );
    vi.mocked(api.post).mockResolvedValue({
      data: { processed_count: 2, failed_count: 0, processed_items: [{ diagnostic_local_id: 'a' }, { diagnostic_local_id: 'b' }], failed_items: [] },
    } as any);

    await syncPendingFeedbacks();

    const corpo = vi.mocked(api.post).mock.calls[0][1] as any;
    expect(corpo.feedbacks.map((f: any) => [f.diagnostic_local_id, f.diagnostic_server_id])).toEqual([
      ['a', 'srv-a'],
      ['b', null],
    ]);
    const st = await db.execute("SELECT sync_status FROM fila_feedbacks WHERE id = 'f1';");
    expect(st.rows._array[0].sync_status).toBe('SYNCED');
  });
});

import { create } from 'zustand';
import { dbDriver } from '../db/sqlite';
import { runFullSync } from '../lib/syncService';

interface SyncState {
  pendingDiagnostics: number;
  pendingFeedbacks: number;
  pendingConversations: number;
  isSyncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  refreshCounts: () => Promise<void>;
  syncNow: (opts?: { manual?: boolean }) => Promise<void>;
}

function countUnsynced(res: any): number {
  let total = 0;
  for (let i = 0; i < res.rows.length; i++) {
    const status = res.rows.item(i).sync_status;
    if (status === 'PENDING' || status === 'FAILED') total += 1;
  }
  return total;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  pendingDiagnostics: 0,
  pendingFeedbacks: 0,
  pendingConversations: 0,
  isSyncing: false,
  lastSyncAt: null,
  lastError: null,

  refreshCounts: async () => {
    try {
      const [diags, feedbacks, conversas] = await Promise.all([
        dbDriver.execute('SELECT * FROM fila_diagnosticos;'),
        dbDriver.execute('SELECT * FROM fila_feedbacks;'),
        dbDriver.execute(
          `SELECT s.id FROM chat_sessions s
            WHERE s.sync_status IN ('PENDING', 'FAILED')
               OR EXISTS (SELECT 1 FROM chat_messages m
                           WHERE m.session_id = s.id AND m.sync_status = 'PENDING');`
        ),
      ]);
      set({
        pendingDiagnostics: countUnsynced(diags),
        pendingFeedbacks: countUnsynced(feedbacks),
        // A consulta já filtra; aqui é contagem de linhas, não de status.
        pendingConversations: conversas.rows.length,
      });
    } catch {
      console.warn('[SyncStore] Falha ao contar pendências.');
    }
  },

  syncNow: async (opts = {}) => {
    if (get().isSyncing) return;
    set({ isSyncing: true, lastError: null });
    try {
      const result = await runFullSync({ includeFailed: !!opts.manual });
      if (result.ran) {
        set({ lastSyncAt: new Date().toISOString() });
      }
    } catch (err: any) {
      set({ lastError: err?.message ?? 'Falha na sincronização' });
    } finally {
      set({ isSyncing: false });
      await get().refreshCounts();
    }
  },
}));

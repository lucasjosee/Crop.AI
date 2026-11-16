import { create } from 'zustand';
import { dbDriver } from '../db/sqlite';
import { runFullSync } from '../lib/syncService';
import { idDoUsuarioAtualOuNulo } from '../lib/usuarioAtual';

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

export const useSyncStore = create<SyncState>((set, get) => ({
  pendingDiagnostics: 0,
  pendingFeedbacks: 0,
  pendingConversations: 0,
  isSyncing: false,
  lastSyncAt: null,
  lastError: null,

  refreshCounts: async () => {
    try {
      // Cada conta conta só o que é seu. Sem usuário (logout), não há o que contar.
      const userId = idDoUsuarioAtualOuNulo();
      if (!userId) {
        set({ pendingDiagnostics: 0, pendingFeedbacks: 0, pendingConversations: 0 });
        return;
      }
      const contar = async (sql: string): Promise<number> => {
        const res = await dbDriver.execute(sql, [userId]);
        return Number(res.rows.item(0)?.n ?? 0);
      };
      const [diags, feedbacks, conversas] = await Promise.all([
        contar(`SELECT COUNT(*) AS n FROM fila_diagnosticos WHERE user_id = ? AND sync_status IN ('PENDING', 'FAILED');`),
        contar(`SELECT COUNT(*) AS n FROM fila_feedbacks
            WHERE sync_status IN ('PENDING', 'FAILED')
              AND diagnostic_local_id IN (SELECT local_id FROM fila_diagnosticos WHERE user_id = ?);`),
        contar(
          `SELECT COUNT(*) AS n FROM chat_sessions s
            WHERE s.user_id = ?
              AND (s.sync_status IN ('PENDING', 'FAILED')
                   OR EXISTS (SELECT 1 FROM chat_messages m
                               WHERE m.session_id = s.id AND m.sync_status = 'PENDING'));`
        ),
      ]);
      set({
        pendingDiagnostics: diags,
        pendingFeedbacks: feedbacks,
        pendingConversations: conversas,
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
      if (result.falhas.length > 0) {
        set({ lastError: `Etapas do sync com falha: ${result.falhas.join(', ')}` });
      }
    } catch (err: any) {
      set({ lastError: err?.message ?? 'Falha na sincronização' });
    } finally {
      set({ isSyncing: false });
      await get().refreshCounts();
    }
  },
}));

import './test-globals';
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
vi.mock('../lib/usuarioAtual', () => ({ idDoUsuarioAtualOuNulo: () => 'A' }));
vi.mock('../lib/syncService', () => ({ runFullSync: vi.fn() }));

import { criarBancoMigrado } from '../db/sqliteReal.testutil';
import { useSyncStore } from './useSyncStore';

describe('useSyncStore.refreshCounts em SQLite real', () => {
  it('conta só PENDING e FAILED, e a conversa pendente por sessão ou por mensagem', async () => {
    const db = (mocks.banco = await criarBancoMigrado());
    const doenca = (await db.execute('SELECT id FROM doencas LIMIT 1;')).rows._array[0].id;
    for (const [id, status] of [['a', 'PENDING'], ['b', 'FAILED'], ['c', 'SYNCED'], ['d', 'SYNCING']]) {
      await db.execute(
        `INSERT INTO fila_diagnosticos (local_id, image_uri, doenca_id, modelo_usado, sync_status, user_id)
         VALUES (?, 'file:///x.jpg', ?, 'm', ?, 'A');`,
        [id, doenca, status]
      );
    }
    await db.execute(
      "INSERT INTO fila_feedbacks (id, diagnostic_local_id, is_correct, sync_status) VALUES ('f1', 'a', 1, 'PENDING'), ('f2', 'c', 0, 'SYNCED');"
    );
    // s1: sessão SYNCED com mensagem PENDING (conta); s2: tudo SYNCED (não conta); s3: sessão PENDING (conta)
    for (const [id, status] of [['s1', 'SYNCED'], ['s2', 'SYNCED'], ['s3', 'PENDING']]) {
      await db.execute(
        "INSERT INTO chat_sessions (id, title, created_at, updated_at, sync_status, user_id) VALUES (?, 't', 'x', 'x', ?, 'A');",
        [id, status]
      );
    }
    await db.execute(
      `INSERT INTO chat_messages (id, session_id, role, content, created_at, sync_status)
       VALUES ('m1', 's1', 'user', 'oi', 'x', 'PENDING'), ('m2', 's2', 'user', 'oi', 'x', 'SYNCED');`
    );

    await useSyncStore.getState().refreshCounts();

    const e = useSyncStore.getState();
    expect([e.pendingDiagnostics, e.pendingFeedbacks, e.pendingConversations]).toEqual([2, 1, 2]);
  });
});

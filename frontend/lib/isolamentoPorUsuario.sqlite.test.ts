import '../store/test-globals';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  banco: null as null | { execute: (sql: string, params?: any[]) => Promise<any> },
  usuario: 'A',
  crossValidate: vi.fn(async (_: unknown) => undefined),
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
vi.mock('./usuarioAtual', () => ({
  idDoUsuarioAtual: () => mocks.usuario,
  idDoUsuarioAtualOuNulo: () => mocks.usuario,
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'id' }));
vi.mock('./api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('./diagnosticImageUploadService', () => ({ ensureDiagnosticImageUploaded: vi.fn(async () => 'k') }));
vi.mock('./crossValidationService', () => ({ crossValidateDiagnostic: mocks.crossValidate }));
vi.mock('./diagnosisDetails', () => ({ resolveDiseaseName: vi.fn(async () => 'Doença') }));
vi.mock('./catalogSyncService', () => ({ syncCatalog: vi.fn() }));
vi.mock('../store/useNetworkStore', () => ({ useNetworkStore: { getState: () => ({}) } }));
vi.mock('../store/useAuthStore', () => ({ useAuthStore: { getState: () => ({}) } }));

import { criarBancoMigrado } from '../db/sqliteReal.testutil';
import { api } from './api';
import { listMapSessions, listSessions } from './chatRepository';
import { syncPendingConversations } from './conversationSyncService';
import { readLocalInferencePerformance } from './performanceMetrics';
import { sweepPendingSecondOpinions } from './pendingSecondOpinionService';
import { syncPendingDiagnostics, syncPendingFeedbacks } from './syncService';
import { useSyncStore } from '../store/useSyncStore';

/** Dados de A e de B no mesmo banco: o que um enxerga, o outro não pode. */
async function semear() {
  const db = (mocks.banco = await criarBancoMigrado());
  const doenca = (await db.execute('SELECT id FROM doencas LIMIT 1;')).rows._array[0].id;
  for (const dono of ['A', 'B']) {
    await db.execute(
      `INSERT INTO fila_diagnosticos
         (local_id, image_uri, image_s3_key, latitude, longitude, doenca_id, modelo_usado, tempo_inferencia_ms,
          cross_validation_status, user_id)
       VALUES (?, 'file:///x.jpg', 'k', -12.5, -55.7, ?, 'm', ?, 'SKIPPED', ?);`,
      [`diag-${dono}`, doenca, dono === 'A' ? 100 : 900, dono]
    );
    await db.execute(
      `INSERT INTO fila_feedbacks (id, diagnostic_local_id, is_correct) VALUES (?, ?, 1);`,
      [`fb-${dono}`, `diag-${dono}`]
    );
    await db.execute(
      `INSERT INTO chat_sessions (id, title, origin_diagnostic_local_id, created_at, updated_at, user_id)
       VALUES (?, ?, ?, '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z', ?);`,
      [`sess-${dono}`, `Conversa ${dono}`, `diag-${dono}`, dono]
    );
    await db.execute(
      `INSERT INTO chat_messages (id, session_id, role, content, created_at)
       VALUES (?, ?, 'user', 'oi', '2026-11-01T10:00:00.000Z');`,
      [`msg-${dono}`, `sess-${dono}`]
    );
  }
}

describe('cada conta só lê e envia os próprios dados (SQLite real)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.usuario = 'A';
    await semear();
  });

  it('as listas da Home, de /chat e do mapa devolvem só as do usuário atual', async () => {
    expect((await listSessions()).map((s) => s.id)).toEqual(['sess-A']);
    expect((await listSessions(3)).map((s) => s.id)).toEqual(['sess-A']);
    expect((await listMapSessions()).map((s) => s.sessionId)).toEqual(['sess-A']);

    mocks.usuario = 'B';
    expect((await listSessions()).map((s) => s.id)).toEqual(['sess-B']);
    expect((await listMapSessions()).map((s) => s.sessionId)).toEqual(['sess-B']);
  });

  it('o sync envia só os diagnósticos e feedbacks do dono, e não toca os do outro', async () => {
    vi.mocked(api.post).mockImplementation(async (url: string, corpo: any) => ({
      data: url.includes('feedback')
        ? { processed_count: 1, failed_count: 0, processed_items: corpo.feedbacks.map((f: any) => ({ diagnostic_local_id: f.diagnostic_local_id })), failed_items: [] }
        : { processed_count: 1, failed_count: 0, synced_items: corpo.diagnostics.map((d: any) => ({ local_id: d.local_id, server_id: `srv-${d.local_id}` })), failed_items: [] },
    }) as any);

    await syncPendingDiagnostics('A');
    await syncPendingFeedbacks('A');

    const corpos = vi.mocked(api.post).mock.calls.map(([, c]) => c as any);
    expect(corpos[0].diagnostics.map((d: any) => d.local_id)).toEqual(['diag-A']);
    expect(corpos[1].feedbacks.map((f: any) => f.diagnostic_local_id)).toEqual(['diag-A']);
    const b = await mocks.banco!.execute("SELECT sync_status FROM fila_diagnosticos WHERE local_id = 'diag-B';");
    expect(b.rows._array[0].sync_status).toBe('PENDING');
    const fb = await mocks.banco!.execute("SELECT sync_status FROM fila_feedbacks WHERE id = 'fb-B';");
    expect(fb.rows._array[0].sync_status).toBe('PENDING');
  });

  it('o sync de conversas envia só as sessões do dono', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { synced_items: [], failed_items: [] } } as any);

    for (const includeFailed of [false, true]) {
      vi.mocked(api.post).mockClear();
      await syncPendingConversations('A', includeFailed);
      const corpo = vi.mocked(api.post).mock.calls[0][1] as any;
      expect(corpo.conversations.map((c: any) => c.local_id ?? c.session_id ?? c.id)).toEqual(['sess-A']);
    }
  });

  it('a varredura de segundas opiniões só pega os diagnósticos do dono', async () => {
    await sweepPendingSecondOpinions('A');

    const ids = mocks.crossValidate.mock.calls.map(([arg]) => (arg as any).localId);
    expect(ids).toEqual(['diag-A']);
  });

  it('as contagens e a métrica de desempenho são do dono', async () => {
    await useSyncStore.getState().refreshCounts();
    const e = useSyncStore.getState();
    expect([e.pendingDiagnostics, e.pendingFeedbacks, e.pendingConversations]).toEqual([1, 1, 1]);

    const perf = await readLocalInferencePerformance();
    expect([perf.sampleCount, perf.averageMs]).toEqual([1, 100]);

    mocks.usuario = null as any;
    await useSyncStore.getState().refreshCounts();
    expect(useSyncStore.getState().pendingDiagnostics).toBe(0);
  });
});

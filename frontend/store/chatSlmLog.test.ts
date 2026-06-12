import './test-globals';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const tables: Record<string, any[]> = { fila_slm_logs: [] };
  const wrap = (arr: any[]) => ({
    rows: { _array: arr, length: arr.length, item: (i: number) => arr[i] },
    rowsAffected: 0,
  });
  const execute = vi.fn(async (sql: string, params: any[] = []) => {
    const s = sql.trim().replace(/\s+/g, ' ').toLowerCase();
    if (s.startsWith('select * from fila_slm_logs where session_id = ?')) {
      return wrap(tables.fila_slm_logs.filter((r) => r.session_id === params[0]));
    }
    if (s.startsWith('insert into fila_slm_logs')) {
      tables.fila_slm_logs.push({
        session_id: params[0], started_at: params[1], model_version: params[2],
        interactions_json: params[3], sync_status: params[4], retry_count: params[5],
      });
      return wrap([]);
    }
    if (s.startsWith('update fila_slm_logs set interactions_json = ?, sync_status = ? where session_id = ?')) {
      const row = tables.fila_slm_logs.find((r) => r.session_id === params[2]);
      if (row) { row.interactions_json = params[0]; row.sync_status = params[1]; }
      return wrap([]);
    }
    return wrap([]);
  });
  return { tables, execute };
});

vi.mock('../db/sqlite', () => ({ dbDriver: { execute: mocks.execute } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'fixed-session-uuid' }));

import { useChatStore } from './useChatStore';

describe('useChatStore.logSlmInteraction', () => {
  beforeEach(() => {
    mocks.tables.fila_slm_logs.length = 0;
    vi.clearAllMocks();
  });

  it('primeira interação cria a linha; segunda acumula no interactions_json', async () => {
    const store = useChatStore.getState();

    await store.logSlmInteraction('Como aplico fungicida?', 'Recomenda-se...', 3200);
    expect(mocks.tables.fila_slm_logs).toHaveLength(1);

    await store.logSlmInteraction('E na chuva?', 'Evite aplicar...', 2800);
    expect(mocks.tables.fila_slm_logs).toHaveLength(1);

    const row = mocks.tables.fila_slm_logs[0];
    expect(row.sync_status).toBe('PENDING');
    expect(row.model_version).toBe('gemma-2b-it-q4_k_m');

    const interactions = JSON.parse(row.interactions_json);
    expect(interactions).toHaveLength(2);
    expect(interactions[0]).toMatchObject({ prompt: 'Como aplico fungicida?', latency_ms: 3200, rag_used_documents: [] });
    expect(interactions[1].prompt).toBe('E na chuva?');
  });
});

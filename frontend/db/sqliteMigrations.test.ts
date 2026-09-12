import './../store/test-globals';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-secure-store', () => ({
  setItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import { runMigrationsAndSeed } from './sqlite';

type Row = Record<string, unknown>;

/**
 * Driver que registra o SQL executado e responde a consultas específicas.
 * `answers` casa por substring do SQL; o primeiro que casar responde.
 */
function recordingDriver(startVersion: number, answers: Array<[string, Row[]]> = []) {
  const executed: Array<{ sql: string; params: unknown[] }> = [];
  return {
    executed,
    sql: () => executed.map((e) => e.sql),
    driver: {
      execute: async (sql: string, params: unknown[] = []) => {
        executed.push({ sql, params });
        if (sql.includes('PRAGMA user_version;')) {
          return { rows: { _array: [{ user_version: startVersion }], length: 1, item: () => null } };
        }
        const hit = answers.find(([needle]) => sql.includes(needle));
        const rows = hit ? hit[1] : [];
        return { rows: { _array: rows, length: rows.length, item: (i: number) => rows[i] } };
      },
    },
  };
}

describe('migrations do SQLite (P3.5)', () => {
  it('normaliza para SKIPPED os diagnósticos anteriores à cross-validation', async () => {
    const { driver, sql } = recordingDriver(4);

    await runMigrationsAndSeed(driver as never);

    const backfill = sql().find(
      (s) =>
        s.includes('UPDATE fila_diagnosticos') &&
        s.includes("cross_validation_status = 'SKIPPED'") &&
        s.includes("cross_validation_status = 'PENDING'")
    );
    expect(backfill).toBeDefined();
  });
});

describe('migração v7 — conversas persistidas', () => {
  it('cria chat_sessions e chat_messages com os índices e avança para a v7', async () => {
    const { driver, sql } = recordingDriver(6);

    await runMigrationsAndSeed(driver as never);

    const all = sql().join('\n');
    expect(all).toContain('CREATE TABLE IF NOT EXISTS chat_sessions');
    expect(all).toContain('origin_diagnostic_local_id  TEXT REFERENCES fila_diagnosticos(local_id)');
    expect(all).toContain('CREATE TABLE IF NOT EXISTS chat_messages');
    expect(all).toContain("CHECK(role IN ('user','assistant'))");
    expect(all).toContain("CHECK(source IN ('LOCAL_SLM','CLOUD_LLM'))");
    expect(all).toContain('idx_chat_messages_session');
    expect(all).toContain('idx_chat_sessions_origin');
    expect(sql()).toContain('PRAGMA user_version = 7;');
  });

  it('migra cada sessão de fila_slm_logs para chat_sessions com mensagens PENDING', async () => {
    const legado = {
      session_id: '11111111-1111-4111-8111-111111111111',
      started_at: '2026-06-10T08:00:00.000Z',
      model_version: 'gemma-2b-it-q4_k_m',
      interactions_json: JSON.stringify([
        { prompt: 'Qual a dosagem?', response: '300 mL/ha.', latency_ms: 1200, rag_used_documents: [] },
      ]),
      sync_status: 'SYNCED',
      retry_count: 0,
    };
    const { driver, executed } = recordingDriver(6, [['SELECT * FROM fila_slm_logs', [legado]]]);

    await runMigrationsAndSeed(driver as never);

    const sessionInsert = executed.find((e) => e.sql.includes('INSERT OR IGNORE INTO chat_sessions'));
    expect(sessionInsert).toBeDefined();
    expect(sessionInsert!.params[0]).toBe(legado.session_id);
    expect(sessionInsert!.params[1]).toBe('Qual a dosagem?');

    const messageInserts = executed.filter((e) => e.sql.includes('INSERT INTO chat_messages'));
    expect(messageInserts).toHaveLength(2);
    // usuário primeiro, assistente depois; ambos PENDING mesmo com a origem SYNCED
    expect(messageInserts[0].sql).toContain("'user'");
    expect(messageInserts[0].params).toContain('Qual a dosagem?');
    expect(messageInserts[1].sql).toContain("'assistant'");
    expect(messageInserts[1].sql).toContain("'LOCAL_SLM'");
    expect(messageInserts[1].params).toContain(1200);
    expect(messageInserts[0].sql).toContain("'PENDING'");
    expect(messageInserts[1].sql).toContain("'PENDING'");
  });

  it('ignora sessões legadas sem interações', async () => {
    const vazia = {
      session_id: '22222222-2222-4222-8222-222222222222',
      started_at: '2026-06-10T08:00:00.000Z',
      model_version: 'x',
      interactions_json: '[]',
      sync_status: 'PENDING',
      retry_count: 0,
    };
    const { driver, sql } = recordingDriver(6, [['SELECT * FROM fila_slm_logs', [vazia]]]);

    await runMigrationsAndSeed(driver as never);

    expect(sql().some((s) => s.includes('INSERT OR IGNORE INTO chat_sessions'))).toBe(false);
  });
});

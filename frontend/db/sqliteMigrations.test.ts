import './../store/test-globals';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-secure-store', () => ({
  setItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import { runMigrationsAndSeed } from './sqlite';

/** Driver que só registra o SQL executado, partindo de uma base já na v4. */
function recordingDriver(startVersion: number) {
  const executed: string[] = [];
  return {
    executed,
    driver: {
      execute: async (sql: string) => {
        executed.push(sql);
        if (sql.includes('PRAGMA user_version;')) {
          return { rows: { _array: [{ user_version: startVersion }], length: 1, item: () => null } };
        }
        return { rows: { _array: [], length: 0, item: () => null } };
      },
    },
  };
}

describe('migrations do SQLite (P3.5)', () => {
  // ADD COLUMN ... NOT NULL DEFAULT 'PENDING' preenche o default em todas as
  // linhas pré-existentes. Esses diagnósticos são anteriores à cross-validation
  // e nunca voltam ao fluxo, mas como o valor não é nulo o fallback
  // `?? 'SKIPPED'` do syncService não dispara e eles chegam ao servidor como
  // PENDING para sempre.
  it('normaliza para SKIPPED os diagnósticos anteriores à cross-validation', async () => {
    const { driver, executed } = recordingDriver(4);

    await runMigrationsAndSeed(driver as never);

    const backfill = executed.find(
      (sql) =>
        sql.includes('UPDATE fila_diagnosticos') &&
        sql.includes("cross_validation_status = 'SKIPPED'") &&
        sql.includes("cross_validation_status = 'PENDING'")
    );
    expect(backfill).toBeDefined();
  });
});

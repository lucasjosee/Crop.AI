/// <reference types="node" />
/**
 * Driver de TESTE sobre SQLite de verdade (`node:sqlite`, embutido no Node).
 *
 * O fake de `dbDriver` dos testes comuns não executa SQL: não impõe FK,
 * `UNIQUE`, `COUNT` nem `WHERE`. SQL que dependa de qualquer um deles precisa
 * ser provado aqui. Só testes importam este arquivo; nada do app o importa.
 */
import { createRequire } from 'node:module';
import type { IDatabaseDriver, QueryResult } from './sqlite';

// `createRequire` em vez de `import` estático: o vite não precisa resolver o
// protocolo `node:sqlite`, que muda de estabilidade entre versões do Node.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

/** Statements que devolvem linhas; os demais rodam com `run()`. */
function devolveLinhas(sql: string): boolean {
  const s = sql.trim().replace(/^(--[^\n]*\n|\s)+/, '').toUpperCase();
  if (s.startsWith('SELECT')) return true;
  // `PRAGMA user_version = 10` não devolve linhas; `PRAGMA user_version;` sim.
  return s.startsWith('PRAGMA') && !s.includes('=');
}

export function criarBancoReal(): IDatabaseDriver {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');

  return {
    execute: async (sql: string, params: any[] = []): Promise<QueryResult> => {
      const stmt = db.prepare(sql);
      if (devolveLinhas(sql)) {
        const arr = stmt.all(...params) as any[];
        return {
          rows: { _array: arr, length: arr.length, item: (i: number) => arr[i] },
          rowsAffected: 0,
        };
      }
      const r = stmt.run(...params);
      return {
        rows: { _array: [], length: 0, item: () => undefined },
        rowsAffected: Number(r.changes),
        insertId: Number(r.lastInsertRowid),
      };
    },
  };
}

/** Banco em memória com as migrações e o seed reais já aplicados. */
export async function criarBancoMigrado(): Promise<IDatabaseDriver> {
  // Import tardio: `sqlite.ts` puxa expo-secure-store; o teste que usa este
  // utilitário faz o vi.mock antes de chamar.
  const { runMigrationsAndSeed } = await import('./sqlite');
  const driver = criarBancoReal();
  await runMigrationsAndSeed(driver);
  return driver;
}

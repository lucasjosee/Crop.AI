import './../store/test-globals';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-secure-store', () => ({
  setItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import { criarBancoMigrado, criarBancoReal } from './sqliteReal.testutil';

describe('driver de teste sobre SQLite real', () => {
  it('roda as migrações reais até a versão atual', async () => {
    const db = await criarBancoMigrado();
    const v = await db.execute('PRAGMA user_version;');
    expect(v.rows._array[0].user_version).toBe(11);
    const n = await db.execute('SELECT COUNT(*) AS n FROM doencas;');
    expect(n.rows._array[0].n).toBeGreaterThan(0);
  });

  it('instalação nova e migração da v9 terminam com is_active em doencas', async () => {
    const nova = await criarBancoMigrado();
    const ativas = await nova.execute('SELECT COUNT(*) AS n FROM doencas WHERE is_active = 1;');
    const todas = await nova.execute('SELECT COUNT(*) AS n FROM doencas;');
    expect(ativas.rows._array[0].n).toBe(todas.rows._array[0].n);

    // Banco que parou na v9: sem a coluna, com uma doença; a v10 a acrescenta ativa.
    const antigo = criarBancoReal();
    await antigo.execute('CREATE TABLE doencas (id TEXT PRIMARY KEY, nome_comum TEXT);');
    await antigo.execute("INSERT INTO doencas VALUES ('a', 'A');");
    // A v11 acrescenta user_id às duas raízes, então elas precisam existir.
    await antigo.execute('CREATE TABLE fila_diagnosticos (local_id TEXT PRIMARY KEY);');
    await antigo.execute('CREATE TABLE chat_sessions (id TEXT PRIMARY KEY);');
    await antigo.execute("INSERT INTO fila_diagnosticos VALUES ('d');");
    await antigo.execute('PRAGMA user_version = 9;');
    const { runMigrationsAndSeed } = await import('./sqlite');
    await runMigrationsAndSeed(antigo);
    expect((await antigo.execute('SELECT is_active FROM doencas;')).rows._array[0].is_active).toBe(1);
    expect((await antigo.execute('PRAGMA user_version;')).rows._array[0].user_version).toBe(11);
    // Linha antiga fica sem dono; quem a reivindica é a próxima conta.
    expect((await antigo.execute('SELECT user_id FROM fila_diagnosticos;')).rows._array[0].user_id).toBeNull();
  });

  it('impõe chave estrangeira', async () => {
    const db = await criarBancoMigrado();
    await expect(
      db.execute(
        `INSERT INTO fila_diagnosticos (local_id, image_uri, doenca_id, modelo_usado)
         VALUES ('x', 'file:///x.jpg', 'doenca-que-nao-existe', 'm');`
      )
    ).rejects.toThrow(/FOREIGN KEY/i);
  });
});

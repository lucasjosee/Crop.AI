import './../store/test-globals';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-secure-store', () => ({
  setItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import { criarBancoMigrado } from './sqliteReal.testutil';

describe('driver de teste sobre SQLite real', () => {
  it('roda as migrações reais até a versão atual', async () => {
    const db = await criarBancoMigrado();
    const v = await db.execute('PRAGMA user_version;');
    expect(v.rows._array[0].user_version).toBe(9);
    const n = await db.execute('SELECT COUNT(*) AS n FROM doencas;');
    expect(n.rows._array[0].n).toBeGreaterThan(0);
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

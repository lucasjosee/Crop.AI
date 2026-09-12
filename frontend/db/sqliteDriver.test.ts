import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-secure-store', () => ({
  setItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import { dbDriver } from './sqlite';

describe('dbDriver antes de initDatabase()', () => {
  // Sem o target web, não existe mais um driver em memória de fallback. Usar o
  // banco antes de inicializá-lo precisa falhar alto, não devolver vazio.
  it('rejeita com mensagem clara em vez de simular sucesso', async () => {
    await expect(dbDriver.execute('SELECT 1;')).rejects.toThrow(
      'Banco local não inicializado. Chame initDatabase() antes.'
    );
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

const mocks = vi.hoisted(() => ({
  setItemAsync: vi.fn(async () => {}),
  getItemAsync: vi.fn(async () => 'valor'),
  deleteItemAsync: vi.fn(async () => {}),
}));

vi.mock('expo-secure-store', () => ({
  setItemAsync: mocks.setItemAsync,
  getItemAsync: mocks.getItemAsync,
  deleteItemAsync: mocks.deleteItemAsync,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));

import { secureStorage } from './secureStorage';

describe('secureStorage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('grava no Keychain/Keystore restrito ao aparelho desbloqueado', async () => {
    await secureStorage.setItem('access_token', 'abc');
    expect(mocks.setItemAsync).toHaveBeenCalledWith('access_token', 'abc', {
      keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    });
  });

  it('lê com a mesma restrição', async () => {
    expect(await secureStorage.getItem('access_token')).toBe('valor');
    expect(mocks.getItemAsync).toHaveBeenCalledWith('access_token', {
      keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    });
  });

  it('não depende de localStorage nem de __DEV__', () => {
    const fonte = secureStorage.setItem.toString() + secureStorage.getItem.toString();
    expect(fonte).not.toContain('localStorage');
    expect(fonte).not.toContain('__DEV__');
  });
});

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export const secureStorage = {
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      if (typeof __DEV__ === 'undefined' || !__DEV__) {
        throw new Error('Armazenamento de sessão web desabilitado em produção.');
      }
      localStorage.setItem(key, value);
      return;
    }
    if (Platform.OS === 'web' && typeof localStorage === 'undefined') {
      return; // No-op em testes CLI
    }

    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },

  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      if (typeof __DEV__ === 'undefined' || !__DEV__) {
        throw new Error('Armazenamento de sessão web desabilitado em produção.');
      }
      return localStorage.getItem(key);
    }
    if (Platform.OS === 'web' && typeof localStorage === 'undefined') {
      return null;
    }

    return SecureStore.getItemAsync(key, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },

  async removeItem(key: string): Promise<void> {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      if (typeof __DEV__ === 'undefined' || !__DEV__) {
        throw new Error('Armazenamento de sessão web desabilitado em produção.');
      }
      localStorage.removeItem(key);
      return;
    }
    if (Platform.OS === 'web' && typeof localStorage === 'undefined') {
      return;
    }

    await SecureStore.deleteItemAsync(key);
  }
};

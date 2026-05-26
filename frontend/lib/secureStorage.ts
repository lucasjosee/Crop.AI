import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export const secureStorage = {
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      try {
        // AVISO DE SEGURANÇA: localStorage na web não é criptograficamente seguro.
        // É usado apenas como fallback/simulação de desenvolvimento para ambiente web.
        // Em produção mobile, o SecureStore (Keychain no iOS / Keystore no Android) é utilizado.
        localStorage.setItem(key, value);
      } catch (e) {
        console.warn('[SecureStorage] LocalStorage set failed:', e);
      }
      return;
    }
    if (Platform.OS === 'web' && typeof localStorage === 'undefined') {
      return; // No-op em testes CLI
    }

    try {
      await SecureStore.setItemAsync(key, value);
    } catch (e) {
      console.error(`[SecureStorage] Failed to set secure item [${key}]:`, e);
    }
  },

  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        console.warn('[SecureStorage] LocalStorage get failed:', e);
        return null;
      }
    }
    if (Platform.OS === 'web' && typeof localStorage === 'undefined') {
      return null;
    }

    try {
      return await SecureStore.getItemAsync(key);
    } catch (e) {
      console.error(`[SecureStorage] Failed to get secure item [${key}]:`, e);
      return null;
    }
  },

  async removeItem(key: string): Promise<void> {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        console.warn('[SecureStorage] LocalStorage remove failed:', e);
      }
      return;
    }
    if (Platform.OS === 'web' && typeof localStorage === 'undefined') {
      return;
    }

    try {
      await SecureStore.deleteItemAsync(key);
    } catch (e) {
      console.error(`[SecureStorage] Failed to remove secure item [${key}]:`, e);
    }
  }
};

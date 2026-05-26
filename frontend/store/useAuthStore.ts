import { create } from 'zustand';
import { secureStorage } from '../lib/secureStorage';
import { api } from '../lib/api';

export interface User {
  id: string;
  email: string;
  role: string;
  nome?: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (nome: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loadStoredSession: () => Promise<void>;
  setTokens: (accessToken: string, refreshToken: string) => Promise<void>;
}

// Helper simples para decodificar JWT no React Native/Web sem dependências adicionais
function decodeJwt(token: string): any {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    
    // Tratamento para React Native e Web
    let jsonPayload;
    if (typeof atob !== 'undefined') {
      jsonPayload = atob(base64);
    } else {
      // Fallback para ambientes sem atob global
      const { Buffer } = require('buffer');
      jsonPayload = Buffer.from(base64, 'base64').toString('binary');
    }
    
    const escaped = jsonPayload
      .split('')
      .map((c: string) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join('');
      
    return JSON.parse(decodeURIComponent(escaped));
  } catch (e) {
    console.error('[JWT Decode Error] Failed to decode token:', e);
    return null;
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,
  isLoading: true,

  loadStoredSession: async () => {
    try {
      set({ isLoading: true });
      const accessToken = await secureStorage.getItem('access_token');
      const refreshToken = await secureStorage.getItem('refresh_token');
      const storedEmail = await secureStorage.getItem('user_email');
      const storedNome = await secureStorage.getItem('user_nome');

      if (accessToken && refreshToken) {
        const decoded = decodeJwt(accessToken);
        if (decoded && decoded.exp * 1000 > Date.now()) {
          // Token de acesso ainda é válido
          set({
            user: {
              id: decoded.sub,
              role: decoded.role,
              email: storedEmail || '',
              nome: storedNome || '',
            },
            accessToken,
            isAuthenticated: true,
          });
          set({ isLoading: false });
          return;
        } else if (refreshToken) {
          // Token expirou mas temos refresh token. Tentaremos o refresh imediato.
          try {
            console.log('[AuthStore] Access token expired, attempting silent refresh on boot...');
            const response = await api.post('/api/v1/auth/refresh', {
              refresh_token: refreshToken,
            });
            const { access_token, refresh_token } = response.data;
            await get().setTokens(access_token, refresh_token);
            set({ isLoading: false });
            return;
          } catch (err) {
            console.warn('[AuthStore] Boot refresh failed, clearing session.', err);
          }
        }
      }
    } catch (e) {
      console.error('[AuthStore] Failed to load stored session:', e);
    }
    
    // Se falhar ou expirar tudo
    set({ user: null, accessToken: null, isAuthenticated: false, isLoading: false });
  },

  login: async (email, password) => {
    try {
      set({ isLoading: true });
      
      const response = await api.post('/api/v1/auth/login', {
        email,
        password,
        device_info: PlatformInfo(),
      });

      const { access_token, refresh_token } = response.data;
      const decoded = decodeJwt(access_token);

      if (!decoded) {
        throw new Error('Falha ao decodificar token de acesso recebido do servidor.');
      }

      const userProfile = {
        id: decoded.sub,
        role: decoded.role,
        email: email,
        nome: email.split('@')[0], // Fallback enquanto não temos GET /me
      };

      // Persistir no storage seguro
      await secureStorage.setItem('access_token', access_token);
      await secureStorage.setItem('refresh_token', refresh_token);
      await secureStorage.setItem('user_email', email);
      await secureStorage.setItem('user_nome', userProfile.nome);

      set({
        user: userProfile,
        accessToken: access_token,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  register: async (nome, email, password) => {
    try {
      set({ isLoading: true });
      
      const response = await api.post('/api/v1/auth/register', {
        nome,
        email,
        password,
      });

      const { user } = response.data;

      // Opcional: auto-login após registro para melhorar UX
      set({ isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  logout: async () => {
    try {
      set({ isLoading: true });
      const refreshToken = await secureStorage.getItem('refresh_token');
      
      if (refreshToken && get().accessToken) {
        try {
          // Chamar rota de logout no backend
          await api.post('/api/v1/auth/logout', { refresh_token: refreshToken });
        } catch (e) {
          console.warn('[AuthStore] Logout request to backend failed (possibly offline). Continuing local logout.', e);
        }
      }
    } finally {
      // Limpar storage local sempre
      await secureStorage.removeItem('access_token');
      await secureStorage.removeItem('refresh_token');
      await secureStorage.removeItem('user_email');
      await secureStorage.removeItem('user_nome');

      set({
        user: null,
        accessToken: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },

  setTokens: async (accessToken, refreshToken) => {
    const decoded = decodeJwt(accessToken);
    if (!decoded) return;

    const storedEmail = await secureStorage.getItem('user_email');
    const storedNome = await secureStorage.getItem('user_nome');

    await secureStorage.setItem('access_token', accessToken);
    await secureStorage.setItem('refresh_token', refreshToken);

    set({
      accessToken,
      user: {
        id: decoded.sub,
        role: decoded.role,
        email: storedEmail || '',
        nome: storedNome || '',
      },
      isAuthenticated: true,
    });
  },
}));

function PlatformInfo(): string {
  if (Platform.OS === 'web') {
    return 'Expo Web (Browser)';
  }
  return `${Platform.OS === 'ios' ? 'iOS' : 'Android'} Device`;
}

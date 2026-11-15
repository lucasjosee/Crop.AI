import axios from 'axios';
import { secureStorage } from './secureStorage';

declare module 'axios' {
  export interface InternalAxiosRequestConfig {
    _retry?: boolean;
  }
}

// URL base da API. Em ambiente móvel (Android/iOS), 'localhost' não funciona,
// então usamos fallback dinâmico para IP se necessário ou porta 3000 por padrão.
// Usamos process.env.EXPO_PUBLIC_API_URL se configurado no monorepo .env
const baseURL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

export const api = axios.create({
  baseURL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * O servidor recusou o refresh? Só 400, 401 e 403 contam: o token foi
 * rejeitado e não adianta tentar de novo. Sem resposta (rede, timeout), 429 e
 * 5xx são falha de transporte — a sessão continua valendo e os tokens ficam
 * onde estão, porque o produtor em campo fica horas sem sinal (ADR 0006).
 */
export function refreshFoiRecusado(erro: unknown): boolean {
  const status = (erro as { response?: { status?: number } } | null)?.response?.status;
  return status === 400 || status === 401 || status === 403;
}

let refreshInFlight: Promise<string> | null = null;

/**
 * Rotaciona o par de tokens. Chamadas concorrentes compartilham a mesma
 * requisição: apresentar o mesmo refresh token duas vezes faz o servidor
 * detectar reuso e revogar todas as sessões do usuário. É o único caminho de
 * refresh do app — o interceptor do axios e o CloudEngine passam por aqui.
 */
export function refreshAccessToken(): Promise<string> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    // Declarado fora do try para continuar acessível no catch; só fica
    // undefined se o próprio import dinâmico rejeitar (inalcançável hoje —
    // módulo local, já no bundle).
    let useAuthStore: (typeof import('../store/useAuthStore'))['useAuthStore'] | undefined;
    let semToken = false;
    try {
      // import dinâmico preguiçoso evita o ciclo api.ts <-> useAuthStore.ts
      ({ useAuthStore } = await import('../store/useAuthStore'));
      const refreshToken = await secureStorage.getItem('refresh_token');
      if (!refreshToken) {
        semToken = true;
        throw new Error('Refresh token não encontrado no Secure Store local.');
      }
      const response = await api.post('/api/v1/auth/refresh', { refresh_token: refreshToken });
      const { access_token, refresh_token: newRefreshToken } = response.data;
      await useAuthStore.getState().setTokens(access_token, newRefreshToken);
      return access_token as string;
    } catch (error) {
      if (semToken || refreshFoiRecusado(error)) {
        console.warn('[API] Refresh recusado pelo servidor ou sem token guardado. Encerrando a sessão.');
        await useAuthStore?.getState().logout();
      } else {
        console.warn('[API] Refresh falhou por transporte (sem rede, timeout ou 5xx). A sessão continua.');
      }
      throw error;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

// Interceptor de Requisição - Adiciona Token JWT
api.interceptors.request.use(
  async (config) => {
    const { useAuthStore } = require('../store/useAuthStore');
    const token = useAuthStore.getState().accessToken;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Interceptor de Resposta - Rotação Automática de Refresh Token com Mutex
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Evita loop infinito se as rotas de auth falharem
    if (
      originalRequest.url?.includes('/auth/refresh') ||
      originalRequest.url?.includes('/auth/login') ||
      originalRequest.url?.includes('/auth/register')
    ) {
      return Promise.reject(error);
    }

    const status = error.response?.status;
    const errorData = error.response?.data?.error;
    const errorCode = errorData?.code;

    // Se retornar 401 e for expirado
    if (status === 401 && errorCode === 'TOKEN_EXPIRED' && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const token = await refreshAccessToken();
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return api(originalRequest);
      } catch (refreshError) {
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

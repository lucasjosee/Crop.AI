import axios from 'axios';
import { useAuthStore } from '../store/useAuthStore';
import { secureStorage } from './secureStorage';

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

let isRefreshing = false;
let failedRequestsQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: any) => void;
}> = [];

// Processa a fila de requisições concorrentes que aguardavam a rotação do token
const processQueue = (error: any, token: string | null = null) => {
  failedRequestsQueue.forEach((promise) => {
    if (error) {
      promise.reject(error);
    } else if (token) {
      promise.resolve(token);
    }
  });
  failedRequestsQueue = [];
};

// Interceptor de Requisição - Adiciona Token JWT
api.interceptors.request.use(
  async (config) => {
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

      // Se já houver uma rotação de token em andamento, enfileira a requisição concorrente
      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          failedRequestsQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch((err) => {
            return Promise.reject(err);
          });
      }

      isRefreshing = true;

      try {
        const refreshToken = await secureStorage.getItem('refresh_token');
        if (!refreshToken) {
          throw new Error('Refresh token não encontrado no Secure Store local.');
        }

        console.log('[API Interceptor] Access Token expirado. Solicitando rotação de token...');
        const response = await api.post('/api/v1/auth/refresh', {
          refresh_token: refreshToken,
        });

        const { access_token, refresh_token: new_refresh_token } = response.data;

        // Atualiza a store global e o Secure Store com o novo par de tokens de forma atômica
        await useAuthStore.getState().setTokens(access_token, new_refresh_token);

        // Desbloqueia e re-executa todas as requisições concorrentes pendentes na fila
        processQueue(null, access_token);

        // Atualiza a requisição original falhada e a executa novamente
        originalRequest.headers.Authorization = `Bearer ${access_token}`;
        return api(originalRequest);
      } catch (refreshError: any) {
        // Se a rotação falhar (ex: 403 REFRESH_DENIED), rejeita toda a fila de espera
        processQueue(refreshError, null);

        // Força deslogar limpando o estado do app e chaves locais
        console.warn('[API Interceptor] Falha crítica na rotação do Refresh Token. Forçando Logout.', refreshError?.message);
        await useAuthStore.getState().logout();

        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

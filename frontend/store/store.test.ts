import './test-globals';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useNetworkStore } from './useNetworkStore';
import { useAuthStore } from './useAuthStore';
import { api } from '../lib/api';
import { secureStorage } from '../lib/secureStorage';

// -------------------------------------------------------------
// MOCKS para Ambiente de Testes Unitários
// -------------------------------------------------------------
vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
}));

vi.mock('@react-native-community/netinfo', () => ({
  default: {
    addEventListener: vi.fn(),
  },
}));

vi.mock('expo-secure-store', () => ({
  setItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

vi.mock('../lib/secureStorage', () => ({
  secureStorage: {
    setItem: vi.fn(),
    getItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
}));

vi.mock('expo-crypto', () => ({
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2),
}));

// -------------------------------------------------------------
// Suíte de Testes para Network Sensing
// -------------------------------------------------------------
describe('useNetworkStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve iniciar no modo PROBING por padrão', () => {
    const state = useNetworkStore.getState();
    expect(state.connectionMode).toBe('PROBING');
    expect(state.consecutiveFailures).toBe(0);
  });

  it('deve transicionar para ONLINE quando o health check responde 200 OK com baixa latência', async () => {
    const mockGet = vi.spyOn(api, 'get').mockResolvedValueOnce({
      status: 200,
      data: { status: 'ok' },
    });

    const store = useNetworkStore.getState();
    await store.checkConnection();

    expect(mockGet).toHaveBeenCalled();
    expect(useNetworkStore.getState().connectionMode).toBe('ONLINE');
    expect(useNetworkStore.getState().consecutiveFailures).toBe(0);
  });

  it('deve transicionar para FIELD após falhas consecutivas de conexão', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(api, 'get').mockRejectedValue({
        message: 'Network Error',
      });

      useNetworkStore.setState({
        connectionMode: 'PROBING',
        consecutiveFailures: 0,
      });

      const store = useNetworkStore.getState();

      // Primeira falha (agenda Quick retry após 1000ms)
      const promise1 = store.checkConnection();
      await promise1;
      expect(useNetworkStore.getState().consecutiveFailures).toBe(1);
      expect(useNetworkStore.getState().connectionMode).toBe('PROBING');

      // Avançar o tempo para que o Quick retry seja disparado e falhe também (segunda falha automática)
      await vi.advanceTimersByTimeAsync(1000);
      expect(useNetworkStore.getState().consecutiveFailures).toBe(2);
      expect(useNetworkStore.getState().connectionMode).toBe('PROBING'); // Ainda em PROBING devido ao debounce

      // Avançar o tempo do debounceFieldTimer (3000ms) para efetuar a transição
      await vi.advanceTimersByTimeAsync(3000);
      expect(useNetworkStore.getState().connectionMode).toBe('FIELD');
    } finally {
      vi.useRealTimers();
    }
  });
});

// -------------------------------------------------------------
// Suíte de Testes para useAuthStore
// -------------------------------------------------------------
describe('useAuthStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,
    });
  });

  it('deve ter estado não autenticado por padrão', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
  });

  it('deve autenticar usando mock fallback se houver falha de rede (quando __DEV__ for verdadeiro)', async () => {
    const originalDev = (globalThis as any).__DEV__;
    (globalThis as any).__DEV__ = true;

    try {
      vi.spyOn(api, 'post').mockRejectedValueOnce({
        code: 'ERR_NETWORK',
        message: 'Network Error',
      });

      await useAuthStore.getState().login('produtor@fazenda.com', 'senha123456');

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user?.role).toBe('Produtor');
      expect(state.accessToken).toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    } finally {
      (globalThis as any).__DEV__ = originalDev;
    }
  });

  it('deve falhar o login se houver erro de rede e __DEV__ for falso', async () => {
    const originalDev = (globalThis as any).__DEV__;
    (globalThis as any).__DEV__ = false;

    try {
      vi.spyOn(api, 'post').mockRejectedValueOnce({
        code: 'ERR_NETWORK',
        message: 'Network Error',
      });

      await expect(
        useAuthStore.getState().login('produtor@fazenda.com', 'senha123456')
      ).rejects.toBeDefined();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
    } finally {
      (globalThis as any).__DEV__ = originalDev;
    }
  });

  it('deve carregar sessão armazenada válida decodificando o token', async () => {
    const mockPayload = {
      sub: 'user-789',
      role: 'Produtor',
      exp: Math.floor((Date.now() + 3600000) / 1000),
    };
    const payloadStr = JSON.stringify(mockPayload);
    const mockPayloadBase64 = require('buffer').Buffer.from(payloadStr).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const mockAccessToken = `header.${mockPayloadBase64}.signature`;

    vi.spyOn(secureStorage, 'getItem').mockImplementation(async (key) => {
      if (key === 'access_token') return mockAccessToken;
      if (key === 'refresh_token') return 'mock-refresh-token';
      if (key === 'user_email') return 'produtor@fazenda.com';
      if (key === 'user_nome') return 'João';
      return null;
    });

    await useAuthStore.getState().loadStoredSession();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user?.id).toBe('user-789');
    expect(state.user?.nome).toBe('João');
    expect(state.accessToken).toBe(mockAccessToken);
  });

  it('deve efetuar logout local limpando estados', async () => {
    useAuthStore.setState({
      user: { id: 'u1', email: 'lucas@fazenda.com', role: 'PRODUTOR' },
      accessToken: 'token_mock',
      isAuthenticated: true,
    });

    vi.spyOn(api, 'post').mockResolvedValueOnce({ data: { status: 'success' } });

    await useAuthStore.getState().logout();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
});

import { useChatStore } from './useChatStore';

describe('useChatStore', () => {
  beforeEach(() => {
    useChatStore.getState().clearHistory();
  });

  it('should add user message and return it', () => {
    const msg = useChatStore.getState().addUserMessage('Olá');
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Olá');
    expect(useChatStore.getState().history).toHaveLength(1);
  });

  it('should append streaming tokens and finalize', () => {
    useChatStore.getState().addUserMessage('Pergunta');
    useChatStore.getState().appendToStreaming('Resposta ');
    useChatStore.getState().appendToStreaming('final.');
    expect(useChatStore.getState().streamingContent).toBe('Resposta final.');

    useChatStore.getState().finalizeStreaming('CLOUD_LLM');
    expect(useChatStore.getState().history).toHaveLength(2);
    expect(useChatStore.getState().history[1].source).toBe('CLOUD_LLM');
    expect(useChatStore.getState().streamingContent).toBe('');
  });

  it('getCloudHistory should return max 20 non-system messages', () => {
    for (let i = 0; i < 25; i++) {
      useChatStore.getState().addUserMessage(`msg ${i}`);
    }
    const cloudHistory = useChatStore.getState().getCloudHistory();
    expect(cloudHistory.length).toBe(20);
  });

  it('getSlmHistory should return max 10 non-system messages', () => {
    for (let i = 0; i < 15; i++) {
      useChatStore.getState().addUserMessage(`msg ${i}`);
    }
    const slmHistory = useChatStore.getState().getSlmHistory();
    expect(slmHistory.length).toBe(10);
  });

  it('condenseForSlm should truncate to 10 messages and add system note', () => {
    for (let i = 0; i < 15; i++) {
      useChatStore.getState().addUserMessage(`msg ${i}`);
    }
    useChatStore.getState().condenseForSlm();
    const { history } = useChatStore.getState();
    const nonSystem = history.filter(m => m.role !== 'system');
    const systemMessages = history.filter(m => m.role === 'system');
    expect(nonSystem.length).toBe(10);
    expect(systemMessages.length).toBe(1);
    expect(systemMessages[0].content).toContain('modo offline');
  });
});

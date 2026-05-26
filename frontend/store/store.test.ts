import './test-globals';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useNetworkStore } from './useNetworkStore';
import { useAuthStore } from './useAuthStore';
import { api } from '../lib/api';
import { dbDriver } from '../db/sqlite';
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

// -------------------------------------------------------------
// Suíte de Testes para WebDatabaseDriver
// -------------------------------------------------------------
describe('WebDatabaseDriver', () => {
  it('deve executar INSERT e SELECT corretamente no WebDatabaseDriver (em memória)', async () => {
    // Limpar fila_diagnosticos para garantir ambiente limpo
    // @ts-ignore - acessando campo privado no mock para limpar estado
    dbDriver.tables.fila_diagnosticos = [];

    const mockId = 'test-local-id';
    const doencaId = 'doenca_ferrugem_asiatica';
    
    // Testar INSERT
    const insertRes = await dbDriver.execute(
      `INSERT INTO fila_diagnosticos (
        local_id, server_id, image_uri, image_s3_key, latitude, longitude, 
        doenca_id, confianca_ia, modelo_usado, tempo_inferencia_ms, sync_status, retry_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [mockId, null, 'file:///path.jpg', null, 0, 0, doencaId, 0.9, 'model_v1', 30, 'PENDING', 0]
    );
    expect(insertRes.rowsAffected).toBe(1);

    // Testar SELECT
    const selectRes = await dbDriver.execute('SELECT * FROM fila_diagnosticos;');
    expect(selectRes.rows.length).toBe(1);
    expect(selectRes.rows.item(0).local_id).toBe(mockId);
    expect(selectRes.rows.item(0).doenca_id).toBe(doencaId);
  });
});

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

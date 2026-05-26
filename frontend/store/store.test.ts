import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useNetworkStore } from './useNetworkStore';
import { useAuthStore } from './useAuthStore';
import { api } from '../lib/api';

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

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
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
    // Mockar resposta de health bem-sucedida rápida
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

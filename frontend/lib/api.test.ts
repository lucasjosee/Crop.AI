import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

const mocks = vi.hoisted(() => ({
  getItem: vi.fn(async (): Promise<string | null> => 'refresh-antigo'),
  setTokens: vi.fn(async () => {}),
  logout: vi.fn(async () => {}),
}));

vi.mock('./secureStorage', () => ({ secureStorage: { getItem: mocks.getItem, setItem: vi.fn(), removeItem: vi.fn() } }));
vi.mock('../store/useAuthStore', () => ({
  useAuthStore: { getState: () => ({ accessToken: 'antigo', setTokens: mocks.setTokens, logout: mocks.logout }) },
}));

import { api, refreshAccessToken, refreshFoiRecusado } from './api';

describe('refreshAccessToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(api, 'post').mockResolvedValue({ data: { access_token: 'novo', refresh_token: 'refresh-novo' } } as never);
  });

  it('rotaciona o par de tokens e devolve o novo access token', async () => {
    const token = await refreshAccessToken();

    expect(token).toBe('novo');
    expect(api.post).toHaveBeenCalledWith('/api/v1/auth/refresh', { refresh_token: 'refresh-antigo' });
    expect(mocks.setTokens).toHaveBeenCalledWith('novo', 'refresh-novo');
  });

  // Dois refreshes concorrentes apresentariam o mesmo refresh token duas vezes;
  // o servidor detecta reuso e revoga todas as sessões do usuário.
  it('chamadas concorrentes compartilham uma única requisição', async () => {
    const [a, b, c] = await Promise.all([refreshAccessToken(), refreshAccessToken(), refreshAccessToken()]);

    expect(a).toBe('novo');
    expect(b).toBe('novo');
    expect(c).toBe('novo');
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('após concluir, uma nova chamada dispara nova requisição', async () => {
    await refreshAccessToken();
    await refreshAccessToken();
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it('recusa do servidor (403) faz logout e rejeita', async () => {
    const recusa = Object.assign(new Error('REFRESH_DENIED'), { response: { status: 403 } });
    vi.spyOn(api, 'post').mockRejectedValue(recusa);

    await expect(refreshAccessToken()).rejects.toBe(recusa);
    expect(mocks.logout).toHaveBeenCalledTimes(1);
  });

  it('falha de rede NÃO faz logout e rejeita', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new Error('Network Error'));

    await expect(refreshAccessToken()).rejects.toThrow('Network Error');
    expect(mocks.logout).not.toHaveBeenCalled();
  });

  it('5xx NÃO faz logout e rejeita', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(Object.assign(new Error('x'), { response: { status: 503 } }));

    await expect(refreshAccessToken()).rejects.toThrow('x');
    expect(mocks.logout).not.toHaveBeenCalled();
  });

  it('sem refresh token guardado, faz logout e rejeita', async () => {
    mocks.getItem.mockResolvedValueOnce(null);

    await expect(refreshAccessToken()).rejects.toThrow('Refresh token não encontrado');
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('libera o mutex mesmo se a rotação falhar, permitindo nova tentativa depois', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(new Error('boom'));
    await expect(refreshAccessToken()).rejects.toThrow('boom');

    vi.spyOn(api, 'post').mockResolvedValue({ data: { access_token: 'novo', refresh_token: 'r2' } } as never);
    await expect(refreshAccessToken()).resolves.toBe('novo');
  });
});

describe('refreshFoiRecusado', () => {
  it.each([400, 401, 403])('%i é recusa', (status) => {
    expect(refreshFoiRecusado({ response: { status } })).toBe(true);
  });

  it.each([[undefined], [429], [500], [503]])('%s não é recusa', (status) => {
    expect(refreshFoiRecusado(status === undefined ? new Error('Network Error') : { response: { status } })).toBe(false);
  });
});

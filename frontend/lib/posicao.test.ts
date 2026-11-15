import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Fiel a expo-location/build: getForegroundPermissionsAsync -> LocationPermissionResponse
// (PermissionResponse com granted); getCurrentPositionAsync -> LocationObject;
// getLastKnownPositionAsync -> LocationObject | null. coords.accuracy é number | null.
const mocks = vi.hoisted(() => ({
  permissao: vi.fn(),
  atual: vi.fn(),
  ultima: vi.fn(),
}));

vi.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  getForegroundPermissionsAsync: mocks.permissao,
  getCurrentPositionAsync: mocks.atual,
  getLastKnownPositionAsync: mocks.ultima,
}));

import { lerPosicaoDaCaptura } from './posicao';

function leitura(precisao: number | null, timestamp = Date.now()) {
  return {
    coords: {
      latitude: -12.5,
      longitude: -55.7,
      altitude: null,
      accuracy: precisao,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp,
  };
}
const POSICAO = { latitude: -12.5, longitude: -55.7 };

describe('lerPosicaoDaCaptura', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.permissao.mockResolvedValue({ granted: true, status: 'granted', canAskAgain: true, expires: 'never' });
    mocks.atual.mockResolvedValue(leitura(10));
    mocks.ultima.mockResolvedValue(null);
  });
  afterEach(() => vi.useRealTimers());

  it('sem permissão devolve null sem ler nada', async () => {
    mocks.permissao.mockResolvedValue({ granted: false, status: 'denied', canAskAgain: true, expires: 'never' });
    expect(await lerPosicaoDaCaptura()).toBeNull();
    expect(mocks.atual).not.toHaveBeenCalled();
  });

  it('aceita a leitura atual precisa', async () => {
    expect(await lerPosicaoDaCaptura()).toEqual(POSICAO);
    expect(mocks.atual).toHaveBeenCalledWith({ accuracy: 4 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leitura imprecisa cai para a última conhecida recente e precisa', async () => {
    mocks.atual.mockResolvedValue(leitura(250));
    mocks.ultima.mockResolvedValue(leitura(30, Date.now() - 60000));
    expect(await lerPosicaoDaCaptura()).toEqual(POSICAO);
  });

  it('estourado o teto de 5 s, cai para a última conhecida e limpa o temporizador', async () => {
    mocks.atual.mockReturnValue(new Promise(() => {}));
    mocks.ultima.mockResolvedValue(leitura(30));
    const promessa = lerPosicaoDaCaptura();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await promessa).toEqual(POSICAO);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('nada disponível, ou última velha ou imprecisa, dá null', async () => {
    mocks.atual.mockResolvedValue(leitura(null));
    expect(await lerPosicaoDaCaptura()).toBeNull();
    mocks.ultima.mockResolvedValue(leitura(30, Date.now() - 300000));
    expect(await lerPosicaoDaCaptura()).toBeNull();
  });

  it('erro da biblioteca dá null e registra a causa', async () => {
    const causa = new Error('serviço de localização desligado');
    mocks.atual.mockRejectedValue(causa);
    mocks.ultima.mockRejectedValue(causa);
    const aviso = vi.mocked(console.warn);
    expect(await lerPosicaoDaCaptura()).toBeNull();
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining('[Posição]'), causa);
  });
});

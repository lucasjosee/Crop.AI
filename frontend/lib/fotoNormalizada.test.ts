import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fiel a expo-image-manipulator/build: manipulate(source) devolve um contexto
// encadeável; renderAsync() devolve ImageRef { width, height, saveAsync };
// saveAsync devolve ImageResult { uri, width, height }; rotate e resize só
// agendam. Contexto e ImageRef são SharedObject, com release().
const mocks = vi.hoisted(() => {
  const estado = { larguraDecodificada: 1280, alturaDecodificada: 960 };
  const saveAsync = vi.fn(async (_opcoes?: unknown) => ({ uri: 'file:///cache/saida.jpg', width: 1, height: 1 }));
  const release = vi.fn();
  const rotate = vi.fn();
  const resize = vi.fn();
  const manipulate = vi.fn((_fonte: unknown) => {
    const contexto: Record<string, unknown> = { release };
    contexto.rotate = (g: number) => (rotate(g), contexto);
    contexto.resize = (t: unknown) => (resize(t), contexto);
    contexto.renderAsync = async () => ({
      width: estado.larguraDecodificada,
      height: estado.alturaDecodificada,
      saveAsync,
      release,
    });
    return contexto;
  });
  return { estado, saveAsync, release, rotate, resize, manipulate };
});

vi.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: mocks.manipulate },
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));

import { normalizarFoto, rotacaoParaEndireitar, tamanhoAlvo } from './fotoNormalizada';

const nativo = { larguraNativa: 1280, alturaNativa: 960 };
const base = { ...nativo, larguraDecodificada: 1280, alturaDecodificada: 960 };

describe('rotacaoParaEndireitar', () => {
  it('left com lados iguais ao nativo gira 90°', () => {
    expect(rotacaoParaEndireitar({ ...base, orientacao: 'left' })).toBe(90);
  });
  it('left com lados já trocados (EXIF aplicado) não gira', () => {
    expect(
      rotacaoParaEndireitar({ ...base, orientacao: 'left', larguraDecodificada: 960, alturaDecodificada: 1280 })
    ).toBe(0);
  });
  it('right com lados iguais ao nativo gira 270°', () => {
    expect(rotacaoParaEndireitar({ ...base, orientacao: 'right' })).toBe(270);
  });
  it('up não gira; down não gira e avisa', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(rotacaoParaEndireitar({ ...base, orientacao: 'up' })).toBe(0);
    expect(rotacaoParaEndireitar({ ...base, orientacao: 'down' })).toBe(0);
    expect(aviso).toHaveBeenCalled();
  });
  it('foto quadrada com left gira', () => {
    expect(
      rotacaoParaEndireitar({
        orientacao: 'left',
        larguraNativa: 1000,
        alturaNativa: 1000,
        larguraDecodificada: 1000,
        alturaDecodificada: 1000,
      })
    ).toBe(90);
  });
});

describe('tamanhoAlvo', () => {
  it('reduz o lado maior em paisagem e em retrato, e não amplia', () => {
    expect(tamanhoAlvo(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(tamanhoAlvo(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(tamanhoAlvo(1280, 960, 1600)).toBeNull();
  });
});

describe('normalizarFoto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.estado.larguraDecodificada = 1280;
    mocks.estado.alturaDecodificada = 960;
  });

  it('gira 90° com left e salva JPEG 0,8', async () => {
    const saida = await normalizarFoto('file:///cache/foto.jpg', { orientacao: 'left', ...nativo });
    expect(saida).toBe('file:///cache/saida.jpg');
    expect(mocks.rotate).toHaveBeenCalledWith(90);
    expect(mocks.resize).not.toHaveBeenCalled();
    expect(mocks.saveAsync).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.8 });
  });

  it('usa as dimensões já giradas para o alvo, numa passada só', async () => {
    mocks.estado.larguraDecodificada = 4000;
    mocks.estado.alturaDecodificada = 3000;
    await normalizarFoto('file:///cache/foto.jpg', {
      orientacao: 'left',
      larguraNativa: 4000,
      alturaNativa: 3000,
    });
    expect(mocks.resize).toHaveBeenCalledWith({ width: 1200, height: 1600 });
    expect(mocks.saveAsync).toHaveBeenCalledTimes(1);
  });

  it('data: URI e foto sem rotação dentro do teto voltam como vieram, sem regravar', async () => {
    const dados = 'data:image/png;base64,AAAA';
    expect(await normalizarFoto(dados)).toBe(dados);
    expect(mocks.manipulate).not.toHaveBeenCalled();
    const uri = 'file:///galeria/foto.jpg';
    expect(await normalizarFoto(uri)).toBe(uri);
    expect(mocks.saveAsync).not.toHaveBeenCalled();
  });

  it('devolve o original e registra o erro quando a biblioteca lança', async () => {
    const causa = new Error('decodificador');
    mocks.manipulate.mockImplementationOnce(() => {
      throw causa;
    });
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const uri = 'file:///cache/foto.jpg';
    expect(await normalizarFoto(uri, { orientacao: 'left', ...nativo })).toBe(uri);
    expect(erro).toHaveBeenCalledWith(expect.stringContaining('[Foto]'), causa);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  instancias: [] as Array<{ uri: string }>,
  create: vi.fn(),
  write: vi.fn(),
  copy: vi.fn(),
}));

vi.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(...partes: Array<string | { uri: string }>) {
      this.uri = partes
        .map((p) => (typeof p === 'string' ? p : p.uri))
        .join('/');
      mocks.instancias.push(this);
    }
    create = mocks.create;
    write = mocks.write;
    copy = mocks.copy;
  }
  return { File, Paths: { document: { uri: 'file:///documentos' } } };
});

import { saveImagePersistently } from './imageHelper';

const PAYLOAD = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_URI = `data:image/png;base64,${PAYLOAD}`;

describe('saveImagePersistently', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.instancias.length = 0;
    mocks.copy.mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('escreve um data: URI como arquivo em base64, sem o prefixo data:', async () => {
    const uri = await saveImagePersistently(PNG_URI);

    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.write).toHaveBeenCalledWith(PAYLOAD, { encoding: 'base64' });
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(uri).toMatch(/^file:\/\/\/documentos\/diag_/);
  });

  it('cria o arquivo antes de escrever', async () => {
    await saveImagePersistently(PNG_URI);

    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.write.mock.invocationCallOrder[0]
    );
  });

  it('preserva a extensão png quando o mime é image/png', async () => {
    const uri = await saveImagePersistently(PNG_URI);

    expect(uri).toMatch(/\.png$/);
  });

  it('usa jpg para data:image/jpeg', async () => {
    const uri = await saveImagePersistently(`data:image/jpeg;base64,${PAYLOAD}`);

    expect(uri).toMatch(/\.jpg$/);
  });

  it('continua copiando um file:// URI da câmera real', async () => {
    const uri = await saveImagePersistently('file:///cache/foto.jpg');

    expect(mocks.copy).toHaveBeenCalledTimes(1);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.instancias.map((i) => i.uri)).toContain('file:///cache/foto.jpg');
    expect(uri).toMatch(/^file:\/\/\/documentos\/diag_.*\.jpg$/);
  });

  it('devolve o tempUri e registra a causa quando a escrita falha', async () => {
    const causa = new Error('disco cheio');
    mocks.write.mockImplementation(() => {
      throw causa;
    });
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});

    const uri = await saveImagePersistently(PNG_URI);

    expect(uri).toBe(PNG_URI);
    expect(erro).toHaveBeenCalledWith(expect.stringContaining('[ImageHelper]'), causa);
  });

  it('devolve o tempUri e registra a causa quando a cópia falha', async () => {
    const causa = new Error('sem permissão');
    mocks.copy.mockRejectedValue(causa);
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});

    const uri = await saveImagePersistently('file:///cache/foto.jpg');

    expect(uri).toBe('file:///cache/foto.jpg');
    expect(erro).toHaveBeenCalledWith(expect.stringContaining('[ImageHelper]'), causa);
  });
});

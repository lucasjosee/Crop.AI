import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('../db/sqlite', () => ({ dbDriver: { execute: mocks.execute } }));
vi.mock('./api', () => ({ api: { post: vi.fn() } }));

import { api } from './api';
import { ensureDiagnosticImageUploaded } from './diagnosticImageUploadService';

describe('ensureDiagnosticImageUploaded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({
      rows: { _array: [], length: 0, item: () => null },
      rowsAffected: 1,
    } as any);
  });

  it('não solicita nova URL quando o diagnóstico já tem image_s3_key', async () => {
    const key = await ensureDiagnosticImageUploaded({
      localId: 'local-1',
      imageUri: 'file:///leaf.jpg',
      imageS3Key: 'diagnosticos/user/existing.jpg',
    });

    expect(key).toBe('diagnosticos/user/existing.jpg');
    expect(api.post).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('duas chamadas concorrentes para o mesmo diagnóstico fazem um único PUT', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { upload_url: 'https://s3.example/put', s3_key: 'diagnosticos/user/a.jpg' },
    } as any);

    const fetchMock = vi.fn(async (_url: string, init?: { method?: string }) =>
      init?.method === 'PUT'
        ? ({ ok: true, status: 200 } as any)
        : ({ blob: async () => 'conteudo-da-imagem' } as any)
    );
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([
      ensureDiagnosticImageUploaded({ localId: 'local-1', imageUri: 'blob:leaf' }),
      ensureDiagnosticImageUploaded({ localId: 'local-1', imageUri: 'blob:leaf' }),
    ]);

    expect(a).toBe('diagnosticos/user/a.jpg');
    expect(b).toBe('diagnosticos/user/a.jpg');
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);

    vi.unstubAllGlobals();
  });

  it('uploads de diagnósticos diferentes não se atrapalham', async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({ data: { upload_url: 'https://s3.example/a', s3_key: 'chave-a' } } as any)
      .mockResolvedValueOnce({ data: { upload_url: 'https://s3.example/b', s3_key: 'chave-b' } } as any);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { method?: string }) =>
        init?.method === 'PUT'
          ? ({ ok: true, status: 200 } as any)
          : ({ blob: async () => 'conteudo' } as any)
      )
    );

    const [a, b] = await Promise.all([
      ensureDiagnosticImageUploaded({ localId: 'local-a', imageUri: 'blob:a' }),
      ensureDiagnosticImageUploaded({ localId: 'local-b', imageUri: 'blob:b' }),
    ]);

    expect([a, b].sort()).toEqual(['chave-a', 'chave-b']);
    expect(api.post).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });

  it('uma falha não deixa a chave em voo travada para sempre', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('sem rede'));

    await expect(
      ensureDiagnosticImageUploaded({ localId: 'local-falha', imageUri: 'blob:x' })
    ).rejects.toThrow('sem rede');

    vi.mocked(api.post).mockResolvedValueOnce({
      data: { upload_url: 'https://s3.example/put', s3_key: 'chave-depois' },
    } as any);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { method?: string }) =>
        init?.method === 'PUT'
          ? ({ ok: true, status: 200 } as any)
          : ({ blob: async () => 'conteudo' } as any)
      )
    );

    expect(await ensureDiagnosticImageUploaded({ localId: 'local-falha', imageUri: 'blob:x' })).toBe(
      'chave-depois'
    );

    vi.unstubAllGlobals();
  });

  it('não sobe de novo quando o diagnóstico já tem chave gravada no banco', async () => {
    mocks.execute.mockResolvedValueOnce({
      rows: {
        _array: [{ image_s3_key: 'diagnosticos/user/ja-existe.jpg' }],
        length: 1,
        item: () => ({ image_s3_key: 'diagnosticos/user/ja-existe.jpg' }),
      },
      rowsAffected: 0,
    } as any);

    const chave = await ensureDiagnosticImageUploaded({
      localId: 'local-ja-subido',
      imageUri: 'blob:leaf',
    });

    expect(chave).toBe('diagnosticos/user/ja-existe.jpg');
    expect(api.post).not.toHaveBeenCalled();
  });
});

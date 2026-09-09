import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(async () => ({
    rows: { _array: [], length: 0, item: () => null },
    rowsAffected: 1,
  })),
  ensureUploaded: vi.fn(async () => 'diagnosticos/user/image.jpg'),
}));

vi.mock('../db/sqlite', () => ({ dbDriver: { execute: mocks.execute } }));
vi.mock('./api', () => ({ api: { post: vi.fn() } }));
vi.mock('./diagnosticImageUploadService', () => ({
  ensureDiagnosticImageUploaded: mocks.ensureUploaded,
}));

import { api } from './api';
import {
  CrossValidationRequestError,
  crossValidateDiagnostic,
  getCrossValidationPriority,
} from './crossValidationService';

const input = {
  localId: '00000000-0000-4000-8000-000000000001',
  imageUri: 'file:///leaf.jpg',
  imageS3Key: 'diagnosticos/user/image.jpg',
  cvResult: {
    doencaId: '00000000-0000-4000-8000-000000000010',
    doencaNome: 'Ferrugem Asiática',
    confianca: 0.92,
    modeloUsado: 'tflite_v1.0',
    tempoInferenciaMs: 40,
  },
};

describe('crossValidationService', () => {
  beforeEach(() => vi.clearAllMocks());

  // P3.4 — o try/catch envolvia o api.post E o UPDATE no SQLite, então uma falha
  // local (ex.: FK de llm_doenca_id com catálogo desatualizado) virava
  // LLM_UNAVAILABLE. O app marcava SKIPPED, o guard do servidor impedia a
  // auto-correção, e cliente e servidor divergiam permanentemente.
  it('não reporta falha do banco local como indisponibilidade do LLM', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: {
        cross_validation: {
          result_status: 'DIVERGENT',
          llm_doenca_id: '00000000-0000-4000-8000-000000000020',
          llm_doenca_nome: 'Mancha Alvo',
          llm_confianca: 0.8,
          llm_observacoes: 'Divergência.',
        },
      },
    } as never);
    mocks.execute.mockRejectedValueOnce(new Error('FOREIGN KEY constraint failed'));

    await expect(crossValidateDiagnostic(input)).rejects.not.toBeInstanceOf(
      CrossValidationRequestError
    );
  });

  it('reutiliza image_s3_key e persiste CONFIRMED progressivamente', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: {
        cross_validation: {
          result_status: 'CONFIRMED',
          llm_agrees_with_cv: true,
          llm_doenca_id: null,
          llm_doenca_nome: null,
          llm_observacoes: 'Confirmado.',
          llm_confianca: 0.9,
        },
      },
    } as any);
    const uploaded = vi.fn();

    const response = await crossValidateDiagnostic({ ...input, onImageUploaded: uploaded });

    expect(mocks.ensureUploaded).toHaveBeenCalledWith(expect.objectContaining({
      imageS3Key: input.imageS3Key,
    }));
    expect(uploaded).toHaveBeenCalledWith(input.imageS3Key);
    expect(response.result.result_status).toBe('CONFIRMED');
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining('cross_validation_status'),
      expect.arrayContaining(['CONFIRMED', input.localId])
    );
  });

  it('preserva o código padronizado de timeout', async () => {
    vi.mocked(api.post).mockRejectedValue({
      response: { data: { error: { code: 'LLM_TIMEOUT' } } },
    });

    await expect(crossValidateDiagnostic(input)).rejects.toEqual(
      new CrossValidationRequestError('LLM_TIMEOUT')
    );
  });

  it('mantém ambas opiniões e só prioriza LLM em divergência com CV abaixo de 70%', () => {
    const divergent = {
      result_status: 'DIVERGENT' as const,
      llm_agrees_with_cv: false,
      llm_doenca_id: null,
      llm_doenca_nome: 'Mancha Alvo',
      llm_observacoes: 'Divergência.',
      llm_confianca: 0.8,
    };
    expect(getCrossValidationPriority(0.69, divergent)).toEqual({ primary: 'LLM', showBoth: true });
    expect(getCrossValidationPriority(0.7, divergent)).toEqual({ primary: 'CV', showBoth: true });
  });
});

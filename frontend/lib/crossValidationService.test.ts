import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  // vi.fn() sem implementação inline: um retorno fixo aqui trava, por inferência
  // de tipo, a assinatura zero-args que o describe novo (rows(), mock.calls
  // tipado) não respeita. beforeEach já define o resolved value de cada describe.
  execute: vi.fn(),
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
  runPendingCrossValidation,
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

describe('runPendingCrossValidation', () => {
  function rows(list: Array<Record<string, unknown>> = []) {
    return { rows: { _array: list, length: list.length, item: (i: number) => list[i] }, rowsAffected: 1 };
  }

  const attachment = {
    imageUri: 'file:///leaf.jpg',
    cvResult: { diseaseId: 'uuid-ferrugem', confidence: 0.89, inferenceTimeMs: 42, modelUsed: 'tflite_v1.0' },
    diseaseName: 'Ferrugem Asiática',
    diagnosticLocalId: 'local-1',
  };

  const veredito = {
    result_status: 'DIVERGENT',
    llm_agrees_with_cv: false,
    llm_doenca_id: 'uuid-mancha-alvo',
    llm_doenca_nome: 'Mancha Alvo',
    llm_observacoes: 'Bordas cloróticas.',
    llm_confianca: 0.72,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockReset();
    mocks.execute.mockResolvedValue(rows());
    mocks.ensureUploaded.mockReset();
    mocks.ensureUploaded.mockResolvedValue('diagnosticos/user/image.jpg');
  });

  it('anexo sem diagnostic_local_id não faz nada', async () => {
    const result = await runPendingCrossValidation(
      { ...attachment, diagnosticLocalId: undefined },
      'ONLINE'
    );

    expect(result).toBeNull();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each(['FIELD', 'DEGRADED', 'PROBING'] as const)(
    'em %s nem lê o banco: não há segunda opinião sem rede confiável',
    async (mode) => {
      expect(await runPendingCrossValidation(attachment, mode)).toBeNull();
      expect(mocks.execute).not.toHaveBeenCalled();
      expect(api.post).not.toHaveBeenCalled();
    }
  );

  it.each(['CONFIRMED', 'ENRICHED', 'DIVERGENT', 'SKIPPED'])(
    'status %s já é terminal: lê o banco e para',
    async (status) => {
      mocks.execute.mockResolvedValueOnce(rows([{ cross_validation_status: status }]));

      expect(await runPendingCrossValidation(attachment, 'ONLINE')).toBeNull();
      expect(api.post).not.toHaveBeenCalled();
    }
  );

  it('PENDING e online: roda, devolve o veredito e o deixa gravado', async () => {
    mocks.execute.mockResolvedValueOnce(rows([{ cross_validation_status: 'PENDING' }]));
    vi.mocked(api.post).mockResolvedValue({ data: { cross_validation: veredito } } as any);

    const result = await runPendingCrossValidation(attachment, 'ONLINE');

    expect(result).toEqual(veredito);
    const [, body] = vi.mocked(api.post).mock.calls[0] as [string, any];
    expect(body.diagnostic_local_id).toBe('local-1');
    expect(body.cv_result.doenca_nome).toBe('Ferrugem Asiática');
    const updates = (mocks.execute.mock.calls as Array<[string, unknown[]]>).filter(([sql]) =>
      sql.includes('UPDATE fila_diagnosticos')
    );
    expect(updates).toHaveLength(1);
  });

  it('falha na segunda opinião grava SKIPPED com o código e não derruba a conversa', async () => {
    mocks.execute.mockResolvedValueOnce(rows([{ cross_validation_status: 'PENDING' }]));
    vi.mocked(api.post).mockRejectedValue({
      response: { data: { error: { code: 'RATE_LIMITED' } } },
    });

    expect(await runPendingCrossValidation(attachment, 'ONLINE')).toBeNull();

    const [sql, params] = (mocks.execute.mock.calls as Array<[string, unknown[]]>).find(([s]) =>
      s.includes('cross_validation_error_code')
    )!;
    expect(sql).toContain('UPDATE fila_diagnosticos');
    expect(params).toEqual(expect.arrayContaining(['SKIPPED', 'RATE_LIMITED', 'local-1']));
  });

  it('remontar a tela no mesmo tick não dispara duas chamadas pagas', async () => {
    mocks.execute.mockResolvedValue(rows([{ cross_validation_status: 'PENDING' }]));
    vi.mocked(api.post).mockResolvedValue({ data: { cross_validation: veredito } } as any);

    const [a, b] = await Promise.all([
      runPendingCrossValidation(attachment, 'ONLINE'),
      runPendingCrossValidation(attachment, 'ONLINE'),
    ]);

    expect(a).toEqual(veredito);
    expect(b).toEqual(veredito);
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const candidatos: any[] = [];
  const updates: Array<{ sql: string; params: any[] }> = [];
  const selects: string[] = [];

  const wrap = (arr: any[]) => ({
    rows: { _array: arr, length: arr.length, item: (i: number) => arr[i] },
    rowsAffected: 0,
  });

  const execute = vi.fn(async (sql: string, params: any[] = []) => {
    const s = sql.trim().replace(/\s+/g, ' ');
    if (s.startsWith('SELECT')) {
      selects.push(s);
      return wrap([...candidatos]);
    }
    updates.push({ sql: s, params });
    return wrap([]);
  });

  return {
    candidatos,
    updates,
    selects,
    execute,
    crossValidate: vi.fn(async () => ({ imageS3Key: 'k', result: {} })),
  };
});

vi.mock('../db/sqlite', () => ({ dbDriver: { execute: mocks.execute } }));
vi.mock('./crossValidationService', () => ({ crossValidateDiagnostic: mocks.crossValidate }));
vi.mock('./diagnosisDetails', () => ({ resolveDiseaseName: vi.fn(async () => 'Ferrugem asiática') }));

import {
  sweepPendingSecondOpinions,
  MAX_TENTATIVAS_SEGUNDA_OPINIAO,
  MAX_SEGUNDAS_OPINIOES_POR_RODADA,
} from './pendingSecondOpinionService';

function candidato(over: Record<string, unknown> = {}) {
  return {
    local_id: 'd1',
    image_uri: 'file:///f.jpg',
    image_s3_key: null,
    doenca_id: 'doenca-1',
    confianca_ia: 0.82,
    modelo_usado: 'tflite_v1.0',
    tempo_inferencia_ms: 44,
    ...over,
  };
}

describe('pendingSecondOpinionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.candidatos.length = 0;
    mocks.updates.length = 0;
    mocks.selects.length = 0;
    mocks.crossValidate.mockResolvedValue({ imageS3Key: 'k', result: {} } as never);
  });

  it('o seletor exclui especiais, códigos permanentes e quem estourou o teto', async () => {
    await sweepPendingSecondOpinions();

    const sql = mocks.selects[0];
    expect(sql).toContain("cross_validation_status = 'SKIPPED'");
    expect(sql).toContain('doenca_id IS NOT NULL');
    expect(sql).toContain('cross_validation_error_code IS NULL');
    expect(sql).toContain('cross_validation_retry_count < ?');
    expect(sql).toContain('LIMIT ?');

    const params = mocks.execute.mock.calls[0][1] as any[];
    expect(params).toContain('LLM_UNAVAILABLE');
    expect(params).toContain('IMAGE_UNAVAILABLE');
    expect(params).toContain(MAX_TENTATIVAS_SEGUNDA_OPINIAO);
    expect(params).toContain(MAX_SEGUNDAS_OPINIOES_POR_RODADA);
  });

  it('sem candidatos não chama a rede', async () => {
    const resultado = await sweepPendingSecondOpinions();

    expect(resultado).toEqual({ synced: 0, failed: 0 });
    expect(mocks.crossValidate).not.toHaveBeenCalled();
  });

  it('pede a segunda opinião de cada candidato com os dados da própria linha', async () => {
    mocks.candidatos.push(candidato(), candidato({ local_id: 'd2' }));

    const resultado = await sweepPendingSecondOpinions();

    expect(resultado).toEqual({ synced: 2, failed: 0 });
    expect(mocks.crossValidate).toHaveBeenCalledTimes(2);
    expect(mocks.crossValidate).toHaveBeenCalledWith({
      localId: 'd1',
      imageUri: 'file:///f.jpg',
      imageS3Key: null,
      cvResult: {
        doencaId: 'doenca-1',
        doencaNome: 'Ferrugem asiática',
        confianca: 0.82,
        modeloUsado: 'tflite_v1.0',
        tempoInferenciaMs: 44,
      },
    });
    // Sucesso não escreve nada: quem grava o veredito é o crossValidationService.
    expect(mocks.updates).toHaveLength(0);
  });

  it('falha incrementa o contador e grava o código, para o permanente sair do seletor', async () => {
    mocks.candidatos.push(candidato());
    mocks.crossValidate.mockRejectedValue(
      Object.assign(new Error('IMAGE_NOT_FOUND'), { code: 'IMAGE_NOT_FOUND' })
    );

    const resultado = await sweepPendingSecondOpinions();

    expect(resultado).toEqual({ synced: 0, failed: 1 });
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0].sql).toContain('cross_validation_retry_count = cross_validation_retry_count + 1');
    expect(mocks.updates[0].params).toEqual(['IMAGE_NOT_FOUND', 'd1']);
  });

  it('falha sem código cai em LLM_UNAVAILABLE e continua re-tentável', async () => {
    mocks.candidatos.push(candidato());
    mocks.crossValidate.mockRejectedValue(new Error('rede caiu'));

    await sweepPendingSecondOpinions();

    expect(mocks.updates[0].params[0]).toBe('LLM_UNAVAILABLE');
  });

  it('um candidato que falha não impede os seguintes', async () => {
    mocks.candidatos.push(candidato(), candidato({ local_id: 'd2' }));
    mocks.crossValidate
      .mockRejectedValueOnce(new Error('rede caiu'))
      .mockResolvedValueOnce({ imageS3Key: 'k', result: {} } as never);

    const resultado = await sweepPendingSecondOpinions();

    expect(resultado).toEqual({ synced: 1, failed: 1 });
    expect(mocks.crossValidate).toHaveBeenCalledTimes(2);
  });
});

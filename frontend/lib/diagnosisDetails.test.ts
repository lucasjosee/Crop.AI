import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  hasFeedback: vi.fn(async () => false),
}));

vi.mock('../db/sqlite', () => ({ dbDriver: { execute: mocks.execute } }));
vi.mock('./diagnosisFeedbackService', () => ({ hasFeedback: mocks.hasFeedback }));

import {
  FITOTOXICIDADE_NOME,
  SAUDAVEL_NOME,
  listCatalogDiseases,
  loadDiagnosisDetails,
  resolveDiseaseName,
} from './diagnosisDetails';
import type { ChatAttachment } from './chatRepository';

function rows(list: Array<Record<string, unknown>>) {
  return { rows: { _array: list, length: list.length, item: (i: number) => list[i] }, rowsAffected: 1 };
}

const catalogoRow = {
  nome_comum: 'Ferrugem Asiática',
  nome_cientifico: 'Phakopsora pachyrhizi',
  causa: 'fungo',
  sintomas: 'Pústulas na face inferior da folha.',
  nivel_severidade: 5,
  defensivo_id: 'def-1',
  nome_comercial: 'Priori Xtra',
  classe: 'Fungicida',
  ingrediente_ativo: 'azoxistrobina + ciproconazol',
  grupo_quimico_frac: 'C3 + G1',
  bula_resumida: JSON.stringify({
    modo_de_acao: 'Sistêmico.',
    epoca_aplicacao: 'No R1.',
    volume_calda: '150 L/ha',
    epis_exigidos: ['Luvas', 'Máscara'],
    restricoes_ambientais: 'Não aplicar com vento acima de 10 km/h.',
  }),
  dosagem_recomendada: '300 mL/ha',
  carencia_dias: 30,
  max_aplicacoes_ciclo: 2,
};

const crossRow = {
  cross_validation_status: 'DIVERGENT',
  llm_doenca_id: 'uuid-mancha-alvo',
  llm_doenca_nome: 'Mancha Alvo',
  llm_confianca: 0.72,
  llm_observacoes: 'Bordas cloróticas sugerem Corynespora.',
};

function attachment(overrides: Partial<ChatAttachment> = {}): ChatAttachment {
  return {
    imageUri: 'file:///leaf.jpg',
    cvResult: { diseaseId: 'uuid-ferrugem', confidence: 0.89, inferenceTimeMs: 42, modelUsed: 'tflite_v1.0' },
    diseaseName: 'Ferrugem Asiática',
    diagnosticLocalId: 'local-1',
    ...overrides,
  };
}

describe('diagnosisDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue(rows([]));
    mocks.hasFeedback.mockResolvedValue(false);
  });

  it('resolveDiseaseName devolve os literais especiais sem tocar no banco', async () => {
    expect(await resolveDiseaseName('Saudável')).toBe(SAUDAVEL_NOME);
    expect(await resolveDiseaseName('Fitotoxicidade')).toBe(FITOTOXICIDADE_NOME);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('resolveDiseaseName busca por id e degrada quando a doença não está no catálogo', async () => {
    mocks.execute.mockResolvedValueOnce(rows([{ nome_comum: 'Ferrugem Asiática' }]));
    expect(await resolveDiseaseName('uuid-ferrugem')).toBe('Ferrugem Asiática');

    const [sql, params] = mocks.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE id = ?');
    expect(params).toEqual(['uuid-ferrugem']);

    mocks.execute.mockResolvedValueOnce(rows([]));
    expect(await resolveDiseaseName('uuid-desconhecida')).toBe('Doença não catalogada');
  });

  it('monta doença e defensivos a partir de um JOIN só', async () => {
    mocks.execute
      .mockResolvedValueOnce(rows([catalogoRow]))
      .mockResolvedValueOnce(rows([crossRow]));

    const details = await loadDiagnosisDetails(attachment());

    const [sql] = mocks.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('LEFT JOIN doenca_defensivo');
    expect(sql).toContain('LEFT JOIN defensivos');

    expect(details.doenca).toEqual({
      nomeComum: 'Ferrugem Asiática',
      nomeCientifico: 'Phakopsora pachyrhizi',
      causa: 'fungo',
      sintomas: 'Pústulas na face inferior da folha.',
      nivelSeveridade: 5,
    });
    expect(details.defensivos).toHaveLength(1);
    expect(details.defensivos[0]).toMatchObject({
      id: 'def-1',
      nomeComercial: 'Priori Xtra',
      classe: 'Fungicida',
      grupoQuimicoFrac: 'C3 + G1',
      dosagemRecomendada: '300 mL/ha',
      carenciaDias: 30,
      maxAplicacoesCiclo: 2,
    });
    expect(details.defensivos[0].bula).toMatchObject({
      modoDeAcao: 'Sistêmico.',
      epocaAplicacao: 'No R1.',
      volumeCalda: '150 L/ha',
      episExigidos: ['Luvas', 'Máscara'],
      restricoesAmbientais: 'Não aplicar com vento acima de 10 km/h.',
    });
    expect(details.defensivos[0].bulaBruta).toBeNull();
  });

  it('bula que não é JSON vira texto bruto em vez de sumir', async () => {
    mocks.execute
      .mockResolvedValueOnce(rows([{ ...catalogoRow, bula_resumida: 'Aplicar conforme receituário.' }]))
      .mockResolvedValueOnce(rows([crossRow]));

    const details = await loadDiagnosisDetails(attachment());

    expect(details.defensivos[0].bula).toBeNull();
    expect(details.defensivos[0].bulaBruta).toBe('Aplicar conforme receituário.');
  });

  it('doença sem defensivo cadastrado devolve lista vazia, não uma linha fantasma', async () => {
    const semDefensivo = {
      nome_comum: 'Ferrugem Asiática', nome_cientifico: null, causa: 'fungo',
      sintomas: 'Pústulas.', nivel_severidade: 5,
      defensivo_id: null, nome_comercial: null, classe: null, ingrediente_ativo: null,
      grupo_quimico_frac: null, bula_resumida: null,
      dosagem_recomendada: null, carencia_dias: null, max_aplicacoes_ciclo: null,
    };
    mocks.execute.mockResolvedValueOnce(rows([semDefensivo])).mockResolvedValueOnce(rows([crossRow]));

    const details = await loadDiagnosisDetails(attachment());

    expect(details.doenca?.nomeComum).toBe('Ferrugem Asiática');
    expect(details.defensivos).toEqual([]);
  });

  it('lê o veredito da cross-validation de fila_diagnosticos', async () => {
    mocks.execute.mockResolvedValueOnce(rows([catalogoRow])).mockResolvedValueOnce(rows([crossRow]));

    const details = await loadDiagnosisDetails(attachment());

    expect(details.crossValidation).toEqual({
      status: 'DIVERGENT',
      llmDoencaId: 'uuid-mancha-alvo',
      llmDoencaNome: 'Mancha Alvo',
      llmConfianca: 0.72,
      llmObservacoes: 'Bordas cloróticas sugerem Corynespora.',
    });
  });

  it('casos especiais não consultam o catálogo e nunca têm segunda opinião', async () => {
    mocks.execute.mockResolvedValue(rows([{ cross_validation_status: 'SKIPPED' }]));

    for (const diseaseId of ['Saudável', 'Fitotoxicidade']) {
      vi.clearAllMocks();
      mocks.execute.mockResolvedValue(rows([{ cross_validation_status: 'SKIPPED' }]));

      const details = await loadDiagnosisDetails(
        attachment({ cvResult: { diseaseId, confidence: 0.95, inferenceTimeMs: 30, modelUsed: 'tflite_v1.0' } })
      );

      expect(details.doenca).toBeNull();
      expect(details.defensivos).toEqual([]);
      const sqls = mocks.execute.mock.calls.map((c) => c[0] as string);
      expect(sqls.some((s) => s.includes('FROM doencas'))).toBe(false);
    }
  });

  it('o estado de já avaliado vem do banco, não da tela', async () => {
    mocks.execute.mockResolvedValueOnce(rows([catalogoRow])).mockResolvedValueOnce(rows([crossRow]));
    mocks.hasFeedback.mockResolvedValueOnce(true);

    const details = await loadDiagnosisDetails(attachment());

    expect(mocks.hasFeedback).toHaveBeenCalledWith('local-1');
    expect(details.feedbackJaEnviado).toBe(true);
  });

  it('diagnóstico sem local_id não quebra: sem veredito e sem feedback', async () => {
    mocks.execute.mockResolvedValueOnce(rows([catalogoRow]));

    const details = await loadDiagnosisDetails(attachment({ diagnosticLocalId: undefined }));

    expect(details.crossValidation.status).toBe('SKIPPED');
    expect(details.feedbackJaEnviado).toBe(false);
    expect(mocks.hasFeedback).not.toHaveBeenCalled();
  });

  it('listCatalogDiseases devolve a lista ordenada para a correção do produtor', async () => {
    mocks.execute.mockResolvedValueOnce(
      rows([{ id: 'a', nome_comum: 'Antracnose' }, { id: 'b', nome_comum: 'Ferrugem Asiática' }])
    );

    expect(await listCatalogDiseases()).toEqual([
      { id: 'a', nomeComum: 'Antracnose' },
      { id: 'b', nomeComum: 'Ferrugem Asiática' },
    ]);
    const [sql] = mocks.execute.mock.calls[0] as [string];
    expect(sql).toContain('ORDER BY nome_comum');
  });
});

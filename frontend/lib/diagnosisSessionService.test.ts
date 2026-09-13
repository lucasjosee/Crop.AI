import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const state = { n: 0 };
  return {
    state,
    execute: vi.fn(),
    saveImage: vi.fn(async () => 'file:///documentos/diag_1.jpg'),
    uuid: vi.fn(() => `id-${++state.n}`),
  };
});

vi.mock('../db/sqlite', () => ({ dbDriver: { execute: mocks.execute } }));
vi.mock('expo-crypto', () => ({ randomUUID: mocks.uuid }));
vi.mock('./imageHelper', () => ({ saveImagePersistently: mocks.saveImage }));

import { startDiagnosisSession } from './diagnosisSessionService';

function rows(list: Array<Record<string, unknown>> = []) {
  return { rows: { _array: list, length: list.length, item: (i: number) => list[i] }, rowsAffected: 1 };
}

/** Primeira chamada de execute cujo SQL contém o fragmento. */
function call(fragment: string): [string, unknown[]] {
  const found = (mocks.execute.mock.calls as Array<[string, unknown[]]>).find(([sql]) =>
    sql.includes(fragment)
  );
  if (!found) throw new Error(`nenhum execute com "${fragment}"`);
  return found;
}

const inference = { diseaseId: 'uuid-ferrugem', confidence: 0.89, inferenceTimeMs: 42, modelUsed: 'tflite_v1.0' };
const gps = { latitude: -12.5422, longitude: -55.7144 };

function input(overrides: Record<string, unknown> = {}) {
  return {
    imageUri: 'file:///cache/foto.jpg',
    inference,
    diseaseName: 'Ferrugem Asiática',
    gps,
    connectionMode: 'ONLINE' as const,
    ...overrides,
  };
}

describe('startDiagnosisSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.n = 0;
    mocks.execute.mockResolvedValue(rows());
    mocks.saveImage.mockResolvedValue('file:///documentos/diag_1.jpg');
  });

  it('grava diagnóstico, sessão e mensagem da foto, e devolve os dois ids', async () => {
    const result = await startDiagnosisSession(input());

    expect(result).toEqual({ sessionId: 'id-2', diagnosticLocalId: 'id-1' });

    const [diagSql, diagParams] = call('INSERT INTO fila_diagnosticos');
    expect(diagSql).toContain('cross_validation_status');
    expect(diagParams[0]).toBe('id-1');
    expect(diagParams).toEqual(expect.arrayContaining([
      'file:///documentos/diag_1.jpg', -12.5422, -55.7144, 'uuid-ferrugem', 0.89, 'tflite_v1.0', 42,
    ]));

    const [, sessionParams] = call('INSERT INTO chat_sessions');
    expect(sessionParams).toEqual(expect.arrayContaining(['Ferrugem Asiática', 'id-1']));

    const [, msgParams] = call('INSERT INTO chat_messages');
    expect(msgParams).toEqual(expect.arrayContaining(['id-2', 'user', '']));
  });

  it('a imagem é persistida antes de qualquer escrita no banco', async () => {
    await startDiagnosisSession(input());

    expect(mocks.saveImage).toHaveBeenCalledWith('file:///cache/foto.jpg');
    expect(mocks.saveImage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.execute.mock.invocationCallOrder[0]
    );
  });

  it('o anexo carrega o que o card e os motores precisam', async () => {
    await startDiagnosisSession(input());

    const [, msgParams] = call('INSERT INTO chat_messages');
    const anexo = JSON.parse(msgParams.find((p) => typeof p === 'string' && p.startsWith('{')) as string);
    expect(anexo).toEqual({
      imageUri: 'file:///documentos/diag_1.jpg',
      cvResult: inference,
      diseaseName: 'Ferrugem Asiática',
      diagnosticLocalId: 'id-1',
    });
  });

  it('o nome vem do input: o serviço não consulta o catálogo', async () => {
    await startDiagnosisSession(input());

    const sqls = (mocks.execute.mock.calls as Array<[string, unknown[]]>).map(([sql]) => sql);
    expect(sqls.some((s) => s.includes('FROM doencas'))).toBe(false);
  });

  it('online e com doença real: a segunda opinião fica PENDING', async () => {
    await startDiagnosisSession(input());
    const [, params] = call('INSERT INTO fila_diagnosticos');
    expect(params).toContain('PENDING');
  });

  it.each(['Saudável', 'Fitotoxicidade'])(
    'caso especial %s: doenca_id nulo e segunda opinião SKIPPED',
    async (diseaseId) => {
      await startDiagnosisSession(
        input({ inference: { ...inference, diseaseId }, diseaseName: diseaseId })
      );

      const [, params] = call('INSERT INTO fila_diagnosticos');
      expect(params).toContain('SKIPPED');
      expect(params).not.toContain(diseaseId);
    }
  );

  it.each(['FIELD', 'DEGRADED', 'PROBING'] as const)(
    'capturado em %s: segunda opinião nasce SKIPPED, não PENDING pendurado',
    async (connectionMode) => {
      await startDiagnosisSession(input({ connectionMode }));
      const [, params] = call('INSERT INTO fila_diagnosticos');
      expect(params).toContain('SKIPPED');
    }
  );

  it('falha ao gravar a mensagem apaga o diagnóstico órfão e propaga o erro', async () => {
    mocks.execute.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO chat_messages')) throw new Error('disco cheio');
      return rows();
    });

    await expect(startDiagnosisSession(input())).rejects.toThrow('disco cheio');

    const [delSql, delParams] = call('DELETE FROM fila_diagnosticos');
    expect(delSql).toContain("sync_status = 'PENDING'");
    expect(delParams).toEqual(['id-1']);
  });

  it('falha da própria compensação não engole o erro original', async () => {
    mocks.execute.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO chat_sessions')) throw new Error('sessão falhou');
      if (sql.includes('DELETE FROM fila_diagnosticos')) throw new Error('delete falhou');
      return rows();
    });

    await expect(startDiagnosisSession(input())).rejects.toThrow('sessão falhou');
  });
});

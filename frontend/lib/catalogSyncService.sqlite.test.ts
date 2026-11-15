import '../store/test-globals';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// SQLite de verdade: o fake de dbDriver não impõe FK, e o defeito aqui é uma FK.
const mocks = vi.hoisted(() => ({
  banco: null as null | { execute: (sql: string, params?: any[]) => Promise<any> },
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-secure-store', () => ({
  setItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock('../db/sqlite', async (importOriginal) => {
  const real = await importOriginal<typeof import('../db/sqlite')>();
  return {
    ...real,
    dbDriver: { execute: (sql: string, params?: any[]) => mocks.banco!.execute(sql, params) },
    getSyncMeta: vi.fn(async () => null),
    setSyncMeta: vi.fn(async () => {}),
  };
});
vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid' }));
vi.mock('./api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import { api } from './api';
import { criarBancoMigrado } from '../db/sqliteReal.testutil';
import { syncCatalog } from './catalogSyncService';
import { listCatalogDiseases, resolveDiseaseName } from './diagnosisDetails';

const DOENCA = 'doenca-referenciada';

function pagina(updates: Record<string, unknown[]>) {
  vi.mocked(api.get).mockResolvedValue({
    status: 200,
    data: { catalog_version_hash: 'v|x', has_more: false, next_cursor: null, updates },
  } as any);
}

const upsertDoenca = (nome: string) => ({
  action: 'upsert',
  data: {
    id: DOENCA, id_cultura: 'cultura-soja-id', nome_comum: nome,
    nome_cientifico: 'Fungus teste', sintomas: 'manchas', nivel_severidade: 3,
  },
});

async function um(sql: string, params: any[] = []) {
  return (await mocks.banco!.execute(sql, params)).rows._array[0];
}

describe('catalogSyncService em SQLite real', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.banco = await criarBancoMigrado();
    pagina({ doencas: [upsertDoenca('Doença Referenciada')] });
    await syncCatalog();
    // Um diagnóstico local aponta para a doença, como em qualquer aparelho em uso.
    await mocks.banco.execute(
      `INSERT INTO fila_diagnosticos (local_id, image_uri, doenca_id, modelo_usado)
       VALUES ('d1', 'file:///d1.jpg', ?, 'm');`,
      [DOENCA]
    );
    await mocks.banco.execute(
      `INSERT INTO doenca_defensivo (id_doenca, id_defensivo, dosagem_recomendada, carencia_dias)
       SELECT ?, id, '1 L/ha', 10 FROM defensivos LIMIT 1;`,
      [DOENCA]
    );
  });

  it('desativar uma doença referenciada por diagnóstico não lança: marca inativa e apaga as relações', async () => {
    pagina({ doencas: [{ action: 'delete', id: DOENCA }] });

    await expect(syncCatalog()).resolves.toEqual({ updated: true });

    expect((await um('SELECT is_active FROM doencas WHERE id = ?;', [DOENCA])).is_active).toBe(0);
    expect((await um('SELECT COUNT(*) AS n FROM doenca_defensivo WHERE id_doenca = ?;', [DOENCA])).n).toBe(0);
    expect((await um("SELECT doenca_id FROM fila_diagnosticos WHERE local_id = 'd1';")).doenca_id).toBe(DOENCA);
  });

  it('a inativa some de listCatalogDiseases e continua em resolveDiseaseName', async () => {
    pagina({ doencas: [{ action: 'delete', id: DOENCA }] });
    await syncCatalog();

    const ids = (await listCatalogDiseases()).map((d) => d.id);
    expect(ids).not.toContain(DOENCA);
    expect(ids.length).toBeGreaterThan(0);
    expect(await resolveDiseaseName(DOENCA)).toBe('Doença Referenciada');
  });

  it('upsert de uma doença inativa a reativa', async () => {
    pagina({ doencas: [{ action: 'delete', id: DOENCA }] });
    await syncCatalog();
    pagina({ doencas: [upsertDoenca('Doença Renomeada')] });
    await syncCatalog();

    expect((await um('SELECT is_active FROM doencas WHERE id = ?;', [DOENCA])).is_active).toBe(1);
    expect((await listCatalogDiseases()).map((d) => d.id)).toContain(DOENCA);
  });

  it('atualizar (REPLACE) uma doença referenciada funciona', async () => {
    pagina({ doencas: [upsertDoenca('Nome Novo')] });

    await expect(syncCatalog()).resolves.toEqual({ updated: true });
    expect(await resolveDiseaseName(DOENCA)).toBe('Nome Novo');
  });

  it('cultura referenciada por doença não é apagada; a sem doença é', async () => {
    await mocks.banco!.execute("INSERT INTO culturas (id, nome) VALUES ('cultura-vazia', 'Vazia');");
    pagina({ culturas: [{ action: 'delete', id: 'cultura-soja-id' }, { action: 'delete', id: 'cultura-vazia' }] });

    await expect(syncCatalog()).resolves.toEqual({ updated: true });
    expect((await um("SELECT COUNT(*) AS n FROM culturas WHERE id = 'cultura-soja-id';")).n).toBe(1);
    expect((await um("SELECT COUNT(*) AS n FROM culturas WHERE id = 'cultura-vazia';")).n).toBe(0);
  });
});

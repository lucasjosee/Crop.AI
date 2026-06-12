import './../store/test-globals';
import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-secure-store', () => ({
  setItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import { dbDriver, getSyncMeta, setSyncMeta } from './sqlite';

describe('sync_metadata helpers (WebDatabaseDriver)', () => {
  it('retorna null para chave inexistente', async () => {
    expect(await getSyncMeta('chave-que-nao-existe')).toBeNull();
  });

  it('grava e lê valor; INSERT OR REPLACE sobrescreve', async () => {
    await setSyncMeta('catalog_etag', 'v1|abc');
    expect(await getSyncMeta('catalog_etag')).toBe('v1|abc');
    await setSyncMeta('catalog_etag', 'v2|def');
    expect(await getSyncMeta('catalog_etag')).toBe('v2|def');
  });
});

describe('WebDatabaseDriver generic handlers', () => {
  it('UPDATE genérico altera colunas pelo nome', async () => {
    await dbDriver.execute(
      `INSERT INTO fila_diagnosticos (local_id, server_id, image_uri, image_s3_key, latitude, longitude, doenca_id, confianca_ia, modelo_usado, tempo_inferencia_ms, sync_status, retry_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      ['gen-1', null, 'file:///a.jpg', null, -23.5, -46.6, 'd1', 0.9, 'tflite_v1.0', 40, 'PENDING', 0]
    );

    await dbDriver.execute(
      'UPDATE fila_diagnosticos SET sync_status = ?, retry_count = ? WHERE local_id = ?;',
      ['FAILED', 5, 'gen-1']
    );

    const res = await dbDriver.execute(
      'SELECT * FROM fila_diagnosticos WHERE sync_status = ?;', ['FAILED']
    );
    const row = res.rows._array.find((r: any) => r.local_id === 'gen-1');
    expect(row.retry_count).toBe(5);
  });

  it('UPDATE de image_s3_key funciona', async () => {
    await dbDriver.execute(
      'UPDATE fila_diagnosticos SET image_s3_key = ? WHERE local_id = ?;',
      ['diagnosticos/u/x.jpg', 'gen-1']
    );
    const res = await dbDriver.execute('SELECT * FROM fila_diagnosticos;');
    const row = res.rows._array.find((r: any) => r.local_id === 'gen-1');
    expect(row.image_s3_key).toBe('diagnosticos/u/x.jpg');
  });

  it('DELETE genérico com chave remove a linha', async () => {
    await dbDriver.execute('DELETE FROM fila_diagnosticos WHERE local_id = ?;', ['gen-1']);
    const res = await dbDriver.execute('SELECT * FROM fila_diagnosticos;');
    expect(res.rows._array.find((r: any) => r.local_id === 'gen-1')).toBeUndefined();
  });

  it('INSERT OR REPLACE em tabela de catálogo faz upsert pela primeira coluna', async () => {
    await dbDriver.execute(
      'INSERT OR REPLACE INTO doencas (id, id_cultura, nome_comum, nome_cientifico, sintomas, nivel_severidade, causa) VALUES (?, ?, ?, ?, ?, ?, ?);',
      ['up-1', 'cultura-soja-id', 'Nova Doenca', 'Fungus novus', 'manchas', 3, 'Fungo (Fungus novus)']
    );
    await dbDriver.execute(
      'INSERT OR REPLACE INTO doencas (id, id_cultura, nome_comum, nome_cientifico, sintomas, nivel_severidade, causa) VALUES (?, ?, ?, ?, ?, ?, ?);',
      ['up-1', 'cultura-soja-id', 'Nova Doenca v2', 'Fungus novus', 'manchas', 3, 'Fungo (Fungus novus)']
    );
    const res = await dbDriver.execute('SELECT * FROM doencas WHERE id = ?;', ['up-1']);
    expect(res.rows.length).toBe(1);
    expect(res.rows.item(0).nome_comum).toBe('Nova Doenca v2');
  });

  it('SELECT em fila_slm_logs filtra por session_id', async () => {
    await dbDriver.execute(
      'INSERT INTO fila_slm_logs (session_id, started_at, model_version, interactions_json, sync_status, retry_count) VALUES (?, ?, ?, ?, ?, ?);',
      ['sess-1', '2026-06-10T10:00:00Z', 'gemma-2b-it-q4_k_m', '[]', 'PENDING', 0]
    );
    const res = await dbDriver.execute('SELECT * FROM fila_slm_logs WHERE session_id = ?;', ['sess-1']);
    expect(res.rows.length).toBe(1);
  });
});

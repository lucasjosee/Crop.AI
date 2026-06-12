import { api } from './api';
import { dbDriver, getSyncMeta, setSyncMeta, getCausaByNomeCientifico } from '../db/sqlite';

export const CATALOG_ETAG_KEY = 'catalog_etag';
const PAGE_LIMIT = 100;

type UpdateEntry =
  | { action: 'upsert'; data: any }
  | { action: 'delete'; id: string };

interface CatalogSyncPage {
  catalog_version_hash: string;
  next_cursor: string | null;
  has_more: boolean;
  updates: {
    culturas?: UpdateEntry[];
    doencas?: UpdateEntry[];
    defensivos?: UpdateEntry[];
    doenca_defensivo?: UpdateEntry[];
  };
}

async function applyUpdates(updates: CatalogSyncPage['updates']): Promise<void> {
  for (const c of updates.culturas ?? []) {
    if (c.action === 'delete') {
      await dbDriver.execute('DELETE FROM culturas WHERE id = ?;', [c.id]);
    } else {
      await dbDriver.execute(
        'INSERT OR REPLACE INTO culturas (id, nome, estagio_fenologico_padrao) VALUES (?, ?, ?);',
        [c.data.id, c.data.nome, JSON.stringify(c.data.estagio_fenologico_padrao ?? [])]
      );
    }
  }

  for (const d of updates.doencas ?? []) {
    if (d.action === 'delete') {
      await dbDriver.execute('DELETE FROM doenca_defensivo WHERE id_doenca = ?;', [d.id]);
      await dbDriver.execute('DELETE FROM doencas WHERE id = ?;', [d.id]);
    } else {
      await dbDriver.execute(
        'INSERT OR REPLACE INTO doencas (id, id_cultura, nome_comum, nome_cientifico, sintomas, nivel_severidade, causa) VALUES (?, ?, ?, ?, ?, ?, ?);',
        [
          d.data.id,
          d.data.id_cultura,
          d.data.nome_comum,
          d.data.nome_cientifico,
          d.data.sintomas,
          d.data.nivel_severidade,
          getCausaByNomeCientifico(d.data.nome_cientifico),
        ]
      );
    }
  }

  for (const f of updates.defensivos ?? []) {
    if (f.action === 'delete') {
      await dbDriver.execute('DELETE FROM doenca_defensivo WHERE id_defensivo = ?;', [f.id]);
      await dbDriver.execute('DELETE FROM defensivos WHERE id = ?;', [f.id]);
    } else {
      await dbDriver.execute(
        'INSERT OR REPLACE INTO defensivos (id, nome_comercial, ingrediente_ativo, classe, fabricante, grupo_quimico_frac, bula_resumida) VALUES (?, ?, ?, ?, ?, ?, ?);',
        [
          f.data.id,
          f.data.nome_comercial,
          f.data.ingrediente_ativo,
          f.data.classe,
          f.data.fabricante,
          f.data.grupo_quimico_frac,
          JSON.stringify(f.data.bula_resumida ?? {}),
        ]
      );
    }
  }

  for (const rel of updates.doenca_defensivo ?? []) {
    if (rel.action === 'upsert') {
      await dbDriver.execute(
        'INSERT OR REPLACE INTO doenca_defensivo (id_doenca, id_defensivo, dosagem_recomendada, carencia_dias, max_aplicacoes_ciclo) VALUES (?, ?, ?, ?, ?);',
        [
          rel.data.id_doenca,
          rel.data.id_defensivo,
          rel.data.dosagem_recomendada,
          rel.data.carencia_dias,
          rel.data.max_aplicacoes_ciclo ?? 0,
        ]
      );
    }
  }
}

export async function syncCatalog(): Promise<{ updated: boolean }> {
  const etag = await getSyncMeta(CATALOG_ETAG_KEY);
  let cursor: string | null = null;
  let newEtag: string | null = null;
  let applied = false;

  do {
    const res = await api.get('/api/v1/catalog/sync', {
      headers: etag ? { 'If-None-Match': etag } : {},
      params: { limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) },
      validateStatus: (s: number) => s === 200 || s === 304,
    });

    if (res.status === 304) {
      console.log('[CatalogSync] Catálogo local já está atualizado (304).');
      return { updated: false };
    }

    const page = res.data as CatalogSyncPage;
    await applyUpdates(page.updates ?? {});
    applied = true;
    newEtag = page.catalog_version_hash;
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);

  // ETag só é persistido após consumir TODAS as páginas — interrupção no meio
  // faz o próximo sync recomeçar do ETag antigo (upserts são idempotentes).
  if (newEtag) {
    await setSyncMeta(CATALOG_ETAG_KEY, newEtag);
  }

  console.log('[CatalogSync] Catálogo local atualizado.');
  return { updated: applied };
}

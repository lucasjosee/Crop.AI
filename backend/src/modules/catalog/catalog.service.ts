import { createHash } from 'crypto';
import { asc, count, max, sql, SQL } from 'drizzle-orm';
import { PgColumn } from 'drizzle-orm/pg-core';
import { db } from '../../db';
import { culturas, doencas, defensivos, doencaDefensivo } from '../../db/schema';

// Epoch-ms expression avoids node-postgres timezone serialization of Date objects
function epochMs(col: PgColumn): SQL {
  return sql`FLOOR(EXTRACT(EPOCH FROM ${col}) * 1000)::bigint`;
}

const EPOCH_ISO = new Date(0).toISOString();
const TABLES = ['culturas', 'doencas', 'defensivos', 'doenca_defensivo'] as const;

export type UpdateEntry =
  | { action: 'upsert'; data: Record<string, unknown> }
  | { action: 'delete'; id: string };

interface RowWithPos { entry: UpdateEntry; u: string; id: string }
interface CursorPos { since: string; table: number; u: string | null; id: string | null }

function encodeCursor(pos: CursorPos): string {
  return Buffer.from(JSON.stringify(pos)).toString('base64url');
}

function decodeCursor(raw: string): CursorPos | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed.since !== 'string' || typeof parsed.table !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function parseEtagSince(etag: string | undefined): string {
  if (!etag) return EPOCH_ISO;
  const sep = etag.lastIndexOf('|');
  if (sep === -1) return EPOCH_ISO;
  const ts = etag.slice(0, sep);
  return Number.isNaN(Date.parse(ts)) ? EPOCH_ISO : ts;
}

export async function computeCatalogEtag(): Promise<string> {
  const stats = await Promise.all([
    db.select({ total: count(), latest: max(culturas.updatedAt) }).from(culturas),
    db.select({ total: count(), latest: max(doencas.updatedAt) }).from(doencas),
    db.select({ total: count(), latest: max(defensivos.updatedAt) }).from(defensivos),
    db.select({ total: count(), latest: max(doencaDefensivo.updatedAt) }).from(doencaDefensivo),
  ]);

  const parts: string[] = [];
  let maxUpdated = new Date(0);
  for (const [row] of stats) {
    const latest = row.latest ?? new Date(0);
    if (latest > maxUpdated) maxUpdated = latest;
    parts.push(`${row.total}:${latest.toISOString()}`);
  }
  const hash = createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
  return `${maxUpdated.toISOString()}|${hash}`;
}

function deltaCondition(
  updatedAtCol: PgColumn,
  idCol: PgColumn,
  since: string,
  after: { u: string; id: string } | null
): SQL {
  const ms = epochMs(updatedAtCol);
  if (!after) return sql`${ms} > ${new Date(since).getTime()}`;
  const afterMs = new Date(after.u).getTime();
  return sql`(${ms} > ${afterMs} OR (${ms} = ${afterMs} AND ${idCol}::text > ${after.id}))`;
}

type Fetcher = (since: string, after: { u: string; id: string } | null, limit: number) => Promise<RowWithPos[]>;

const fetchCulturas: Fetcher = async (since, after, limit) => {
  const rows = await db.select().from(culturas)
    .where(deltaCondition(culturas.updatedAt, culturas.id, since, after))
    .orderBy(epochMs(culturas.updatedAt), asc(culturas.id))
    .limit(limit);
  return rows.map((r) => ({
    u: r.updatedAt.toISOString(),
    id: r.id,
    entry: r.isActive
      ? { action: 'upsert' as const, data: { id: r.id, nome: r.nome, estagio_fenologico_padrao: r.estagioFenologicoPadrao } }
      : { action: 'delete' as const, id: r.id },
  }));
};

const fetchDoencas: Fetcher = async (since, after, limit) => {
  const rows = await db.select().from(doencas)
    .where(deltaCondition(doencas.updatedAt, doencas.id, since, after))
    .orderBy(epochMs(doencas.updatedAt), asc(doencas.id))
    .limit(limit);
  return rows.map((r) => ({
    u: r.updatedAt.toISOString(),
    id: r.id,
    entry: r.isActive
      ? {
          action: 'upsert' as const,
          data: {
            id: r.id,
            id_cultura: r.idCultura,
            nome_comum: r.nomeComum,
            nome_cientifico: r.nomeCientifico,
            sintomas: r.sintomas,
            nivel_severidade: r.nivelSeveridade,
          },
        }
      : { action: 'delete' as const, id: r.id },
  }));
};

const fetchDefensivos: Fetcher = async (since, after, limit) => {
  const rows = await db.select().from(defensivos)
    .where(deltaCondition(defensivos.updatedAt, defensivos.id, since, after))
    .orderBy(epochMs(defensivos.updatedAt), asc(defensivos.id))
    .limit(limit);
  return rows.map((r) => ({
    u: r.updatedAt.toISOString(),
    id: r.id,
    entry: r.isActive
      ? {
          action: 'upsert' as const,
          data: {
            id: r.id,
            nome_comercial: r.nomeComercial,
            ingrediente_ativo: r.ingredienteAtivo,
            fabricante: r.fabricante,
            classe: r.classe,
            grupo_quimico_frac: r.grupoQuimicoFrac,
            bula_resumida: r.bulaResumida,
          },
        }
      : { action: 'delete' as const, id: r.id },
  }));
};

const fetchDoencaDefensivo: Fetcher = async (since, after, limit) => {
  const rows = await db.select().from(doencaDefensivo)
    .where(deltaCondition(doencaDefensivo.updatedAt, doencaDefensivo.id, since, after))
    .orderBy(epochMs(doencaDefensivo.updatedAt), asc(doencaDefensivo.id))
    .limit(limit);
  return rows.map((r) => ({
    u: r.updatedAt.toISOString(),
    id: r.id,
    entry: {
      action: 'upsert' as const,
      data: {
        id_doenca: r.idDoenca,
        id_defensivo: r.idDefensivo,
        dosagem_recomendada: r.dosagemRecomendada,
        carencia_dias: r.carenciaDias,
        max_aplicacoes_ciclo: r.maxAplicacoesCiclo,
      },
    },
  }));
};

const FETCHERS: Fetcher[] = [fetchCulturas, fetchDoencas, fetchDefensivos, fetchDoencaDefensivo];

export async function getCatalogDelta(clientEtag: string | undefined, cursorRaw: string | undefined, limit: number) {
  const currentEtag = await computeCatalogEtag();

  if (!cursorRaw && clientEtag && clientEtag === currentEtag) {
    return { notModified: true as const, etag: currentEtag };
  }

  const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
  const since = cursor ? cursor.since : parseEtagSince(clientEtag);
  let tableIdx = cursor ? cursor.table : 0;
  let after = cursor && cursor.u && cursor.id ? { u: cursor.u, id: cursor.id } : null;

  const updates: Record<(typeof TABLES)[number], UpdateEntry[]> = {
    culturas: [], doencas: [], defensivos: [], doenca_defensivo: [],
  };

  let remaining = limit;
  let hasMore = false;
  let nextCursor: string | null = null;

  for (; tableIdx < TABLES.length; tableIdx++) {
    const batch = await FETCHERS[tableIdx](since, after, remaining + 1);
    const included = batch.slice(0, remaining);
    for (const row of included) updates[TABLES[tableIdx]].push(row.entry);
    remaining -= included.length;

    if (batch.length > included.length) {
      const last = included[included.length - 1];
      hasMore = true;
      nextCursor = encodeCursor(
        last
          ? { since, table: tableIdx, u: last.u, id: last.id }
          : { since, table: tableIdx, u: after?.u ?? null, id: after?.id ?? null }
      );
      break;
    }
    after = null;
  }

  return {
    notModified: false as const,
    etag: currentEtag,
    updates,
    has_more: hasMore,
    next_cursor: nextCursor,
  };
}

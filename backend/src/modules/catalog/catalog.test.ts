import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { app } from '../../app';
import { db } from '../../db';
import { usuarios, refreshTokens, culturas, doencas } from '../../db/schema';

const culturaId = `cultura-test-${randomUUID()}`;
let doencaId: string;
let extraDoencaId: string;
let accessToken: string;

async function callSync(query: string = '', etag?: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/catalog/sync${query}`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(etag ? { 'If-None-Match': etag } : {}),
    },
  });
}

describe('GET /api/v1/catalog/sync (integration)', () => {
  beforeAll(async () => {
    await app.ready();
    await db.delete(refreshTokens);
    await db.delete(usuarios);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { nome: 'Catalog Tester', email: 'catalog@test.com', password: 'senha123!' },
    });
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'catalog@test.com', password: 'senha123!' },
    });
    accessToken = JSON.parse(loginRes.body).access_token;

    await db.insert(culturas).values({ id: culturaId, nome: 'Cultura Catalog', estagioFenologicoPadrao: [] });
    const [d, extra] = await db
      .insert(doencas)
      .values([
        { idCultura: culturaId, nomeComum: 'Doenca Catalog v1', sintomas: 'sintoma inicial' },
        { idCultura: culturaId, nomeComum: 'Doenca Catalog extra', sintomas: 'fixture de paginação' },
      ])
      .returning({ id: doencas.id });
    doencaId = d.id;
    extraDoencaId = extra.id;
  });

  afterAll(async () => {
    await db.delete(doencas).where(eq(doencas.id, doencaId));
    await db.delete(doencas).where(eq(doencas.id, extraDoencaId));
    await db.delete(culturas).where(eq(culturas.id, culturaId));
    await db.delete(refreshTokens);
    await db.delete(usuarios);
    await app.close();
  });

  it('sem ETag retorna catálogo completo com catalog_version_hash', async () => {
    const res = await callSync('?limit=500');
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.catalog_version_hash).toBeTruthy();
    expect(body.has_more).toBe(false);
    const doencaIds = body.updates.doencas.map((u: any) => u.action === 'upsert' ? u.data.id : u.id);
    expect(doencaIds).toContain(doencaId);
  });

  it('retorna 304 quando ETag é igual (T5.7)', async () => {
    const first = await callSync('?limit=500');
    const etag = JSON.parse(first.body).catalog_version_hash;
    const second = await callSync('?limit=500', etag);
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe('');
  });

  it('detecta alteração e retorna delta (T5.6)', async () => {
    const first = await callSync('?limit=500');
    const oldEtag = JSON.parse(first.body).catalog_version_hash;

    await db
      .update(doencas)
      .set({ nomeComum: 'Doenca Catalog v2', updatedAt: new Date() })
      .where(eq(doencas.id, doencaId));

    const res = await callSync('?limit=500', oldEtag);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.catalog_version_hash).not.toBe(oldEtag);
    const changed = body.updates.doencas.find((u: any) => u.action === 'upsert' && u.data.id === doencaId);
    expect(changed).toBeTruthy();
    expect(changed.data.nome_comum).toBe('Doenca Catalog v2');
  });

  it('soft delete vira action delete', async () => {
    const first = await callSync('?limit=500');
    const oldEtag = JSON.parse(first.body).catalog_version_hash;

    await db
      .update(doencas)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(doencas.id, doencaId));

    const res = await callSync('?limit=500', oldEtag);
    const body = JSON.parse(res.body);
    const deleted = body.updates.doencas.find((u: any) => u.action === 'delete' && u.id === doencaId);
    expect(deleted).toBeTruthy();

    await db.update(doencas).set({ isActive: true, updatedAt: new Date() }).where(eq(doencas.id, doencaId));
  });

  it('pagina com cursor e has_more', async () => {
    let res = await callSync('?limit=2');
    let body = JSON.parse(res.body);
    expect(body.has_more).toBe(true);
    expect(body.next_cursor).toBeTruthy();

    const collected: string[] = [];
    const collect = (b: any) => {
      for (const tableName of ['culturas', 'doencas', 'defensivos', 'doenca_defensivo']) {
        for (const u of b.updates[tableName] ?? []) {
          collected.push(`${tableName}:${u.action === 'upsert' ? JSON.stringify(u.data) : u.id}`);
        }
      }
    };
    collect(body);

    let guard = 0;
    while (body.has_more && guard < 200) {
      res = await callSync(`?limit=2&cursor=${encodeURIComponent(body.next_cursor)}`);
      body = JSON.parse(res.body);
      collect(body);
      guard += 1;
    }
    expect(body.has_more).toBe(false);

    const full = await callSync('?limit=500');
    const fullBody = JSON.parse(full.body);
    let fullCount = 0;
    for (const t of ['culturas', 'doencas', 'defensivos', 'doenca_defensivo']) {
      fullCount += (fullBody.updates[t] ?? []).length;
    }
    expect(collected.length).toBe(fullCount);
  });
});

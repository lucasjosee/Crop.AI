import * as SecureStore from 'expo-secure-store';
import { assertSqlCipherAvailable } from './security';

import doencasData from './seeds/doencas.json';
import defensivosData from './seeds/defensivos.json';
import doencaDefensivoData from './seeds/doenca_defensivo.json';

// Helper to dynamically calculate causal agent
export function getCausaByNomeCientifico(nomeCientifico: string | null): string {
  if (!nomeCientifico) return 'Fatores abióticos';
  const lower = nomeCientifico.toLowerCase();
  if (lower.includes('virus') || lower.includes('mottle')) {
    return `Vírus (${nomeCientifico})`;
  }
  if (lower.includes('bacteria') || lower.includes('pseudomonas')) {
    return `Bactéria (${nomeCientifico})`;
  }
  if (lower.includes('phytophthora') || lower.includes('peronospora')) {
    return `Oomiceto (${nomeCientifico})`;
  }
  return `Fungo (${nomeCientifico})`;
}

// Tipagem genérica para resultados de consulta
export interface QueryResult {
  rows: {
    _array: any[];
    length: number;
    item: (idx: number) => any;
  };
  rowsAffected: number;
  insertId?: number;
}

export interface IDatabaseDriver {
  execute: (sql: string, params?: any[]) => Promise<QueryResult>;
}

// -------------------------------------------------------------
// Driver Nativo (op-sqlite)
// -------------------------------------------------------------
let nativeDb: any = null;

class NativeDatabaseDriver implements IDatabaseDriver {
  constructor(dbInstance: any) {
    nativeDb = dbInstance;
  }

  async execute(sql: string, params: any[] = []): Promise<QueryResult> {
    const res = await nativeDb.execute(sql, params);
    const rawRows = res.rows?._array || res.rows || [];
    return {
      rows: {
        _array: rawRows,
        length: rawRows.length,
        item: (idx: number) => rawRows[idx]
      },
      rowsAffected: res.rowsAffected || 0,
      insertId: res.insertId
    };
  }
}

// -------------------------------------------------------------
// Inicialização do Driver de Banco de Dados Unificado
// -------------------------------------------------------------
/**
 * Sem o target web não existe driver de fallback. Antes de initDatabase() o
 * banco precisa falhar alto — devolver sucesso vazio esconderia bug de ordem
 * de inicialização.
 */
class UninitializedDriver implements IDatabaseDriver {
  async execute(): Promise<QueryResult> {
    throw new Error('Banco local não inicializado. Chame initDatabase() antes.');
  }
}

export let dbDriver: IDatabaseDriver = new UninitializedDriver();
let initPromise: Promise<IDatabaseDriver> | null = null;

export async function initDatabase(): Promise<IDatabaseDriver> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      const { open, isSQLCipher } = require('@op-engineering/op-sqlite');

      if (!isSQLCipher()) {
        throw new Error('Banco local seguro indisponível neste build.');
      }

      const keyName = 'crop_ai_db_secret_key';
      let dbKey = await SecureStore.getItemAsync(keyName, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });

      if (!dbKey) {
        console.log('[Database] Generating secure key via expo-crypto...');
        const Crypto = require('expo-crypto');
        const bytes = await Crypto.getRandomBytesAsync(32) as Uint8Array;
        const newKey = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
        await SecureStore.setItemAsync(keyName, newKey, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
        dbKey = newKey;
      }

      console.log('[Database] Opening encrypted SQLite database via op-sqlite...');
      const db = open({
        name: 'crop_ai_encrypted.db',
        encryptionKey: dbKey,
      });

      const driver = new NativeDatabaseDriver(db);

      const cipherResult = await driver.execute('PRAGMA cipher_version;');
      const cipherVersion = cipherResult.rows.item(0)?.cipher_version;
      assertSqlCipherAvailable(true, cipherVersion);

      dbDriver = driver;

      // Habilitar chaves estrangeiras imediatamente no driver nativo
      await driver.execute('PRAGMA foreign_keys = ON;');

      // Executar as Migrações (DDL) e Seed
      await runMigrationsAndSeed(driver);

      return dbDriver;
    } catch (error) {
      initPromise = null;
      console.error('[Database] Native encrypted database initialization failed.');
      throw error;
    }
  })();

  return initPromise;
}

// -------------------------------------------------------------
// Lógica de Migrações (DDL) e Seed Inicial para o SQLite Nativo
// -------------------------------------------------------------
export async function runMigrationsAndSeed(driver: IDatabaseDriver) {
  let version = 0;
  try {
    const versionRes = await driver.execute('PRAGMA user_version;');
    version = versionRes.rows._array[0]?.user_version || 0;
  } catch {
    console.warn('[Database] Failed to read user_version, assuming 0.');
  }

  console.log(`[Database] Current database version is: ${version}`);

  if (version < 1) {
    console.log('[Database] Running migration version 1...');

    await driver.execute(`
      CREATE TABLE IF NOT EXISTS culturas (
        id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        estagio_fenologico_padrao TEXT
      );
    `);

    // Criamos a tabela de doencas já com a coluna causa caso não existisse
    await driver.execute(`
      CREATE TABLE IF NOT EXISTS doencas (
        id TEXT PRIMARY KEY,
        id_cultura TEXT NOT NULL REFERENCES culturas(id),
        nome_comum TEXT NOT NULL,
        nome_cientifico TEXT,
        sintomas TEXT,
        nivel_severidade INTEGER CHECK(nivel_severidade BETWEEN 1 AND 5),
        causa TEXT
      );
    `);

    await driver.execute(`
      CREATE TABLE IF NOT EXISTS defensivos (
        id TEXT PRIMARY KEY,
        nome_comercial TEXT NOT NULL,
        ingrediente_ativo TEXT NOT NULL,
        classe TEXT NOT NULL,
        fabricante TEXT,
        grupo_quimico_frac TEXT,
        bula_resumida TEXT
      );
    `);

    await driver.execute(`
      CREATE TABLE IF NOT EXISTS doenca_defensivo (
        id_doenca TEXT NOT NULL REFERENCES doencas(id),
        id_defensivo TEXT NOT NULL REFERENCES defensivos(id),
        dosagem_recomendada TEXT NOT NULL,
        carencia_dias INTEGER NOT NULL,
        max_aplicacoes_ciclo INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (id_doenca, id_defensivo)
      );
    `);

    await driver.execute(`
      CREATE TABLE IF NOT EXISTS fila_diagnosticos (
        local_id TEXT PRIMARY KEY,
        server_id TEXT,
        image_uri TEXT NOT NULL,
        image_s3_key TEXT,
        latitude REAL,
        longitude REAL,
        doenca_id TEXT REFERENCES doencas(id),
        confianca_ia REAL,
        modelo_usado TEXT NOT NULL,
        tempo_inferencia_ms INTEGER,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        sync_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(sync_status IN ('PENDING', 'SYNCING', 'SYNCED', 'FAILED')),
        retry_count INTEGER NOT NULL DEFAULT 0
      );
    `);

    await driver.execute(`
      CREATE TABLE IF NOT EXISTS fila_feedbacks (
        id TEXT PRIMARY KEY,
        diagnostic_local_id TEXT NOT NULL REFERENCES fila_diagnosticos(local_id),
        is_correct INTEGER NOT NULL CHECK(is_correct IN (0, 1)),
        corrected_doenca_id TEXT REFERENCES doencas(id),
        user_correction_notes TEXT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        sync_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(sync_status IN ('PENDING', 'SYNCING', 'SYNCED', 'FAILED')),
        retry_count INTEGER NOT NULL DEFAULT 0
      );
    `);

    await driver.execute(`
      CREATE TABLE IF NOT EXISTS fila_slm_logs (
        session_id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        model_version TEXT NOT NULL,
        interactions_json TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(sync_status IN ('PENDING', 'SYNCING', 'SYNCED', 'FAILED')),
        retry_count INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  // v1 → add causa column to doencas
  if (version === 1) {
    console.log('[Database] Migrating version 1 to 2: Adding causa to doencas...');
    try {
      await driver.execute('ALTER TABLE doencas ADD COLUMN causa TEXT;');
    } catch {
      console.warn('[Database] causa column might already exist.');
    }
  }

  // v1 or v2 → add max_aplicacoes_ciclo to doenca_defensivo (fresh installs already have it from DDL)
  if (version >= 1 && version < 3) {
    console.log('[Database] Adding max_aplicacoes_ciclo to doenca_defensivo...');
    try {
      await driver.execute('ALTER TABLE doenca_defensivo ADD COLUMN max_aplicacoes_ciclo INTEGER NOT NULL DEFAULT 0;');
    } catch {
      console.warn('[Database] max_aplicacoes_ciclo column might already exist.');
    }
  }

  if (version < 2) {
    console.log('[Database] Seeding database version 2 with full Curated Catalog...');

    // 1. Cultura Soja
    await driver.execute(
      `INSERT OR REPLACE INTO culturas (id, nome, estagio_fenologico_padrao) VALUES (?, ?, ?);`,
      [
        'cultura-soja-id', 
        'Soja', 
        JSON.stringify(['Emergência (VE)', 'Cotilédone (VC)', 'Folha Simples (V1)', 'Trifólios (V2-Vn)', 'Floração (R1-R2)', 'Vagens (R3-R4)', 'Grãos (R5-R6)', 'Maturação (R7-R8)'])
      ]
    );

    // 2. Inserir todas as doenças do catálogo
    for (const d of doencasData) {
      await driver.execute(
        `INSERT OR REPLACE INTO doencas (id, id_cultura, nome_comum, nome_cientifico, sintomas, nivel_severidade, causa) VALUES (?, ?, ?, ?, ?, ?, ?);`,
        [
          d.id,
          d.id_cultura,
          d.nome_comum,
          d.nome_cientifico,
          d.sintomas,
          d.nivel_severidade,
          getCausaByNomeCientifico(d.nome_cientifico)
        ]
      );
    }

    // 3. Inserir todos os defensivos do catálogo
    for (const def of defensivosData) {
      await driver.execute(
        `INSERT OR REPLACE INTO defensivos (id, nome_comercial, ingrediente_ativo, classe, fabricante, grupo_quimico_frac, bula_resumida) VALUES (?, ?, ?, ?, ?, ?, ?);`,
        [
          def.id,
          def.nome_comercial,
          def.ingrediente_ativo,
          def.classe,
          def.fabricante,
          def.grupo_quimico_frac,
          JSON.stringify(def.bula_resumida)
        ]
      );
    }

    // 4. Inserir todas as relações doença-defensivo (primeiro limpando para evitar duplicatas órfãs)
    await driver.execute(`DELETE FROM doenca_defensivo;`);
    for (const rel of doencaDefensivoData) {
      await driver.execute(
        `INSERT OR REPLACE INTO doenca_defensivo (id_doenca, id_defensivo, dosagem_recomendada, carencia_dias, max_aplicacoes_ciclo) VALUES (?, ?, ?, ?, ?);`,
        [
          rel.doenca_id,
          rel.defensivo_id,
          rel.dosagem_recomendada,
          rel.carencia_dias,
          rel.max_aplicacoes_ciclo ?? 0
        ]
      );
    }

    await driver.execute('PRAGMA user_version = 3;');
    console.log('[Database] Database migration & seeding to version 3 complete!');
  }

  // v2 only: re-seed doenca_defensivo with max_aplicacoes_ciclo (missed in original v2 seed)
  if (version === 2) {
    console.log('[Database] Migrating version 2 to 3: Re-seeding doenca_defensivo with max_aplicacoes_ciclo...');
    await driver.execute(`DELETE FROM doenca_defensivo;`);
    for (const rel of doencaDefensivoData) {
      await driver.execute(
        `INSERT OR REPLACE INTO doenca_defensivo (id_doenca, id_defensivo, dosagem_recomendada, carencia_dias, max_aplicacoes_ciclo) VALUES (?, ?, ?, ?, ?);`,
        [
          rel.doenca_id,
          rel.defensivo_id,
          rel.dosagem_recomendada,
          rel.carencia_dias,
          rel.max_aplicacoes_ciclo ?? 0
        ]
      );
    }
    await driver.execute('PRAGMA user_version = 3;');
    console.log('[Database] Migration to version 3 complete!');
  }

  // v4: tabela de metadados de sincronização (catalog_etag, last_sync_at)
  if (version < 4) {
    console.log('[Database] Migrating to version 4: sync_metadata...');
    await driver.execute(`
      CREATE TABLE IF NOT EXISTS sync_metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
    await driver.execute('PRAGMA user_version = 4;');
  }

  // v5: campos da segunda opinião visual; aditivos para preservar bases existentes
  if (version < 5) {
    console.log('[Database] Migrating to version 5: cross-validation visual...');
    const statements = [
      "ALTER TABLE fila_diagnosticos ADD COLUMN cross_validation_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(cross_validation_status IN ('PENDING', 'CONFIRMED', 'ENRICHED', 'DIVERGENT', 'SKIPPED'));",
      'ALTER TABLE fila_diagnosticos ADD COLUMN llm_doenca_id TEXT REFERENCES doencas(id);',
      'ALTER TABLE fila_diagnosticos ADD COLUMN llm_doenca_nome TEXT;',
      'ALTER TABLE fila_diagnosticos ADD COLUMN llm_confianca REAL;',
      'ALTER TABLE fila_diagnosticos ADD COLUMN llm_observacoes TEXT;',
      'ALTER TABLE fila_diagnosticos ADD COLUMN cross_validation_error_code TEXT;',
    ];
    for (const statement of statements) {
      try {
        await driver.execute(statement);
      } catch {
        console.warn('[Database] Cross-validation column might already exist.');
      }
    }
    // ADD COLUMN NOT NULL DEFAULT preenche o default em todas as linhas
    // existentes. Elas são anteriores à cross-validation e nunca voltam ao
    // fluxo, então PENDING as deixaria eternamente "em análise" no servidor.
    // Neste ponto toda linha da tabela é legada, então o UPDATE é exato.
    await driver.execute(
      "UPDATE fila_diagnosticos SET cross_validation_status = 'SKIPPED' WHERE cross_validation_status = 'PENDING';"
    );
    await driver.execute('PRAGMA user_version = 5;');
  }

  if (version < 6) {
    console.log('[Database] Migrating to version 6: normalizando diagnósticos legados...');
    // Para quem já rodou a v5 sem o backfill. A cross-validation é disparada em
    // memória e não é retomada após reinício do app, então toda linha PENDING
    // sem nenhum dado de LLM é resíduo, nunca uma análise em andamento.
    await driver.execute(
      `UPDATE fila_diagnosticos SET cross_validation_status = 'SKIPPED'
       WHERE cross_validation_status = 'PENDING'
         AND llm_doenca_id IS NULL
         AND llm_observacoes IS NULL;`
    );
    await driver.execute('PRAGMA user_version = 6;');
    console.log('[Database] Migration to version 6 complete.');
  }

  if (version < 7) {
    console.log('[Database] Migrating to version 7: conversas persistidas...');

    await driver.execute(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id                          TEXT PRIMARY KEY,
        title                       TEXT NOT NULL,
        origin_diagnostic_local_id  TEXT REFERENCES fila_diagnosticos(local_id),
        created_at                  TEXT NOT NULL,
        updated_at                  TEXT NOT NULL,
        deleted_at                  TEXT,
        sync_status                 TEXT NOT NULL DEFAULT 'PENDING'
                                    CHECK(sync_status IN ('PENDING','SYNCING','SYNCED','FAILED')),
        retry_count                 INTEGER NOT NULL DEFAULT 0
      );
    `);

    await driver.execute(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id               TEXT PRIMARY KEY,
        session_id       TEXT NOT NULL REFERENCES chat_sessions(id),
        role             TEXT NOT NULL CHECK(role IN ('user','assistant')),
        content          TEXT NOT NULL,
        source           TEXT CHECK(source IN ('LOCAL_SLM','CLOUD_LLM')),
        attachment_json  TEXT,
        latency_ms       INTEGER,
        created_at       TEXT NOT NULL,
        sync_status      TEXT NOT NULL DEFAULT 'PENDING'
                         CHECK(sync_status IN ('PENDING','SYNCING','SYNCED','FAILED')),
        retry_count      INTEGER NOT NULL DEFAULT 0
      );
    `);

    await driver.execute(
      'CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);'
    );
    await driver.execute(
      'CREATE INDEX IF NOT EXISTS idx_chat_sessions_origin ON chat_sessions(origin_diagnostic_local_id);'
    );

    // Migra o que existe em fila_slm_logs. Tudo nasce PENDING, mesmo o que já
    // tinha subido pelo /sync/slm-logs: as tabelas de conversa no servidor só
    // existem no sub-projeto 4, e é para elas que precisa ir.
    const legacy = await driver.execute('SELECT * FROM fila_slm_logs;');
    for (const row of legacy.rows._array as Array<Record<string, any>>) {
      let interactions: Array<{ prompt?: string; response?: string; latency_ms?: number }> = [];
      try {
        interactions = JSON.parse(row.interactions_json || '[]');
      } catch {
        interactions = [];
      }
      // JSON válido que não é array ("{}", "null", "42") cai na mesma regra de
      // "sem interações": pular, nunca abortar a migração do aparelho inteiro.
      if (!Array.isArray(interactions) || interactions.length === 0) continue;

      const startedAt: string = row.started_at || new Date().toISOString();
      const title = String(interactions[0].prompt ?? 'Conversa').slice(0, 60);
      await driver.execute(
        `INSERT OR IGNORE INTO chat_sessions
           (id, title, origin_diagnostic_local_id, created_at, updated_at, deleted_at, sync_status, retry_count)
         VALUES (?, ?, NULL, ?, ?, NULL, 'PENDING', 0);`,
        [row.session_id, title, startedAt, startedAt]
      );

      // IDs derivados do session_id: únicos, determinísticos e sem depender de
      // expo-crypto dentro da migração.
      const base = Date.parse(startedAt) || Date.now();
      for (const [index, it] of interactions.entries()) {
        const userAt = new Date(base + index * 2).toISOString();
        const assistantAt = new Date(base + index * 2 + 1).toISOString();
        await driver.execute(
          `INSERT INTO chat_messages
             (id, session_id, role, content, source, attachment_json, latency_ms, created_at, sync_status, retry_count)
           VALUES (?, ?, 'user', ?, NULL, NULL, NULL, ?, 'PENDING', 0);`,
          [`${row.session_id}-u${index}`, row.session_id, String(it.prompt ?? ''), userAt]
        );
        await driver.execute(
          `INSERT INTO chat_messages
             (id, session_id, role, content, source, attachment_json, latency_ms, created_at, sync_status, retry_count)
           VALUES (?, ?, 'assistant', ?, 'LOCAL_SLM', NULL, ?, ?, 'PENDING', 0);`,
          [`${row.session_id}-a${index}`, row.session_id, String(it.response ?? ''), it.latency_ms ?? null, assistantAt]
        );
      }
    }

    await driver.execute('PRAGMA user_version = 7;');
    console.log('[Database] Migration to version 7 complete.');
  }

}

// -------------------------------------------------------------
// Metadados de Sincronização (catalog_etag, last_sync_at)
// -------------------------------------------------------------
export async function getSyncMeta(key: string): Promise<string | null> {
  const res = await dbDriver.execute('SELECT value FROM sync_metadata WHERE key = ?;', [key]);
  return res.rows.length > 0 ? (res.rows.item(0).value ?? null) : null;
}

export async function setSyncMeta(key: string, value: string): Promise<void> {
  await dbDriver.execute('INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?);', [key, value]);
}

import { Platform } from 'react-native';
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
// Driver de Fallback para Web (Memória)
// -------------------------------------------------------------
class WebDatabaseDriver implements IDatabaseDriver {
  private tables: { [tableName: string]: any[] } = {
    culturas: [
      { 
        id: 'cultura-soja-id', 
        nome: 'Soja', 
        estagio_fenologico_padrao: JSON.stringify(['Emergência (VE)', 'Cotilédone (VC)', 'Folha Simples (V1)', 'Trifólios (V2-Vn)', 'Floração (R1-R2)', 'Vagens (R3-R4)', 'Grãos (R5-R6)', 'Maturação (R7-R8)']) 
      }
    ],
    doencas: doencasData.map(d => ({
      id: d.id,
      id_cultura: d.id_cultura,
      nome_comum: d.nome_comum,
      nome_cientifico: d.nome_cientifico,
      sintomas: d.sintomas,
      nivel_severidade: d.nivel_severidade,
      causa: getCausaByNomeCientifico(d.nome_cientifico)
    })),
    defensivos: defensivosData.map(def => ({
      id: def.id,
      nome_comercial: def.nome_comercial,
      ingrediente_ativo: def.ingrediente_ativo,
      classe: def.classe,
      fabricante: def.fabricante,
      grupo_quimico_frac: def.grupo_quimico_frac,
      bula_resumida: JSON.stringify(def.bula_resumida)
    })),
    doenca_defensivo: doencaDefensivoData.map(rel => ({
      id_doenca: rel.doenca_id,
      id_defensivo: rel.defensivo_id,
      dosagem_recomendada: rel.dosagem_recomendada,
      carencia_dias: rel.carencia_dias,
      max_aplicacoes_ciclo: rel.max_aplicacoes_ciclo ?? 0
    })),
    fila_diagnosticos: [],
    fila_feedbacks: [],
    fila_slm_logs: [],
    sync_metadata: []
  };

  async execute(sql: string, params: any[] = []): Promise<QueryResult> {
    console.log(`[WebDB] Executing: ${sql}`, params);
    const sqlClean = sql.trim().replace(/\s+/g, ' ').toLowerCase();

    // SELECT value FROM sync_metadata WHERE key = ?
    if (sqlClean.startsWith('select value from sync_metadata')) {
      const row = this.tables.sync_metadata.find((r) => r.key === params[0]);
      const arr = row ? [{ value: row.value }] : [];
      return {
        rows: { _array: arr, length: arr.length, item: (idx: number) => arr[idx] },
        rowsAffected: 0,
      };
    }

    // 1. SELECT * FROM TABLE (com filtros simples)
    if (sqlClean.startsWith('select * from')) {
      const match = sqlClean.match(/select \* from (\w+)/);
      const tableName = match ? match[1] : '';
      let data = this.tables[tableName] || [];

      if (sqlClean.includes('where id = ?')) {
        data = data.filter(d => d.id === params[0]);
      }
      if (sqlClean.includes('where id_cultura = ?')) {
        data = data.filter(d => d.id_cultura === params[0]);
      }
      if (sqlClean.includes('where local_id = ?')) {
        data = data.filter(d => d.local_id === params[0]);
      }
      if (sqlClean.includes('where diagnostic_local_id = ?')) {
        data = data.filter(d => d.diagnostic_local_id === params[0]);
      }
      if (sqlClean.includes('where sync_status = ?') || sqlClean.includes("where sync_status = 'pending'")) {
        const status = params[0] || 'PENDING';
        data = data.filter(d => d.sync_status === status);
      }
      if (sqlClean.includes('where session_id = ?')) {
        data = data.filter(d => d.session_id === params[0]);
      }

      const rowsArray = JSON.parse(JSON.stringify(data));
      return {
        rows: {
          _array: rowsArray,
          length: rowsArray.length,
          item: (idx: number) => rowsArray[idx]
        },
        rowsAffected: 0
      };
    }

    // 2. INSERT (OR REPLACE) genérico — mapeia colunas declaradas para params; upsert pela 1ª coluna
    const insMatch = sqlClean.match(/^insert (?:or replace )?into (\w+)\s*\(([^)]+)\) values/);
    if (insMatch) {
      const tableName = insMatch[1];
      const cols = insMatch[2].split(',').map((c) => c.trim());
      const dataList = this.tables[tableName];
      if (dataList) {
        const rec: any = {};
        cols.forEach((c, i) => { rec[c] = params[i]; });
        // Defaults das filas (igual ao DDL nativo)
        if (!('timestamp' in rec) && (tableName === 'fila_diagnosticos' || tableName === 'fila_feedbacks')) {
          rec.timestamp = new Date().toISOString();
        }
        const keyCol = cols[0];
        const idx = dataList.findIndex((d) => d[keyCol] === rec[keyCol]);
        if (idx >= 0) {
          dataList[idx] = { ...dataList[idx], ...rec };
        } else {
          dataList.push(rec);
        }
        return {
          rows: { _array: [], length: 0, item: () => null },
          rowsAffected: 1,
          insertId: 1,
        };
      }
    }

    // 3. UPDATE genérico — todos os SETs do app usam apenas `col = ?` e WHERE de chave única
    const updMatch = sqlClean.match(/^update (\w+) set (.+?) where (\w+) = \?;?$/);
    if (updMatch) {
      const tableName = updMatch[1];
      const setCols = updMatch[2].split(',').map((s) => s.trim().split('=')[0].trim());
      const keyCol = updMatch[3];
      const dataList = this.tables[tableName];
      if (dataList) {
        const keyVal = params[params.length - 1];
        const item = dataList.find((d) => d[keyCol] === keyVal);
        if (item) {
          setCols.forEach((c, i) => { item[c] = params[i]; });
        }
        return {
          rows: { _array: [], length: 0, item: () => null },
          rowsAffected: item ? 1 : 0,
        };
      }
    }

    // 4. DELETE genérico (com ou sem WHERE de chave única)
    const delMatch = sqlClean.match(/^delete from (\w+)(?: where (\w+) = \?)?;?$/);
    if (delMatch) {
      const tableName = delMatch[1];
      const keyCol = delMatch[2];
      const dataList = this.tables[tableName];
      if (dataList) {
        if (keyCol) {
          this.tables[tableName] = dataList.filter((d) => d[keyCol] !== params[0]);
        } else {
          this.tables[tableName] = [];
        }
        return {
          rows: { _array: [], length: 0, item: () => null },
          rowsAffected: 1,
        };
      }
    }

    // Retorno genérico de sucesso vazio (ex. PRAGMA)
    return {
      rows: {
        _array: [],
        length: 0,
        item: () => null
      },
      rowsAffected: 0
    };
  }
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
export let dbDriver: IDatabaseDriver = new WebDatabaseDriver();
let initPromise: Promise<IDatabaseDriver> | null = null;

export async function initDatabase(): Promise<IDatabaseDriver> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    if (Platform.OS === 'web') {
      console.log('[Database] Web environment detected. Using mock memory database.');
      dbDriver = new WebDatabaseDriver();
      return dbDriver;
    }

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

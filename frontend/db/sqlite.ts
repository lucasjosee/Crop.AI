import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

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
    fila_slm_logs: []
  };

  async execute(sql: string, params: any[] = []): Promise<QueryResult> {
    console.log(`[WebDB] Executing: ${sql}`, params);
    const sqlClean = sql.trim().replace(/\s+/g, ' ').toLowerCase();

    // 1. SELECT ALL FROM TABLE (Simples)
    if (sqlClean.startsWith('select * from')) {
      const match = sqlClean.match(/select \* from (\w+)/);
      const tableName = match ? match[1] : '';
      let data = this.tables[tableName] || [];

      // Filtro simples de doencas por ID: id = ?
      if (sqlClean.includes('where id = ?') || sqlClean.includes('where id = ?;')) {
        const id = params[0];
        data = data.filter(d => d.id === id);
      }

      // Filtro simples de doencas por cultura: id_cultura = ?
      if (sqlClean.includes('where id_cultura = ?') || sqlClean.includes('where id_cultura = ?;')) {
        const idCultura = params[0];
        data = data.filter(d => d.id_cultura === idCultura);
      }

      // Filtro simples de fila de diagnosticos por sync_status = 'PENDING'
      if (sqlClean.includes("where sync_status = 'pending'") || sqlClean.includes("sync_status = ?")) {
        const status = params[0] || 'PENDING';
        data = data.filter(d => d.sync_status === status);
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

    // 2. INSERT INTO FILAS
    if (sqlClean.startsWith('insert into')) {
      const parts = sqlClean.split(' ');
      const tableName = parts[2].split('(')[0];
      const dataList = this.tables[tableName];
      if (dataList) {
        let newRecord: any = {};
        if (tableName === 'fila_diagnosticos') {
          newRecord = {
            local_id: params[0],
            server_id: params[1],
            image_uri: params[2],
            image_s3_key: params[3],
            latitude: params[4],
            longitude: params[5],
            doenca_id: params[6],
            confianca_ia: params[7],
            modelo_usado: params[8],
            tempo_inferencia_ms: params[9],
            timestamp: new Date().toISOString(),
            sync_status: params[10] || 'PENDING',
            retry_count: params[11] || 0
          };
        } else if (tableName === 'fila_feedbacks') {
          newRecord = {
            id: params[0],
            diagnostic_local_id: params[1],
            is_correct: params[2],
            corrected_doenca_id: params[3],
            user_correction_notes: params[4],
            timestamp: new Date().toISOString(),
            sync_status: params[5] || 'PENDING',
            retry_count: params[6] || 0
          };
        } else if (tableName === 'fila_slm_logs') {
          newRecord = {
            session_id: params[0],
            started_at: params[1],
            model_version: params[2],
            interactions_json: params[3],
            sync_status: params[4] || 'PENDING',
            retry_count: params[5] || 0
          };
        } else {
          newRecord = { id: params[0] || Math.random().toString(), data: params };
        }
        dataList.push(newRecord);
        return {
          rows: { _array: [], length: 0, item: () => null },
          rowsAffected: 1,
          insertId: 1
        };
      }
    }

    // 3. UPDATE FILAS
    if (sqlClean.startsWith('update')) {
      const parts = sqlClean.split(' ');
      const tableName = parts[1];
      const dataList = this.tables[tableName];
      if (dataList) {
        if (tableName === 'fila_diagnosticos' && sqlClean.includes('set sync_status = ?, server_id = ? where local_id = ?')) {
          const syncStatus = params[0];
          const serverId = params[1];
          const localId = params[2];
          const item = dataList.find(d => d.local_id === localId);
          if (item) {
            item.sync_status = syncStatus;
            item.server_id = serverId;
          }
          return { rows: { _array: [], length: 0, item: () => null }, rowsAffected: 1 };
        }
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
      const { open } = require('@op-engineering/op-sqlite');

      const keyName = 'crop_ai_db_secret_key';
      let dbKey = await SecureStore.getItemAsync(keyName);

      if (!dbKey) {
        console.log('[Database] Generating secure key via expo-crypto...');
        const Crypto = require('expo-crypto');
        const bytes = await Crypto.getRandomBytesAsync(32) as Uint8Array;
        const newKey = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
        await SecureStore.setItemAsync(keyName, newKey);
        dbKey = newKey;
      }

      console.log('[Database] Opening encrypted SQLite database via op-sqlite...');
      const db = open({
        name: 'crop_ai_encrypted.db',
        encryptionKey: dbKey,
      });

      const driver = new NativeDatabaseDriver(db);
      dbDriver = driver;

      // Habilitar chaves estrangeiras imediatamente no driver nativo
      await driver.execute('PRAGMA foreign_keys = ON;');

      // Executar as Migrações (DDL) e Seed
      await runMigrationsAndSeed(driver);

      return dbDriver;
    } catch (error) {
      console.error('[Database] Failed to initialize native database:', error);
      console.log('[Database] Falling back to Web Memory Database due to errors.');
      dbDriver = new WebDatabaseDriver();
      return dbDriver;
    }
  })();

  return initPromise;
}

// -------------------------------------------------------------
// Lógica de Migrações (DDL) e Seed Inicial para o SQLite Nativo
// -------------------------------------------------------------
async function runMigrationsAndSeed(driver: IDatabaseDriver) {
  let version = 0;
  try {
    const versionRes = await driver.execute('PRAGMA user_version;');
    version = versionRes.rows._array[0]?.user_version || 0;
  } catch (e) {
    console.warn('[Database] Failed to read user_version, assuming 0', e);
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
    } catch (e) {
      console.warn('[Database] causa column might already exist:', e);
    }
  }

  // v1 or v2 → add max_aplicacoes_ciclo to doenca_defensivo (fresh installs already have it from DDL)
  if (version >= 1 && version < 3) {
    console.log('[Database] Adding max_aplicacoes_ciclo to doenca_defensivo...');
    try {
      await driver.execute('ALTER TABLE doenca_defensivo ADD COLUMN max_aplicacoes_ciclo INTEGER NOT NULL DEFAULT 0;');
    } catch (e) {
      console.warn('[Database] max_aplicacoes_ciclo column might already exist:', e);
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
}

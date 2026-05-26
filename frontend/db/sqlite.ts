import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

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
        id: 'cultura_soja', 
        nome: 'Soja', 
        estagio_fenologico_padrao: JSON.stringify(['Emergência (VE)', 'Cotilédone (VC)', 'Folha Simples (V1)', 'Trifólios (V2-Vn)', 'Floração (R1-R2)', 'Vagens (R3-R4)', 'Grãos (R5-R6)', 'Maturação (R7-R8)']) 
      }
    ],
    doencas: [
      { 
        id: 'doenca_ferrugem_asiatica', 
        id_cultura: 'cultura_soja', 
        nome_comum: 'Ferrugem Asiática', 
        nome_cientifico: 'Phakopsora pachyrhizi', 
        sintomas: 'Pústulas pequenas de cor castanho-clara a escura na face inferior da folha, levando a amarelecimento e queda precoce de folhas.', 
        nivel_severidade: 4 
      },
      { 
        id: 'doenca_mancha_alvo', 
        id_cultura: 'cultura_soja', 
        nome_comum: 'Mancha Alvo', 
        nome_cientifico: 'Corynespora cassiicola', 
        sintomas: 'Pontos circulares avermelhados que evoluem para lesões circulares com anéis concêntricos escuros e halo amarelado.', 
        nivel_severidade: 3 
      }
    ],
    defensivos: [
      { 
        id: 'defensivo_priori_xtra', 
        nome_comercial: 'Priori Xtra', 
        ingrediente_ativo: 'Azoxistrobina + Ciproconazol', 
        classe: 'Fungicida', 
        fabricante: 'Syngenta',
        grupo_quimico_frac: 'Estrobilurina (C3) + Triazol (G1)',
        bula_resumida: 'Dosagem recomendada: 300 mL/ha. Aplicar no início do aparecimento das doenças ou preventivamente. Volume de calda de 100 a 200 L/ha.' 
      },
      { 
        id: 'defensivo_elatus', 
        nome_comercial: 'Elatus', 
        ingrediente_ativo: 'Azoxistrobina + Benzovindifluper', 
        classe: 'Fungicida', 
        fabricante: 'Syngenta',
        grupo_quimico_frac: 'Estrobilurina (C3) + Carboxamida (C2)',
        bula_resumida: 'Dosagem recomendada: 150 a 200 g/ha. Excelente controle preventivo da Ferrugem Asiática. Carência de 30 dias.' 
      }
    ],
    doenca_defensivo: [
      { id_doenca: 'doenca_ferrugem_asiatica', id_defensivo: 'defensivo_priori_xtra', dosagem_recomendada: '300 ml/ha', carencia_dias: 30 },
      { id_doenca: 'doenca_ferrugem_asiatica', id_defensivo: 'defensivo_elatus', dosagem_recomendada: '200 g/ha', carencia_dias: 30 },
      { id_doenca: 'doenca_mancha_alvo', id_defensivo: 'defensivo_priori_xtra', dosagem_recomendada: '300 ml/ha', carencia_dias: 30 }
    ],
    fila_diagnosticos: [],
    fila_feedbacks: [],
    fila_slm_logs: []
  };

  async execute(sql: string, params: any[] = []): Promise<QueryResult> {
    console.log(`[WebDB] Executing: ${sql}`, params);
    const sqlClean = sql.trim().replace(/\s+/g, ' ').toLowerCase();

    // 1. SELECT ALL FROM TABLE (Simples)
    if (sqlClean.startsWith('select * from')) {
      const parts = sqlClean.split(' ');
      const tableName = parts[3].replace(';', '').replace('(', '').replace(')', '');
      let data = this.tables[tableName] || [];

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
        // Mapear os parâmetros para um objeto simples baseados nas colunas comuns do DDL
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
          // Fallback genérico para mocks
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

    // Retorno genérico de sucesso vazio
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
    // op-sqlite retorna os registros diretamente em `rows`
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
      // Carrega o op-sqlite de forma segura apenas no ambiente nativo
      const { open } = require('@op-engineering/op-sqlite');

      // 1. Gerenciar a chave do SQLCipher no SecureStore
      const keyName = 'crop_ai_db_secret_key';
      let dbKey = await SecureStore.getItemAsync(keyName);

      if (!dbKey) {
        // Cria uma chave criptograficamente segura forte de 32 bytes usando expo-crypto
        console.log('[Database] Generating secure key via expo-crypto...');
        const Crypto = require('expo-crypto');
        const bytes = await Crypto.getRandomBytesAsync(32) as Uint8Array;
        const newKey = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
        await SecureStore.setItemAsync(keyName, newKey);
        dbKey = newKey;
      }

      // 2. Abrir o banco de dados nativo criptografado
      console.log('[Database] Opening encrypted SQLite database via op-sqlite...');
      const db = open({
        name: 'crop_ai_encrypted.db',
        encryptionKey: dbKey,
      });

      const driver = new NativeDatabaseDriver(db);
      dbDriver = driver;

      // 3. Executar as Migrações (DDL) e Seed
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
  // Obter ou inicializar o user_version
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

    // Criar as 4 tabelas de domínio
    await driver.execute(`
      CREATE TABLE IF NOT EXISTS culturas (
        id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        estagio_fenologico_padrao TEXT
      );
    `);

    await driver.execute(`
      CREATE TABLE IF NOT EXISTS doencas (
        id TEXT PRIMARY KEY,
        id_cultura TEXT NOT NULL REFERENCES culturas(id),
        nome_comum TEXT NOT NULL,
        nome_cientifico TEXT,
        sintomas TEXT,
        nivel_severidade INTEGER CHECK(nivel_severidade BETWEEN 1 AND 5)
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
        PRIMARY KEY (id_doenca, id_defensivo)
      );
    `);

    // Criar as 3 tabelas de fila (Store and Forward)
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

    // Injetar dados sementes iniciais locais para testes offline
    console.log('[Database] Seeding initial database catalog...');
    
    // Cultura Soja
    await driver.execute(
      `INSERT OR IGNORE INTO culturas (id, nome, estagio_fenologico_padrao) VALUES (?, ?, ?);`,
      [
        'cultura_soja', 
        'Soja', 
        JSON.stringify(['Emergência (VE)', 'Cotilédone (VC)', 'Folha Simples (V1)', 'Trifólios (V2-Vn)', 'Floração (R1-R2)', 'Vagens (R3-R4)', 'Grãos (R5-R6)', 'Maturação (R7-R8)'])
      ]
    );

    // Doenças (Ferrugem Asiática e Mancha Alvo)
    await driver.execute(
      `INSERT OR IGNORE INTO doencas (id, id_cultura, nome_comum, nome_cientifico, sintomas, nivel_severidade) VALUES (?, ?, ?, ?, ?, ?);`,
      [
        'doenca_ferrugem_asiatica', 
        'cultura_soja', 
        'Ferrugem Asiática', 
        'Phakopsora pachyrhizi', 
        'Pústulas pequenas de cor castanho-clara a escura na face inferior da folha, levando a amarelecimento e queda precoce de folhas.', 
        4
      ]
    );

    await driver.execute(
      `INSERT OR IGNORE INTO doencas (id, id_cultura, nome_comum, nome_cientifico, sintomas, nivel_severidade) VALUES (?, ?, ?, ?, ?, ?);`,
      [
        'doenca_mancha_alvo', 
        'cultura_soja', 
        'Mancha Alvo', 
        'Corynespora cassiicola', 
        'Pontos circulares avermelhados que evoluem para lesões circulares com anéis concêntricos escuros e halo amarelado.', 
        3
      ]
    );

    // Defensivos
    await driver.execute(
      `INSERT OR IGNORE INTO defensivos (id, nome_comercial, ingrediente_ativo, classe, fabricante, grupo_quimico_frac, bula_resumida) VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [
        'defensivo_priori_xtra',
        'Priori Xtra',
        'Azoxistrobina + Ciproconazol',
        'Fungicida',
        'Syngenta',
        'Estrobilurina (C3) + Triazol (G1)',
        'Dosagem recomendada: 300 mL/ha. Aplicar no início do aparecimento das doenças ou preventivamente. Volume de calda de 100 a 200 L/ha.'
      ]
    );

    await driver.execute(
      `INSERT OR IGNORE INTO defensivos (id, nome_comercial, ingrediente_ativo, classe, fabricante, grupo_quimico_frac, bula_resumida) VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [
        'defensivo_elatus',
        'Elatus',
        'Azoxistrobina + Benzovindifluper',
        'Fungicida',
        'Syngenta',
        'Estrobilurina (C3) + Carboxamida (C2)',
        'Dosagem recomendada: 150 a 200 g/ha. Excelente controle preventivo da Ferrugem Asiática. Carência de 30 dias.'
      ]
    );

    // Relações Doença-Defensivo
    await driver.execute(
      `INSERT OR IGNORE INTO doenca_defensivo (id_doenca, id_defensivo, dosagem_recomendada, carencia_dias) VALUES (?, ?, ?, ?);`,
      ['doenca_ferrugem_asiatica', 'defensivo_priori_xtra', '300 ml/ha', 30]
    );

    await driver.execute(
      `INSERT OR IGNORE INTO doenca_defensivo (id_doenca, id_defensivo, dosagem_recomendada, carencia_dias) VALUES (?, ?, ?, ?);`,
      ['doenca_ferrugem_asiatica', 'defensivo_elatus', '200 g/ha', 30]
    );

    await driver.execute(
      `INSERT OR IGNORE INTO doenca_defensivo (id_doenca, id_defensivo, dosagem_recomendada, carencia_dias) VALUES (?, ?, ?, ?);`,
      ['doenca_mancha_alvo', 'defensivo_priori_xtra', '300 ml/ha', 30]
    );

    // Atualizar user_version
    await driver.execute('PRAGMA user_version = 1;');
    console.log('[Database] Database migration & seeding complete!');
  }
}

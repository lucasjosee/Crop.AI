import '../store/test-globals';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  banco: null as null | { execute: (sql: string, params?: any[]) => Promise<any> },
  usuario: null as string | null,
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-secure-store', () => ({
  setItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock('../db/sqlite', async (importOriginal) => {
  const real = await importOriginal<typeof import('../db/sqlite')>();
  return { ...real, dbDriver: { execute: (sql: string, p?: any[]) => mocks.banco!.execute(sql, p) } };
});
vi.mock('./usuarioAtual', () => ({
  idDoUsuarioAtual: () => {
    if (!mocks.usuario) throw new Error('Nenhum usuário autenticado');
    return mocks.usuario;
  },
  idDoUsuarioAtualOuNulo: () => mocks.usuario,
}));
let seq = 0;
vi.mock('expo-crypto', () => ({ randomUUID: () => `id-${++seq}` }));
vi.mock('./imageHelper', () => ({ saveImagePersistently: vi.fn(async () => 'file:///documentos/foto.jpg') }));

import { criarBancoMigrado } from '../db/sqliteReal.testutil';
import { startDiagnosisSession } from './diagnosisSessionService';
import { createSession, reivindicarDadosSemDono } from './chatRepository';

async function iniciarAnalise() {
  const doenca = (await mocks.banco!.execute('SELECT id FROM doencas LIMIT 1;')).rows._array[0].id;
  return startDiagnosisSession({
    imageUri: 'file:///cache/foto.jpg',
    inference: { diseaseId: doenca, confidence: 0.9, inferenceTimeMs: 40, modelUsed: 'm' },
    diseaseName: 'Doença',
    gps: null,
    connectionMode: 'FIELD',
  } as any);
}

describe('escrita de raiz grava o dono', () => {
  beforeEach(async () => {
    mocks.banco = await criarBancoMigrado();
    mocks.usuario = 'A';
  });

  it('diagnóstico e conversa nascem com o dono do usuário atual', async () => {
    const { diagnosticLocalId, sessionId } = await iniciarAnalise();
    const d = await mocks.banco!.execute('SELECT user_id FROM fila_diagnosticos WHERE local_id = ?;', [diagnosticLocalId]);
    const s = await mocks.banco!.execute('SELECT user_id FROM chat_sessions WHERE id = ?;', [sessionId]);
    expect(d.rows._array[0].user_id).toBe('A');
    expect(s.rows._array[0].user_id).toBe('A');
  });

  it('sem usuário lança e não grava nada', async () => {
    mocks.usuario = null;
    await expect(iniciarAnalise()).rejects.toThrow(/usuário/);
    await expect(createSession({ title: 'x' })).rejects.toThrow(/usuário/);
    const n = await mocks.banco!.execute(
      'SELECT (SELECT COUNT(*) FROM fila_diagnosticos) + (SELECT COUNT(*) FROM chat_sessions) AS n;'
    );
    expect(n.rows._array[0].n).toBe(0);
  });
});

describe('reivindicarDadosSemDono', () => {
  async function semearSemDono() {
    const db = (mocks.banco = await criarBancoMigrado());
    const doenca = (await db.execute('SELECT id FROM doencas LIMIT 1;')).rows._array[0].id;
    for (const [id, dono] of [['velho', null], ['de-B', 'B']]) {
      await db.execute(
        `INSERT INTO fila_diagnosticos (local_id, image_uri, doenca_id, modelo_usado, user_id)
         VALUES (?, 'file:///x.jpg', ?, 'm', ?);`,
        [id, doenca, dono]
      );
      await db.execute(
        `INSERT INTO chat_sessions (id, title, created_at, updated_at, user_id) VALUES (?, 't', 'x', 'x', ?);`,
        [id, dono]
      );
    }
    return db;
  }
  const donos = async (db: { execute: (s: string) => Promise<any> }) => {
    const d = await db.execute('SELECT local_id, user_id FROM fila_diagnosticos ORDER BY local_id;');
    const s = await db.execute('SELECT id, user_id FROM chat_sessions ORDER BY id;');
    return [d.rows._array.map((r: any) => r.user_id), s.rows._array.map((r: any) => r.user_id)];
  };

  it('passa as linhas sem dono para a conta e não muda as que já têm dono', async () => {
    const db = await semearSemDono();
    await reivindicarDadosSemDono('A');
    expect(await donos(db)).toEqual([['B', 'A'], ['B', 'A']]);
  });

  it('rodar duas vezes, ou com outra conta depois, não muda nada', async () => {
    const db = await semearSemDono();
    await reivindicarDadosSemDono('A');
    await reivindicarDadosSemDono('A');
    await reivindicarDadosSemDono('C');
    expect(await donos(db)).toEqual([['B', 'A'], ['B', 'A']]);
  });
});

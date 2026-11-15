import dotenv from 'dotenv';
import path from 'path';

/**
 * A suíte do backend apaga tabelas inteiras do banco que `DATABASE_URL`
 * aponta. Sem esta guarda, rodá-la com o `.env` da raiz limpa o banco de
 * desenvolvimento. A regra: o nome do banco precisa conter `test`
 * (`cropai_test` no CI, `cropai_teste` na receita local).
 *
 * Pura: URL ausente ou malformada também é recusada.
 */
export function nomeDoBancoEhDeTeste(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;
  let nome: string;
  try {
    nome = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
  } catch {
    return false;
  }
  return nome.toLowerCase().includes('test');
}

/** `globalSetup` do vitest: aborta antes de qualquer teste. */
export default function guardaBancoDeTeste(): void {
  // Mesma origem que o env.ts usa: variável já definida vence o `.env`.
  dotenv.config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });
  const url = process.env.DATABASE_URL;
  if (nomeDoBancoEhDeTeste(url)) return;

  throw new Error(
    [
      'A suíte do backend apaga as tabelas do banco apontado por DATABASE_URL,',
      'e o nome do banco dela não contém "test". Abortando antes de qualquer teste.',
      'Rode contra um Postgres descartável, com a variável na frente do comando:',
      '  DATABASE_URL=postgres://teste:teste@127.0.0.1:55432/cropai_teste npx vitest run',
      '(receita completa em "Comandos" no CLAUDE.md).',
    ].join('\n')
  );
}

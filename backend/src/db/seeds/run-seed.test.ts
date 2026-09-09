import { describe, it, expect } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const run = promisify(execFile);

describe('run-seed (P3.9)', () => {
  // O catch engolia o erro e seed() resolvia normalmente, então o processo saía
  // com 0. Uma cadeia `db:migrate && db:seed && start` seguia adiante com o
  // catálogo pela metade, e todo /sync/diagnostics depois falhava com
  // INVALID_DOENCA_ID sem ninguém conseguir ligar a causa ao seed.
  it('sai com código diferente de zero quando o seed falha', async () => {
    const script = path.resolve(__dirname, 'run-seed.ts');
    let exitCode = 0;
    try {
      await run('npx', ['tsx', script], {
        env: { ...process.env, DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/naoexiste' },
        timeout: 60_000,
      });
    } catch (error) {
      exitCode = (error as { code?: number }).code ?? 0;
    }
    expect(exitCode).not.toBe(0);
  }, 70_000);
});

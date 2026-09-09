import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // As suítes de integração fazem, num minuto, muito mais requisições do que
    // um produtor real. O teste dedicado (src/app.test.ts) religa a limitação.
    env: { RATE_LIMIT_ENABLED: 'false' },
    // Integration tests share a real PostgreSQL instance — must run serially
    // to avoid FK constraint violations from concurrent db.delete(usuarios).
    fileParallelism: false,
    exclude: ['dist/**', 'node_modules/**'],
  },
});

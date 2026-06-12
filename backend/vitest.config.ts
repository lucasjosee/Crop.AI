import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests share a real PostgreSQL instance — must run serially
    // to avoid FK constraint violations from concurrent db.delete(usuarios).
    fileParallelism: false,
  },
});

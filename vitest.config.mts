import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` is a build-time guard for the Next bundler. Under Vitest we
      // are already in Node, so it resolves to a no-op.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // Integration tests share one emulator, so they run in a single worker to
    // keep collection state predictable. Concurrency is exercised explicitly
    // inside the tests that care about it, via Promise.all.
    pool: 'forks',
    maxForks: 1,
    minForks: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

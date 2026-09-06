import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // The store-backed suites share one SQLite file, so they must not run in
    // parallel against each other.
    fileParallelism: false,
    // Component suites opt into jsdom with a `@vitest-environment` docblock,
    // so the engine suites keep the faster node environment.
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false, // integration suites share the test database
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // allow importing repo-root tools/ modules (e.g. the m22 meal-history lib) from tests
  server: { fs: { allow: ['..'] } },
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false, // integration suites share the test database
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

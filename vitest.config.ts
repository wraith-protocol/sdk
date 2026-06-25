import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/reference/**'],
    testTimeout: 60000,
    exclude: ['**/node_modules/**', '**/reference/**', '**/bench/**'],
    testTimeout: 1200000, // 20 minutes for high-run nightly fuzz tests
  },
  benchmark: {
    include: ['test/chains/**/bench/**/*.bench.ts'],
    outputFile: './bench/results.json',
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/reference/**', '**/bench/**'],
  },
  benchmark: {
    include: ['test/chains/**/bench/**/*.bench.ts'],
    outputFile: './bench/results.json',
  },
});

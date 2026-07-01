import { defineConfig } from 'vitest/config';
import { describe, it, expect } from "vitest";

export default defineConfig({
  test: {
    globals: true,
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

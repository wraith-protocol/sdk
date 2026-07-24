import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    exclude: [
      '**/node_modules/**',
      '**/reference/**',
      '**/bench/**',
      // Vectors tests for non-Stellar chains reference fixtures that ship
      // only in future waves (packages/test-vectors/vectors/{ckb,evm,solana}.json).
      // Re-enable per chain when its fixture lands.
      'test/chains/ckb/vectors.test.ts',
      'test/chains/evm/vectors.test.ts',
      'test/chains/solana/vectors.test.ts',
    ],
    testTimeout: 1200000, // 20 minutes for high-run nightly fuzz tests
  },
  benchmark: {
    include: ['test/chains/**/bench/**/*.bench.ts'],
    outputFile: './bench/results.json',
  },
});

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// The framework packages import the agent client from its workspace package.
// Point that specifier at the source so the root suite does not need a build
// of `packages/sdk-agent` first.
const sdkAgentSrc = fileURLToPath(new URL('./packages/sdk-agent/src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@wraith-protocol/sdk-agent': sdkAgentSrc,
    },
  },
  test: {
    globals: true,
    typecheck: {
      include: ['**/*.test-d.ts'],
    },
    exclude: [
      '**/node_modules/**',
      '**/reference/**',
      '**/bench/**',
      // Svelte component tests require the package-level compiler plugin and jsdom.
      // The root test script runs this package separately with its own config.
      'packages/sdk-svelte/test/**',
      // Vectors tests for non-Stellar chains reference fixtures that ship
      // only in future waves (packages/test-vectors/vectors/{ckb,evm,solana}.json).
      // Re-enable per chain when its fixture lands.
      'test/chains/ckb/vectors.test.ts',
      'test/chains/evm/vectors.test.ts',
      'test/chains/solana/vectors.test.ts',
    ],
    testTimeout: 3600000, // 60 minutes for high-run nightly fuzz tests (100k runs takes ~6.5min + reporting overhead)
  },
  benchmark: {
    include: ['test/chains/**/bench/**/*.bench.ts', 'test/bench/**/*.bench.ts'],
    outputFile: './bench/results.json',
  },
});

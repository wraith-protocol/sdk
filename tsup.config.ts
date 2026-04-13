import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'chains/evm/index': 'src/chains/evm/index.ts',
    'chains/stellar/index': 'src/chains/stellar/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true,
  clean: true,
  treeshake: true,
});

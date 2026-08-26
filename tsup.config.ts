import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'chains/evm/index': 'src/chains/evm/index.ts',
    'chains/stellar/index': 'src/chains/stellar/index.ts',
    'chains/solana/index': 'src/chains/solana/index.ts',
    'chains/ckb/index': 'src/chains/ckb/index.ts',
    'compat/react-native': 'src/compat/react-native.ts',
    'vault/index': 'src/vault/index.ts',
    'agent/index': 'src/agent/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: {
    entry: {
      index: 'src/index.ts',
      'chains/evm/index': 'src/chains/evm/index.ts',
      'chains/stellar/index': 'src/chains/stellar/index.ts',
      'chains/solana/index': 'src/chains/solana/index.ts',
      'chains/ckb/index': 'src/chains/ckb/index.ts',
      'compat/react-native': 'src/compat/react-native.ts',
      'vault/index': 'src/vault/index.ts',
    },
  },
  splitting: true,
  clean: true,
  treeshake: true,
  external: ['@wraith-protocol/sdk-agent'],
  metafile: !!process.env.ANALYZE,
});

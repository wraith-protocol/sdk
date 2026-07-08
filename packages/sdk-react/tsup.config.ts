import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/native.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  external: [
    'react',
    'react-dom',
    '@wraith-protocol/sdk',
    '@wraith-protocol/sdk/chains/stellar',
    '@stellar/stellar-sdk',
    '@react-native-async-storage/async-storage',
    'expo-crypto',
    'react-native-get-random-values',
    'buffer',
  ],
  minify: true,
});

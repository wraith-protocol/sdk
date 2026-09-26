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
  // Every export in this package is a hook, so the whole bundle is a client
  // boundary. Bundlers generally hoist a source-level "use client" directive
  // to the top of the output, but pin it here too so Next.js App Router
  // still sees the marker if that hoisting behavior ever changes.
  banner: { js: '"use client";' },
});

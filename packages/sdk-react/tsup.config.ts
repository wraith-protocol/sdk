import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  external: ['react', '@wraith-protocol/sdk', '@stellar/stellar-sdk'],
  treeshake: true,
  splitting: false,
});

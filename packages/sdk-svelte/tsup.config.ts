import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  dts: false,
  splitting: true,
  clean: true,
  treeshake: true,
  external: ['svelte', '@wraith-protocol/sdk'],
});

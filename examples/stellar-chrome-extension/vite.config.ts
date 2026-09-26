import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

// @stellar/stellar-sdk (pulled in by the dynamic liveScan chunk) expects a
// global `Buffer`. Rather than a full Node-polyfill plugin, we alias the one
// module it needs to the standalone `buffer` package and provide the global via
// a tiny injected shim. The pure-crypto path (@noble/*) needs none of this.
export default defineConfig({
  plugins: [crx({ manifest })],
  resolve: {
    alias: {
      buffer: 'buffer/',
      'node:buffer': 'buffer/',
    },
  },
  define: {
    global: 'globalThis',
    'process.env': '{}',
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: { chunkFileNames: 'assets/[name]-[hash].js' },
    },
  },
  server: { port: 5199, strictPort: false },
});

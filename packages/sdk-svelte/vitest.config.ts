import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
  plugins: [svelte()],
  test: {
    globals: true,
    environment: 'jsdom',
  },
  resolve: {
    conditions: ['browser'],
    alias: {
      '@wraith-protocol/sdk': path.resolve(__dirname, '../../src'),
      '@wraith-protocol/sdk-agent': path.resolve(__dirname, '../sdk-agent/src'),
    },
  },
});

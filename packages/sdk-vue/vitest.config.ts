import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
  resolve: {
    alias: {
      '@wraith-protocol/sdk': path.resolve(__dirname, '../../src'),
      '@wraith-protocol/sdk-agent': path.resolve(__dirname, '../sdk-agent/src'),
    },
  },
});

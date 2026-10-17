import { defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';
import path from 'path';

export default defineConfig({
  plugins: [solidPlugin()],
  test: {
    environment: 'jsdom',
    globals: true,
    transformMode: {
      web: [/\.[jt]sx$/],
    },
  },
  resolve: {
    alias: {
      '@wraith-protocol/sdk': path.resolve(__dirname, '../../src'),
      '@wraith-protocol/sdk-agent': path.resolve(__dirname, '../sdk-agent/src'),
    },
    conditions: ['development', 'browser'],
  },
});

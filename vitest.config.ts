import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/reference/**'],
    testTimeout: 60000,
  },
});

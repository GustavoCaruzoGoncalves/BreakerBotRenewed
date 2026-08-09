import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@src': resolve(__dirname, './src'),
    },
    extensions: ['.ts', '.js'],
  },
});

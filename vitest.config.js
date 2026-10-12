import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    globalSetup: './tests/globalSetup.js',
    setupFiles: ['./tests/setup.js'],
    env: {
      NODE_ENV: 'test',
    },
  },
});

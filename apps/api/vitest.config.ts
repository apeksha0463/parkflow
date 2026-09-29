import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Tests always run against an isolated "<db>_test" database, never the dev/prod one.
loadEnv({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });
const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
const testUrl = process.env.TEST_DATABASE_URL ?? base.replace(/\/([^/?]+)(\?|$)/, '/$1_test$2');
if (!/_test(\?|$)/.test(testUrl)) throw new Error('Tests require a *_test database (set TEST_DATABASE_URL)');
process.env.DATABASE_URL = testUrl;

export default defineConfig({
  test: {
    environment: 'node',
    env: { NODE_ENV: 'test', DATABASE_URL: testUrl },
    globalSetup: ['./src/test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});

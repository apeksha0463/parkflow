import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// The workspace shares a single root .env file.
loadEnv({ path: path.resolve(import.meta.dirname, '../../.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  // Not required for `prisma generate` (e.g. in CI/install); required for migrate/seed.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});

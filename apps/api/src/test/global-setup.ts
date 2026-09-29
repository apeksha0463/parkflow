import { execSync } from 'node:child_process';
import path from 'node:path';

/** Applies migrations to the isolated test database (URL resolved in vitest.config.ts). */
export default function setup() {
  execSync('npx prisma migrate deploy', { cwd: path.resolve(import.meta.dirname, '../..'), env: process.env, stdio: 'pipe' });
}

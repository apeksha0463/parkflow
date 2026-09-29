import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '../lib/db.js';
import type { Role } from '../generated/prisma/client.js';

/** Empties all application tables (test database only). */
export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
}

export async function createUser(role: Role = 'USER', email = `${role.toLowerCase()}@test.local`, password = 'correct-horse-9') {
  return prisma.user.create({
    data: { email, name: `${role} user`, role, passwordHash: await bcrypt.hash(password, 4) },
  });
}

/** Returns a supertest agent logged in as the given user, sending the CSRF header on every request. */
export async function loginAs(app: Express, email: string, password = 'correct-horse-9') {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set('X-Requested-With', 'ParkFlow').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

export const CSRF = { 'X-Requested-With': 'ParkFlow' };

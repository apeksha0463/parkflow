/**
 * Base seed: initial admin account. Idempotent.
 * The Melbourne sensor zones and their historical replay are seeded separately (scripts/seed-melbourne.ts).
 */
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/db.js';

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12 || password === 'change-me-strong-password') {
    throw new Error('Set SEED_ADMIN_EMAIL and a strong SEED_ADMIN_PASSWORD (>= 12 chars) before seeding.');
  }

  const admin = await prisma.user.upsert({
    where: { email },
    create: { email, name: 'ParkFlow Admin', role: 'ADMIN', passwordHash: await bcrypt.hash(password, 12) },
    update: { role: 'ADMIN' },
  });
  console.log(`Admin ready: ${admin.email}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

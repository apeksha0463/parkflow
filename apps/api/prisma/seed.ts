/**
 * Base seed: initial admin account and the data-source registry.
 * Idempotent. Parking directory import and demo/simulation data are separate
 * scripts (added in later milestones) so they can never be confused with each other.
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

  const sources = [
    {
      name: 'OpenStreetMap',
      sourceType: 'VERIFIED_DIRECTORY' as const,
      url: 'https://www.openstreetmap.org/',
      license: 'ODbL 1.0 — © OpenStreetMap contributors',
      description: 'Bengaluru parking locations imported from OpenStreetMap via the Overpass API. Location and tags only; no availability.',
    },
    {
      name: 'ParkFlow Simulation',
      sourceType: 'SIMULATION' as const,
      url: null,
      license: null,
      description: 'Historical-replay simulation used for demonstration. Not live sensor data.',
    },
  ];
  for (const s of sources) {
    await prisma.dataSource.upsert({ where: { name: s.name }, create: s, update: s });
  }
  console.log(`Data sources ready: ${sources.map((s) => s.name).join(', ')}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

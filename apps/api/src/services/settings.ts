import { z } from 'zod';
import { prisma } from '../lib/db.js';

/**
 * Admin-configurable system settings. Stored as key/value rows in SystemConfig;
 * missing keys fall back to these documented defaults.
 */
export const SettingsSchema = z
  .object({
    /** Occupancy at or above which a zone is SATURATED. */
    saturationThreshold: z.number().gt(0.5).lte(1),
    /** Occupancy at or above which a zone is APPROACHING_SATURATION. Must be below saturationThreshold. */
    approachingThreshold: z.number().gt(0.3).lt(1),
    /** Zones within this straight-line distance (metres) are treated as neighbours. */
    neighbourRadiusMeters: z.number().int().min(100).max(5000),
    /** Availability older than this is shown as stale, never as current. */
    staleAfterMinutes: z.number().int().min(1).max(24 * 60),
  })
  .refine((s) => s.approachingThreshold < s.saturationThreshold, {
    message: 'approachingThreshold must be lower than saturationThreshold',
    path: ['approachingThreshold'],
  });

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  saturationThreshold: 0.9,
  approachingThreshold: 0.8,
  neighbourRadiusMeters: 800,
  staleAfterMinutes: 30,
};

const KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

export async function getSettings(): Promise<Settings> {
  const rows = await prisma.systemConfig.findMany({ where: { key: { in: KEYS } } });
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) merged[row.key] = row.value;
  const parsed = SettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function updateSettings(patch: Partial<Settings>, actorId: string): Promise<Settings> {
  const next = SettingsSchema.parse({ ...(await getSettings()), ...patch });
  await prisma.$transaction(
    Object.entries(patch).map(([key, value]) =>
      prisma.systemConfig.upsert({
        where: { key },
        create: { key, value: value as number, updatedById: actorId },
        update: { value: value as number, updatedById: actorId },
      }),
    ),
  );
  return next;
}

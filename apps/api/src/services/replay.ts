/**
 * SIMULATION MODE — historical parking data replay.
 *
 * Demo zones (facility.isDemo, availabilityMode SIMULATION, zone.replaySourceZone set) receive occupancy
 * snapshots replayed from the research dataset's test period (see ml/parkflow_ml/replay.py). The replayed
 * value for a wall-clock instant is the recorded value at the same weekday and time of day, cycling through
 * the exported weeks. Every snapshot is written with sourceType SIMULATION; nothing here is live data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../lib/db.js';
import { syncSaturation } from './spillover.js';

export interface ReplayZone {
  sourceZone: string;
  label: string;
  sensorCount: number;
  eastM: number;
  northM: number;
  occupancy: (number | null)[];
  observedBays: number[];
}

export interface ReplayPayload {
  dataset: string;
  licence: string;
  note: string;
  stepMinutes: number;
  replayStart: string;
  weeks: number;
  zones: ReplayZone[];
}

const STEP_MS = 5 * 60_000;
const WEEK_STEPS = 7 * 288;
const BACKFILL_MS = 7 * 24 * 3_600_000 + STEP_MS;

export const DEFAULT_REPLAY_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../data/processed/replay_cluster.json');

export function loadReplay(file = process.env.REPLAY_DATA_PATH || DEFAULT_REPLAY_PATH): ReplayPayload | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as ReplayPayload;
}

/** Index into the replay series for a grid instant: same weekday + time of day (local wall clock), cycling weeks. */
export function replayIndex(t: Date, weeks: number): number {
  const weekday = (t.getDay() + 6) % 7; // Monday = 0
  const slot = weekday * 288 + Math.floor((t.getHours() * 60 + t.getMinutes()) / 5);
  const localDay = Math.floor((t.getTime() - t.getTimezoneOffset() * 60_000) / 86_400_000);
  const week = Math.floor((localDay - 4) / 7); // 1970-01-05 was a Monday
  return (((week % weeks) + weeks) % weeks) * WEEK_STEPS + slot;
}

/** Writes replay snapshots for every grid instant in (from, to]. Idempotent. Returns rows written. */
export async function writeReplaySnapshots(payload: ReplayPayload, from: Date, to: Date): Promise<number> {
  const zones = await prisma.parkingZone.findMany({
    where: { replaySourceZone: { not: null }, facility: { isDemo: true, availabilityMode: 'SIMULATION' } },
    select: { id: true, replaySourceZone: true },
  });
  const bySource = new Map(payload.zones.map((z) => [z.sourceZone, z]));
  const rows = [];
  for (let t = Math.floor(from.getTime() / STEP_MS) * STEP_MS + STEP_MS; t <= to.getTime(); t += STEP_MS) {
    const at = new Date(t);
    const idx = replayIndex(at, payload.weeks);
    for (const z of zones) {
      const src = bySource.get(z.replaySourceZone!);
      const occ = src?.occupancy[idx];
      const cap = src?.observedBays[idx];
      if (occ == null || !cap) continue; // unknown in the source stays unknown
      const occupied = Math.round(occ * cap);
      rows.push({ zoneId: z.id, observedAt: at, occupied, capacity: cap, available: cap - occupied, occupancy: occ, sourceType: 'SIMULATION' as const });
    }
  }
  let written = 0;
  for (let i = 0; i < rows.length; i += 5000) {
    written += (await prisma.occupancySnapshot.createMany({ data: rows.slice(i, i + 5000), skipDuplicates: true })).count;
  }
  return written;
}

/** Backfills one week and then keeps replay snapshots current. No-op without demo zones or replay data. */
export async function startReplay(log: (msg: string) => void = console.log): Promise<NodeJS.Timeout | null> {
  const payload = loadReplay();
  if (!payload) {
    log('Simulation replay: no replay data file; simulation mode inactive');
    return null;
  }
  const count = await prisma.parkingZone.count({ where: { replaySourceZone: { not: null }, facility: { isDemo: true } } });
  if (!count) {
    log('Simulation replay: no demo zones seeded (npm run db:seed:simulation -w apps/api)');
    return null;
  }
  const tick = async () => {
    const now = new Date();
    await writeReplaySnapshots(payload, new Date(now.getTime() - BACKFILL_MS), now);
    await syncSaturation(now);
  };
  await tick();
  log(`Simulation replay active for ${count} demo zones (${payload.dataset}, ${payload.weeks} weeks)`);
  const timer = setInterval(() => tick().catch((err) => log(`Simulation replay tick failed: ${err instanceof Error ? err.message : err}`)), 60_000);
  timer.unref();
  return timer;
}

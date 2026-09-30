/**
 * HISTORICAL REPLAY — City of Melbourne on-street parking sensors, 2019 (test split).
 *
 * The recorded history is loaded into the database once (scripts/seed-melbourne.ts) with its real 2019
 * timestamps. A single server-side replay clock maps wall-clock time to a 2019 instant; every "current"
 * value in the API is the recorded value at the replay clock. Nothing here is live data, and the UI always
 * labels it "Historical replay".
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../lib/db.js';

export const SOURCE_NAME = 'City of Melbourne on-street parking sensors (2019)';

export interface ReplayZone {
  key: string;
  label: string;
  street: string | null;
  area: string | null;
  sensorCount: number;
  latitude: number;
  longitude: number;
  neighbours: { key: string; distanceM: number }[];
  occupancy: (number | null)[];
  bays: number[];
  events: { onset: number; end: number | null; peak: number }[];
}

export interface ReplayPayload {
  dataset: string;
  licence: string;
  sourceUrl: string;
  note: string;
  timezone: string;
  stepMinutes: number;
  seriesStart: string;
  replayStart: string;
  replayEnd: string;
  steps: number;
  saturationThreshold: number;
  neighbourRadiusM: number;
  zonesWithoutReplayData: number;
  zones: ReplayZone[];
}

export const DEFAULT_REPLAY_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../data/processed/replay_melbourne.json');

export function loadReplay(file = process.env.REPLAY_DATA_PATH || DEFAULT_REPLAY_PATH): ReplayPayload | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as ReplayPayload;
}

// ---------------------------------------------------------------------------
// Replay clock
// ---------------------------------------------------------------------------
export const STEP_MS = 5 * 60_000;
const RANGE_KEY = 'replayRange';
const CLOCK_KEY = 'replayClock';

export interface ReplayRange {
  start: string;
  end: string;
  timezone: string;
  dataset: string;
}

interface ClockState {
  /** Replay instant at `anchor`. */
  replayAt: string;
  /** Wall-clock instant the state was set. */
  anchor: string;
  playing: boolean;
  speed: number;
}

export interface ReplayClock {
  configured: boolean;
  /** Current replay instant, floored to the 5-minute grid. */
  now: Date;
  playing: boolean;
  speed: number;
  range: ReplayRange | null;
}

export async function setReplayRange(range: ReplayRange) {
  await prisma.systemConfig.upsert({ where: { key: RANGE_KEY }, create: { key: RANGE_KEY, value: { ...range } }, update: { value: { ...range } } });
}

let cached: { at: number; clock: ReplayClock } | null = null;
const CACHE_MS = 2000;

export function clearReplayCache() {
  cached = null;
}

const floor = (ms: number) => Math.floor(ms / STEP_MS) * STEP_MS;

/** Pure: the replay instant for a clock state at wall time `wall`, wrapping around the replay range. */
export function replayInstant(state: ClockState, range: ReplayRange, wall: number): number {
  const start = new Date(range.start).getTime();
  const end = new Date(range.end).getTime();
  let t = new Date(state.replayAt).getTime() + (state.playing ? (wall - new Date(state.anchor).getTime()) * state.speed : 0);
  const span = end - start + STEP_MS;
  if (t < start || t > end) t = start + ((((t - start) % span) + span) % span);
  return floor(t);
}

/** The server replay clock. When no replay is seeded, falls back to wall-clock time (configured: false). */
export async function getReplayClock(wall: number = Date.now()): Promise<ReplayClock> {
  if (cached && wall - cached.at < CACHE_MS) return cached.clock;
  const rows = await prisma.systemConfig.findMany({ where: { key: { in: [RANGE_KEY, CLOCK_KEY] } } });
  const range = rows.find((r) => r.key === RANGE_KEY)?.value as ReplayRange | undefined;
  let clock: ReplayClock;
  if (!range) {
    clock = { configured: false, now: new Date(wall), playing: true, speed: 1, range: null };
  } else {
    const state = (rows.find((r) => r.key === CLOCK_KEY)?.value as ClockState | undefined) ?? {
      replayAt: range.start,
      anchor: new Date(wall).toISOString(),
      playing: true,
      speed: 1,
    };
    clock = { configured: true, now: new Date(replayInstant(state, range, wall)), playing: state.playing, speed: state.speed, range };
  }
  cached = { at: wall, clock };
  return clock;
}

/** The instant every "current" value refers to. */
export async function replayNow(): Promise<Date> {
  return (await getReplayClock()).now;
}

/** Seek and/or play/pause the replay clock. `at` must lie within the replay range. */
export async function setReplayClock(patch: { at?: Date; playing?: boolean; speed?: number }, wall: number = Date.now()): Promise<ReplayClock> {
  clearReplayCache();
  const current = await getReplayClock(wall);
  if (!current.range) throw new Error('Replay is not configured');
  const state: ClockState = {
    replayAt: new Date(floor((patch.at ?? current.now).getTime())).toISOString(),
    anchor: new Date(wall).toISOString(),
    playing: patch.playing ?? current.playing,
    speed: patch.speed ?? current.speed,
  };
  await prisma.systemConfig.upsert({ where: { key: CLOCK_KEY }, create: { key: CLOCK_KEY, value: { ...state } }, update: { value: { ...state } } });
  clearReplayCache();
  return getReplayClock(wall);
}

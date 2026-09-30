/**
 * Short-term occupancy predictions for parking zones.
 *
 * A prediction is only requested when a zone has recent occupancy snapshots at the replay clock. Otherwise
 * the response says why no prediction exists; nothing is ever estimated here.
 * Model inputs are built from stored snapshots on the model's 5-minute grid; neighbours are the research
 * neighbour pairs (ZoneNeighbour, from the pipeline's neighbours.csv) within the model's trained radius.
 *
 * The models are trained on the Melbourne 2019 sensor dataset, so predictions are served ONLY for zones
 * replaying that dataset (availabilityMode REPLAY). Any other facility gets NO_MODEL.
 */
import { prisma } from '../lib/db.js';
import { getSettings } from './settings.js';
import { getRegistry, MlRefusedError, MlUnavailableError, predict, type ModelMeta, type Registry } from './ml.js';

export const STEP_MIN = 5;
/** One week + current instant: enough for the weekly lag feature. */
export const HISTORY_STEPS = 7 * 24 * (60 / STEP_MIN) + 1;
const STEP_MS = STEP_MIN * 60_000;

export type PredictionStatus = 'AVAILABLE' | 'INSUFFICIENT_DATA' | 'NO_MODEL' | 'STALE' | 'SERVICE_UNAVAILABLE';

export const STATUS_MESSAGE: Record<Exclude<PredictionStatus, 'AVAILABLE'>, string> = {
  INSUFFICIENT_DATA: 'Prediction unavailable — insufficient historical data.',
  NO_MODEL: 'Prediction unavailable — no model has been trained for this area yet.',
  STALE: 'Prediction unavailable — occupancy data is out of date.',
  SERVICE_UNAVAILABLE: 'Prediction temporarily unavailable.',
};

export interface ZonePrediction {
  zoneId: string;
  zoneName: string;
  basedOn: string;
  currentOccupancy: number;
  currentState: string | null;
  neighboursUsed: number;
  isSimulated: boolean;
  predictions: { horizonMinutes: number; targetTime: string; predictedOccupancy: number; pressureLevel: string | null }[];
}

export interface FacilityPredictions {
  status: PredictionStatus;
  message: string | null;
  provenance: 'PREDICTED';
  model: { id: string; featureSet: string; trainingDataset: string; trainedAt: string } | null;
  zones: ZonePrediction[];
}

const unavailable = (status: Exclude<PredictionStatus, 'AVAILABLE'>): FacilityPredictions => ({
  status,
  message: STATUS_MESSAGE[status],
  provenance: 'PREDICTED',
  model: null,
  zones: [],
});

/** Pressure level from the admin-configured thresholds (same rule as the ML pipeline's states). */
export function pressureLevel(occupancy: number | null, s: { saturationThreshold: number; approachingThreshold: number }): string | null {
  if (occupancy == null) return null;
  if (occupancy >= s.saturationThreshold) return 'SATURATED';
  if (occupancy >= s.approachingThreshold) return 'APPROACHING_SATURATION';
  return 'NORMAL';
}

export const floorToStep =(d: Date) => new Date(Math.floor(d.getTime() / STEP_MS) * STEP_MS);

export const DATA_TIMEZONE = 'Australia/Melbourne';
const wallFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: DATA_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Melbourne wall-clock ISO string — the model's time features are local wall-clock based, as in training. */
export function wallClock(d: Date): string {
  const p = Object.fromEntries(wallFormat.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00`;
}

/**
 * Occupancy per zone on the grid ending at `end` (oldest first). Each instant takes the latest snapshot in
 * (t - 5 min, t]; instants without a snapshot are null (unknown), never interpolated.
 */
export async function gridHistories(zoneIds: string[], end: Date, steps = HISTORY_STEPS): Promise<Map<string, (number | null)[]>> {
  const start = new Date(end.getTime() - (steps - 1) * STEP_MS - STEP_MS);
  const rows = await prisma.occupancySnapshot.findMany({
    where: { zoneId: { in: zoneIds }, observedAt: { gt: start, lte: end } },
    select: { zoneId: true, observedAt: true, occupancy: true },
    orderBy: { observedAt: 'asc' },
  });
  const out = new Map(zoneIds.map((id) => [id, Array<number | null>(steps).fill(null)]));
  const t0 = end.getTime() - (steps - 1) * STEP_MS;
  for (const r of rows) {
    // index of the first grid instant at or after the observation, if it is within one step
    const idx = Math.ceil((r.observedAt.getTime() - t0) / STEP_MS);
    if (idx >= 0 && idx < steps) out.get(r.zoneId)![idx] = r.occupancy; // ascending order: later snapshots win
  }
  return out;
}

/** Research neighbours of a zone within the model's radius, nearest first. */
export async function neighbourZones(zoneId: string, radiusM: number) {
  const rows = await prisma.zoneNeighbour.findMany({
    // Only zones replaying the same dataset can be model inputs.
    where: { zoneId, distanceM: { lte: radiusM }, neighbour: { facility: { availabilityMode: 'REPLAY' } } },
    orderBy: { distanceM: 'asc' },
    take: 50,
    select: { neighbourId: true, distanceM: true },
  });
  return rows.map((r) => ({ id: r.neighbourId, distance: r.distanceM }));
}

export function activeModel(registry: Registry): ModelMeta {
  return registry.models.find((m) => m.id === registry.active) ?? registry.models[0];
}

async function ensureModelVersion(meta: ModelMeta, isActive: boolean) {
  await prisma.modelVersion.upsert({
    where: { id: meta.id },
    create: {
      id: meta.id,
      featureSet: meta.feature_set === 'temporal' ? 'TEMPORAL' : 'SPATIAL_TEMPORAL',
      algorithm: meta.algorithm,
      trainingDataset: meta.training_dataset,
      trainedAt: new Date(meta.trained_at),
      featureVersion: meta.feature_version,
      horizonsMinutes: meta.horizons_minutes,
      metrics: meta.test_metrics as object,
      isActive,
    },
    update: { isActive },
  });
}

export async function predictZone(
  zone: { id: string; name: string },
  meta: ModelMeta,
  settings: { saturationThreshold: number; approachingThreshold: number },
  now: Date,
): Promise<ZonePrediction | 'INSUFFICIENT_DATA'> {
  const latest = await prisma.occupancySnapshot.findFirst({ where: { zoneId: zone.id, observedAt: { lte: now } }, orderBy: { observedAt: 'desc' } });
  if (!latest || latest.capacity == null || latest.capacity <= 0) return 'INSUFFICIENT_DATA';
  const end = floorToStep(latest.observedAt);
  const isSimulated = latest.sourceType === 'SIMULATION';

  // Reuse a stored prediction for the same model and base time instead of re-calling the ML service.
  const stored = await prisma.prediction.findMany({
    where: { zoneId: zone.id, modelVersionId: meta.id, predictionTime: end },
    orderBy: { horizonMinutes: 'asc' },
  });
  const nbs = meta.feature_set === 'spatial_temporal' ? await neighbourZones(zone.id, meta.config.neighbour_radius_m) : [];
  const histories = await gridHistories([zone.id, ...nbs.map((n) => n.id)], end);
  const history = histories.get(zone.id)!;
  if (stored.length === meta.horizons_minutes.length) {
    const current = history[history.length - 1] ?? latest.occupancy;
    return {
      zoneId: zone.id,
      zoneName: zone.name,
      basedOn: end.toISOString(),
      currentOccupancy: current,
      currentState: pressureLevel(current, settings),
      neighboursUsed: nbs.length,
      isSimulated,
      predictions: stored.map((p) => ({
        horizonMinutes: p.horizonMinutes,
        targetTime: p.targetTime.toISOString(),
        predictedOccupancy: p.predictedOccupancy,
        pressureLevel: pressureLevel(p.predictedOccupancy, settings),
      })),
    };
  }

  let result;
  try {
    result = await predict({
      zoneId: zone.id,
      timestamp: wallClock(end),
      history,
      observedBays: latest.capacity,
      neighbours: nbs.map((n) => ({ distanceM: n.distance, history: histories.get(n.id)! })),
      model: meta.id,
    });
  } catch (err) {
    if (err instanceof MlRefusedError && err.code === 'INSUFFICIENT_HISTORY') return 'INSUFFICIENT_DATA';
    throw err;
  }

  await ensureModelVersion(meta, true);
  const predictions = result.predictions.map((p) => ({ ...p, targetTime: new Date(end.getTime() + p.horizonMinutes * 60_000) }));
  await prisma.prediction.createMany({
    data: predictions.map((p) => ({
      zoneId: zone.id,
      modelVersionId: meta.id,
      predictionTime: end,
      horizonMinutes: p.horizonMinutes,
      targetTime: p.targetTime,
      predictedOccupancy: p.predictedOccupancy,
      isSimulated,
    })),
    skipDuplicates: true,
  });
  return {
    zoneId: zone.id,
    zoneName: zone.name,
    basedOn: end.toISOString(),
    currentOccupancy: result.currentOccupancy,
    currentState: pressureLevel(result.currentOccupancy, settings),
    neighboursUsed: result.neighboursUsed,
    isSimulated,
    predictions: predictions.map((p) => ({
      horizonMinutes: p.horizonMinutes,
      targetTime: p.targetTime.toISOString(),
      predictedOccupancy: p.predictedOccupancy,
      pressureLevel: pressureLevel(p.predictedOccupancy, settings),
    })),
  };
}

export async function facilityPredictions(facilityId: string, now: Date): Promise<FacilityPredictions | null> {
  const facility = await prisma.parkingFacility.findUnique({
    where: { id: facilityId },
    select: { availabilityMode: true, zones: { select: { id: true, name: true } } },
  });
  if (!facility) return null;
  if (facility.availabilityMode === 'NONE' || facility.zones.length === 0) return unavailable('INSUFFICIENT_DATA');
  // The models are trained on the Melbourne sensors: never apply them to any other source.
  if (facility.availabilityMode !== 'REPLAY') return unavailable('NO_MODEL');

  const settings = await getSettings();
  const latest = await prisma.occupancySnapshot.findFirst({
    where: { zoneId: { in: facility.zones.map((z) => z.id) }, observedAt: { lte: now } },
    orderBy: { observedAt: 'desc' },
    select: { observedAt: true },
  });
  if (!latest) return unavailable('INSUFFICIENT_DATA');
  if (now.getTime() - latest.observedAt.getTime() > settings.staleAfterMinutes * 60_000) return unavailable('STALE');

  let meta: ModelMeta;
  try {
    meta = activeModel(await getRegistry());
  } catch (err) {
    if (err instanceof MlUnavailableError) return unavailable('SERVICE_UNAVAILABLE');
    throw err;
  }

  const zones: ZonePrediction[] = [];
  try {
    for (const z of facility.zones) {
      const r = await predictZone(z, meta, settings, now);
      if (r !== 'INSUFFICIENT_DATA') zones.push(r);
    }
  } catch (err) {
    if (err instanceof MlUnavailableError) return unavailable('SERVICE_UNAVAILABLE');
    throw err;
  }
  if (!zones.length) return unavailable('INSUFFICIENT_DATA');
  return {
    status: 'AVAILABLE',
    message: null,
    provenance: 'PREDICTED',
    model: { id: meta.id, featureSet: meta.feature_set, trainingDataset: meta.training_dataset, trainedAt: meta.trained_at },
    zones,
  };
}

/** Fills actualOccupancy/absError for predictions whose target time has an observation (±half a step). */
export async function evaluateDuePredictions(now: Date): Promise<number> {
  return prisma.$executeRaw`
    WITH due AS (
      SELECT p.id,
             (SELECT s.occupancy FROM "OccupancySnapshot" s
               WHERE s."zoneId" = p."zoneId"
                 AND s."observedAt" BETWEEN p."targetTime" - interval '150 seconds' AND p."targetTime" + interval '150 seconds'
               ORDER BY abs(extract(epoch FROM s."observedAt" - p."targetTime"))
               LIMIT 1) AS actual
        FROM "Prediction" p
       WHERE p."actualOccupancy" IS NULL AND p."targetTime" <= ${now}
    )
    UPDATE "Prediction" p
       SET "actualOccupancy" = due.actual,
           "absError" = abs(p."predictedOccupancy" - due.actual),
           "evaluatedAt" = ${now}
      FROM due
     WHERE due.id = p.id AND due.actual IS NOT NULL`;
}

// ---------------------------------------------------------------------------
// Predicted vs actual (historical replay)
// ---------------------------------------------------------------------------
export interface PvaPoint {
  /** Base time: the latest observation the prediction uses. */
  predictionTime: string;
  targetTime: string;
  /** Recorded occupancy at the target time; null when no reading was recorded. */
  actual: number | null;
  /** Persistence baseline: the occupancy at prediction time carried forward. */
  persistence: number | null;
  /** Predicted occupancy per model id; null when the model could not predict (insufficient history). */
  predicted: Record<string, number | null>;
}

const CONCURRENCY = 4;

async function pool<T>(items: T[], fn: (x: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let x = queue.shift(); x !== undefined; x = queue.shift()) await fn(x);
  }));
}

/**
 * Predictions of every registered model for each 5-minute base time in [from, to], next to the recorded outcome.
 * Predictions are served by the ML service from the recorded history (and cached in Prediction); actuals are the
 * recorded values. Nothing is interpolated: a missing reading stays null.
 */
export async function predictedVsActual(zoneId: string, from: Date, to: Date, registry: Registry) {
  const models = registry.models;
  const horizons = [...new Set(models.flatMap((m) => m.horizons_minutes))].sort((a, b) => a - b);
  const maxH = Math.max(...horizons);
  const start = floorToStep(from);
  const stop = floorToStep(to);
  const n = Math.round((stop.getTime() - start.getTime()) / STEP_MS) + 1;
  const extra = maxH / STEP_MIN;
  const radius = Math.max(...models.map((m) => m.config.neighbour_radius_m));
  const nbs = await neighbourZones(zoneId, radius);
  const end = new Date(stop.getTime() + maxH * 60_000);
  const histories = await gridHistories([zoneId, ...nbs.map((x) => x.id)], end, HISTORY_STEPS + n - 1 + extra);
  const own = histories.get(zoneId)!;
  const bays = await prisma.occupancySnapshot.findMany({
    where: { zoneId, observedAt: { gte: start, lte: stop } },
    select: { observedAt: true, capacity: true },
  });
  const baysAt = new Map(bays.map((b) => [b.observedAt.getTime(), b.capacity]));

  // Index in the history arrays of base time i: the arrays end at `end` = stop + maxH.
  const idx = (i: number) => HISTORY_STEPS - 1 + i;
  const points: PvaPoint[][] = horizons.map(() => []);
  const predicted = new Map<string, number>(); // `${model}|${i}|${h}` -> value

  const stored = await prisma.prediction.findMany({
    where: { zoneId, modelVersionId: { in: models.map((m) => m.id) }, predictionTime: { gte: start, lte: stop } },
    select: { modelVersionId: true, predictionTime: true, horizonMinutes: true, predictedOccupancy: true },
  });
  for (const p of stored) {
    const i = Math.round((p.predictionTime.getTime() - start.getTime()) / STEP_MS);
    predicted.set(`${p.modelVersionId}|${i}|${p.horizonMinutes}`, p.predictedOccupancy);
  }

  const jobs: { meta: ModelMeta; i: number }[] = [];
  for (const meta of models) {
    for (let i = 0; i < n; i++) {
      if (own[idx(i)] == null) continue;
      if (meta.horizons_minutes.every((h) => predicted.has(`${meta.id}|${i}|${h}`))) continue;
      jobs.push({ meta, i });
    }
  }
  const created: { zoneId: string; modelVersionId: string; predictionTime: Date; horizonMinutes: number; targetTime: Date; predictedOccupancy: number }[] = [];
  await pool(jobs, async ({ meta, i }) => {
    const base = new Date(start.getTime() + i * STEP_MS);
    const cap = baysAt.get(base.getTime());
    if (!cap) return;
    const lo = idx(i) - HISTORY_STEPS + 1;
    const useNb = meta.feature_set === 'spatial_temporal';
    try {
      const r = await predict({
        zoneId,
        timestamp: wallClock(base),
        history: own.slice(lo, idx(i) + 1),
        observedBays: cap,
        neighbours: useNb
          ? nbs.filter((x) => x.distance <= meta.config.neighbour_radius_m).map((x) => ({ distanceM: x.distance, history: histories.get(x.id)!.slice(lo, idx(i) + 1) }))
          : [],
        model: meta.id,
      });
      for (const p of r.predictions) {
        predicted.set(`${meta.id}|${i}|${p.horizonMinutes}`, p.predictedOccupancy);
        created.push({ zoneId, modelVersionId: meta.id, predictionTime: base, horizonMinutes: p.horizonMinutes, targetTime: new Date(base.getTime() + p.horizonMinutes * 60_000), predictedOccupancy: p.predictedOccupancy });
      }
    } catch (err) {
      if (!(err instanceof MlRefusedError)) throw err;
    }
  });
  if (created.length) {
    for (const meta of models) await ensureModelVersion(meta, meta.id === registry.active);
    await prisma.prediction.createMany({ data: created, skipDuplicates: true });
  }

  horizons.forEach((h, hi) => {
    for (let i = 0; i < n; i++) {
      const base = start.getTime() + i * STEP_MS;
      points[hi].push({
        predictionTime: new Date(base).toISOString(),
        targetTime: new Date(base + h * 60_000).toISOString(),
        actual: own[idx(i) + h / STEP_MIN] ?? null,
        persistence: own[idx(i)] ?? null,
        predicted: Object.fromEntries(models.map((m) => [m.id, predicted.get(`${m.id}|${i}|${h}`) ?? null])),
      });
    }
  });
  return {
    zoneId,
    neighboursUsed: nbs.length,
    models: models.map((m) => ({ id: m.id, featureSet: m.feature_set, active: m.id === registry.active })),
    horizons: horizons.map((h, hi) => ({ horizonMinutes: h, points: points[hi] })),
  };
}

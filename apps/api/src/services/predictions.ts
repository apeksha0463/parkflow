/**
 * Short-term occupancy predictions for parking zones.
 *
 * A prediction is only requested when a zone has recent occupancy snapshots (live or clearly-labelled
 * simulation). Otherwise the response says why no prediction exists; nothing is ever estimated here.
 * Model inputs are built from stored snapshots on the model's 5-minute grid; neighbours are other zones
 * within the radius the model was trained with (read from the model metadata).
 */
import { prisma } from '../lib/db.js';
import { getSettings } from './settings.js';
import { getRegistry, MlRefusedError, MlUnavailableError, predict, type ModelMeta, type Registry } from './ml.js';

export const STEP_MIN = 5;
/** One week + current instant: enough for the weekly lag feature. */
export const HISTORY_STEPS = 7 * 24 * (60 / STEP_MIN) + 1;
const STEP_MS = STEP_MIN * 60_000;

export type PredictionStatus = 'AVAILABLE' | 'INSUFFICIENT_DATA' | 'STALE' | 'SERVICE_UNAVAILABLE';

export const STATUS_MESSAGE: Record<Exclude<PredictionStatus, 'AVAILABLE'>, string> = {
  INSUFFICIENT_DATA: 'Prediction unavailable — insufficient historical data.',
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

/** Local wall-clock ISO string (process TZ, Asia/Kolkata) — the model's time features are wall-clock based. */
export function wallClock(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
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

async function neighbourZones(zoneId: string, radiusM: number) {
  return prisma.$queryRaw<{ id: string; distance: number }[]>`
    SELECT n.id, ST_Distance(n.location, z.location) AS distance
      FROM "ParkingZone" z
      JOIN "ParkingZone" n ON n.id <> z.id AND ST_DWithin(n.location, z.location, ${radiusM})
      JOIN "ParkingFacility" f ON f.id = n."facilityId" AND f."availabilityMode" <> 'NONE'
     WHERE z.id = ${zoneId}
     ORDER BY distance
     LIMIT 50`;
}

function activeModel(registry: Registry): ModelMeta {
  return registry.models.find((m) => m.id === registry.active) ?? registry.models[0];
}

async function ensureModelVersion(meta: ModelMeta) {
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
      isActive: true,
    },
    update: { isActive: true },
  });
  await prisma.modelVersion.updateMany({ where: { id: { not: meta.id } }, data: { isActive: false } });
}

export async function predictZone(
  zone: { id: string; name: string },
  meta: ModelMeta,
  settings: { saturationThreshold: number; approachingThreshold: number },
  now: Date = new Date(),
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

  await ensureModelVersion(meta);
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

export async function facilityPredictions(facilityId: string, now: Date = new Date()): Promise<FacilityPredictions | null> {
  const facility = await prisma.parkingFacility.findUnique({
    where: { id: facilityId },
    select: { availabilityMode: true, zones: { select: { id: true, name: true } } },
  });
  if (!facility) return null;
  if (facility.availabilityMode === 'NONE' || facility.zones.length === 0) return unavailable('INSUFFICIENT_DATA');

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
export async function evaluateDuePredictions(now: Date = new Date()): Promise<number> {
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

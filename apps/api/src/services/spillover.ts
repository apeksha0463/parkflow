/**
 * Saturation tracking and spillover warnings.
 *
 * - SaturationEvent rows are the research-defined events of the replayed history (seed-melbourne.ts):
 *   saturated after >= 30 min known and below the threshold. The event "active" at the replay clock is the
 *   one that started at or before it and had not ended.
 * - Neighbours are the research neighbour pairs (200 m) the spatial-temporal model was trained with.
 * - Warnings describe *predicted* pressure in neighbouring zones; they never state that drivers move
 *   between zones or that a zone "will" fill.
 * - Alternatives are ranked from current availability, predicted occupancy (when available) and distance,
 *   and each carries the reason built from those values.
 */
import { prisma } from '../lib/db.js';
import { getSettings, type Settings } from './settings.js';
import { availabilityFor, displayName, isCurrent, isOpenNow, type AvailabilitySummary } from './facilities.js';
import { facilityPredictions, pressureLevel, type FacilityPredictions } from './predictions.js';
import { getRegistry, MlUnavailableError } from './ml.js';

export const WARNING_HORIZON_MIN = 15;
/** Distance penalty in the ranking: +0.1 occupancy-equivalent per km. */
const DISTANCE_WEIGHT_PER_KM = 0.1;

interface Candidate {
  id: string;
  displayName: string;
  type: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  openNow: boolean | null;
  availability: AvailabilitySummary;
  predicted: { horizonMinutes: number; predictedOccupancy: number; pressureLevel: string | null } | null;
  predictionStatus: FacilityPredictions['status'];
}

function horizonPrediction(p: FacilityPredictions | null) {
  if (!p || p.status !== 'AVAILABLE') return null;
  const zone = p.zones[0];
  if (!zone) return null;
  return zone.predictions.find((x) => x.horizonMinutes === WARNING_HORIZON_MIN) ?? zone.predictions.at(-1) ?? null;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function rankAlternatives(cands: Candidate[], s: Settings) {
  const usable = cands.filter((c) => {
    if (c.openNow === false) return false;
    if (!isCurrent(c.availability.state) || c.availability.occupancy == null) return false;
    if (c.availability.occupancy >= s.saturationThreshold) return false;
    if (c.predicted && c.predicted.predictedOccupancy >= s.saturationThreshold) return false;
    return true;
  });
  return usable
    .map((c) => {
      const basis = c.predicted?.predictedOccupancy ?? c.availability.occupancy!;
      const score = basis + (c.distanceMeters / 1000) * DISTANCE_WEIGHT_PER_KM;
      const parts: string[] = [];
      if (c.availability.available != null) parts.push(`${c.availability.available} spaces currently available`);
      else parts.push(`currently ${pct(c.availability.occupancy!)} occupied`);
      if (c.predicted) parts.push(`predicted occupancy ${pct(c.predicted.predictedOccupancy)} in ${c.predicted.horizonMinutes} min`);
      else parts.push('no prediction available');
      parts.push(`${(c.distanceMeters / 1000).toFixed(1)} km away`);
      return { ...c, score, reason: `Suggested because it has ${parts.join(', ')}.` };
    })
    .sort((a, b) => a.score - b.score);
}

/** The saturation event of a zone that is in progress at `now` (started at or before, not yet ended). */
export async function activeEventAt(zoneIds: string[], now: Date) {
  return prisma.saturationEvent.findFirst({
    where: { zoneId: { in: zoneIds }, startedAt: { lte: now }, OR: [{ endedAt: null }, { endedAt: { gt: now } }] },
    orderBy: { startedAt: 'desc' },
  });
}

/** Warnings and alternatives around a facility at the replay instant `now`. */
export async function spilloverAround(facilityId: string, now: Date) {
  const s = await getSettings();
  const origin = await prisma.parkingFacility.findUnique({ where: { id: facilityId }, select: { id: true, availabilityMode: true, zones: { select: { id: true } } } });
  if (!origin) return null;
  const zoneIds = origin.zones.map((z) => z.id);

  const originAvail = (await availabilityFor([origin], s.staleAfterMinutes, now)).get(origin.id)!;
  const activeEvent = await activeEventAt(zoneIds, now);
  const originPredictions = origin.availabilityMode === 'NONE' ? null : await facilityPredictions(origin.id, now);

  // Research neighbour pairs of the facility's zones, nearest first; one row per neighbouring facility.
  const pairs = await prisma.zoneNeighbour.findMany({
    where: { zoneId: { in: zoneIds } },
    orderBy: { distanceM: 'asc' },
    select: { distanceM: true, neighbour: { select: { facilityId: true } } },
  });
  const distanceOf = new Map<string, number>();
  for (const p of pairs) if (!distanceOf.has(p.neighbour.facilityId) && p.neighbour.facilityId !== facilityId) distanceOf.set(p.neighbour.facilityId, p.distanceM);
  const neighbourRadiusMeters = await researchRadius();

  const facilities = await prisma.parkingFacility.findMany({ where: { id: { in: [...distanceOf.keys()] } } });
  const byId = new Map(facilities.map((f) => [f.id, f]));
  const avail = await availabilityFor(facilities, s.staleAfterMinutes, now);

  const candidates: Candidate[] = [];
  for (const [id, distance] of distanceOf) {
    const f = byId.get(id)!;
    const a = avail.get(f.id)!;
    const preds = f.availabilityMode === 'NONE' ? null : await facilityPredictions(f.id, now);
    candidates.push({
      id: f.id,
      ...displayName(f.name, f.type, f.area),
      type: f.type,
      latitude: f.latitude,
      longitude: f.longitude,
      distanceMeters: Math.round(distance),
      openNow: isOpenNow(f.operatingHours, now),
      availability: a,
      predicted: horizonPrediction(preds),
      predictionStatus: preds?.status ?? 'INSUFFICIENT_DATA',
    });
  }

  const originPressure = originAvail.occupancy != null && isCurrent(originAvail.state) ? pressureLevel(originAvail.occupancy, s) : null;
  const warnings = candidates
    .filter((c) => c.predicted && c.availability.occupancy != null && c.predicted.predictedOccupancy >= s.approachingThreshold && c.predicted.predictedOccupancy > c.availability.occupancy)
    .map((c) => ({
      facilityId: c.id,
      displayName: c.displayName,
      distanceMeters: c.distanceMeters,
      currentOccupancy: c.availability.occupancy,
      predictedOccupancy: c.predicted!.predictedOccupancy,
      horizonMinutes: c.predicted!.horizonMinutes,
      message: `Parking pressure is predicted to increase around ${c.displayName}: predicted occupancy ${pct(c.predicted!.predictedOccupancy)} in ${c.predicted!.horizonMinutes} min (currently ${pct(c.availability.occupancy!)}).`,
    }));
  const warnedIds = new Set(warnings.map((w) => w.facilityId));

  return {
    facilityId,
    at: now.toISOString(),
    thresholds: { saturation: s.saturationThreshold, approaching: s.approachingThreshold },
    neighbourRadiusMeters,
    warningHorizonMinutes: WARNING_HORIZON_MIN,
    origin: { availability: originAvail, pressureLevel: originPressure, activeSaturationEvent: activeEvent, predictions: originPredictions },
    // Only raised when the origin is at/near saturation — otherwise there is no spillover context.
    spilloverContext: originPressure === 'SATURATED' || originPressure === 'APPROACHING_SATURATION',
    warnings,
    // A zone we warn about (pressure predicted to rise) is never also recommended as an alternative.
    alternatives: rankAlternatives(candidates.filter((c) => !warnedIds.has(c.id)), s).slice(0, 5),
    neighbours: candidates,
    provenance: { current: originAvail.state, predictions: 'PREDICTED' },
  };
}

/** The neighbour radius the active model was trained with; null when the ML service is unreachable. */
async function researchRadius(): Promise<number | null> {
  try {
    const r = await getRegistry();
    return (r.models.find((m) => m.id === r.active) ?? r.models[0])?.config.neighbour_radius_m ?? null;
  } catch (err) {
    if (err instanceof MlUnavailableError) return null;
    throw err;
  }
}

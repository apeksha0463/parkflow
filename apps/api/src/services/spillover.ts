/**
 * Saturation tracking and spillover warnings.
 *
 * - Zone saturation state and SaturationEvent rows are derived from the latest occupancy snapshots
 *   using the admin-configured thresholds.
 * - Warnings describe *predicted* pressure in neighbouring zones; they never state that drivers move
 *   between zones or that a zone "will" fill.
 * - Alternatives are ranked from current availability, predicted occupancy (when available) and distance,
 *   and each carries the reason built from those values.
 */
import { prisma } from '../lib/db.js';
import { getSettings, type Settings } from './settings.js';
import { availabilityFor, displayName, isOpenNow, type AvailabilitySummary } from './facilities.js';
import { facilityPredictions, pressureLevel, type FacilityPredictions } from './predictions.js';

export const WARNING_HORIZON_MIN = 15;
/** Matches EVENT_MIN_BELOW_MINUTES in the ML pipeline. */
const EVENT_DEBOUNCE_MS = 30 * 60_000;
/** Distance penalty in the ranking: +0.1 occupancy-equivalent per km. */
const DISTANCE_WEIGHT_PER_KM = 0.1;

/** Updates zone states and opens/closes saturation events from each zone's latest snapshot. */
export async function syncSaturation(now: Date = new Date()): Promise<{ opened: number; closed: number }> {
  const s = await getSettings();
  const latest = await prisma.$queryRaw<{ zoneId: string; observedAt: Date; occupancy: number; sourceType: string; state: string }[]>`
    SELECT DISTINCT ON (sn."zoneId") sn."zoneId", sn."observedAt", sn.occupancy, sn."sourceType", z."saturationState"::text AS state
      FROM "OccupancySnapshot" sn
      JOIN "ParkingZone" z ON z.id = sn."zoneId"
      JOIN "ParkingFacility" f ON f.id = z."facilityId" AND f."availabilityMode" <> 'NONE'
     WHERE sn."observedAt" <= ${now}
     ORDER BY sn."zoneId", sn."observedAt" DESC`;
  let opened = 0;
  let closed = 0;
  for (const r of latest) {
    const state = pressureLevel(r.occupancy, s)!;
    if (state !== r.state) {
      await prisma.parkingZone.update({ where: { id: r.zoneId }, data: { saturationState: state as 'NORMAL' } });
    }
    const open = await prisma.saturationEvent.findFirst({ where: { zoneId: r.zoneId, endedAt: null } });
    if (state === 'SATURATED') {
      // Same rule as the research pipeline: re-saturating within 30 min of an event ending is the same event.
      const recent = open
        ? null
        : await prisma.saturationEvent.findFirst({
            where: { zoneId: r.zoneId, endedAt: { gte: new Date(r.observedAt.getTime() - EVENT_DEBOUNCE_MS) } },
            orderBy: { endedAt: 'desc' },
          });
      if (recent) {
        await prisma.saturationEvent.update({
          where: { id: recent.id },
          data: { endedAt: null, peakOccupancy: Math.max(recent.peakOccupancy, r.occupancy) },
        });
      } else if (!open) {
        await prisma.saturationEvent.create({
          data: { zoneId: r.zoneId, startedAt: r.observedAt, peakOccupancy: r.occupancy, threshold: s.saturationThreshold, isSimulated: r.sourceType === 'SIMULATION' },
        });
        opened++;
      } else if (r.occupancy > open.peakOccupancy) {
        await prisma.saturationEvent.update({ where: { id: open.id }, data: { peakOccupancy: r.occupancy } });
      }
    } else if (open && r.observedAt > open.startedAt) {
      await prisma.saturationEvent.update({ where: { id: open.id }, data: { endedAt: r.observedAt } });
      closed++;
    }
  }
  return { opened, closed };
}

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
    const current = c.availability.state === 'LIVE' || c.availability.state === 'SIMULATED';
    if (!current || c.availability.occupancy == null) return false;
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

/** Warnings and alternatives around a facility, based on its neighbours' current and predicted state. */
export async function spilloverAround(facilityId: string) {
  const s = await getSettings();
  const origin = await prisma.parkingFacility.findUnique({ where: { id: facilityId }, select: { id: true, availabilityMode: true, zones: { select: { id: true } } } });
  if (!origin) return null;

  const originAvail = (await availabilityFor([origin], s.staleAfterMinutes)).get(origin.id)!;
  const activeEvent = await prisma.saturationEvent.findFirst({
    where: { zoneId: { in: origin.zones.map((z) => z.id) }, endedAt: null },
    orderBy: { startedAt: 'desc' },
  });

  const rows = await prisma.$queryRaw<{ id: string; distance: number }[]>`
    SELECT n.id, ST_Distance(n.location, f.location) AS distance
      FROM "ParkingFacility" f
      JOIN "ParkingFacility" n ON n.id <> f.id AND ST_DWithin(n.location, f.location, ${s.neighbourRadiusMeters})
     WHERE f.id = ${facilityId}
     ORDER BY distance
     LIMIT 20`;
  const facilities = await prisma.parkingFacility.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
  const byId = new Map(facilities.map((f) => [f.id, f]));
  const avail = await availabilityFor(facilities, s.staleAfterMinutes);

  const candidates: Candidate[] = [];
  for (const r of rows) {
    const f = byId.get(r.id)!;
    const a = avail.get(f.id)!;
    const preds = f.availabilityMode === 'NONE' ? null : await facilityPredictions(f.id);
    candidates.push({
      id: f.id,
      ...displayName(f.name, f.type, f.area),
      type: f.type,
      latitude: f.latitude,
      longitude: f.longitude,
      distanceMeters: Math.round(r.distance),
      openNow: isOpenNow(f.operatingHours),
      availability: a,
      predicted: horizonPrediction(preds),
      predictionStatus: preds?.status ?? 'INSUFFICIENT_DATA',
    });
  }

  const originPressure = originAvail.occupancy != null && (originAvail.state === 'LIVE' || originAvail.state === 'SIMULATED')
    ? pressureLevel(originAvail.occupancy, s)
    : null;
  const warnings = candidates
    .filter((c) => c.predicted && c.availability.occupancy != null && c.predicted.predictedOccupancy >= s.approachingThreshold && c.predicted.predictedOccupancy > c.availability.occupancy)
    .map((c) => ({
      facilityId: c.id,
      displayName: c.displayName,
      currentOccupancy: c.availability.occupancy,
      predictedOccupancy: c.predicted!.predictedOccupancy,
      horizonMinutes: c.predicted!.horizonMinutes,
      message: `Parking pressure is likely to increase around ${c.displayName}: predicted occupancy ${pct(c.predicted!.predictedOccupancy)} in ${c.predicted!.horizonMinutes} min (currently ${pct(c.availability.occupancy!)}).`,
    }));
  const warnedIds = new Set(warnings.map((w) => w.facilityId));

  return {
    facilityId,
    thresholds: { saturation: s.saturationThreshold, approaching: s.approachingThreshold },
    neighbourRadiusMeters: s.neighbourRadiusMeters,
    origin: { availability: originAvail, pressureLevel: originPressure, activeSaturationEvent: activeEvent },
    // Only raised when the origin is at/near saturation — otherwise there is no spillover context.
    spilloverContext: originPressure === 'SATURATED' || originPressure === 'APPROACHING_SATURATION',
    warnings,
    // A zone we warn about (pressure predicted to rise) is never also recommended as an alternative.
    alternatives: rankAlternatives(candidates.filter((c) => !warnedIds.has(c.id)), s).slice(0, 5),
    neighbours: candidates,
    provenance: { current: originAvail.state, predictions: 'PREDICTED' },
  };
}

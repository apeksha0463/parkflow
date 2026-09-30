/**
 * Facility presentation + availability summaries.
 *
 * Availability is reported ONLY from stored occupancy snapshots, with provenance and freshness.
 * A facility with no availability source is reported as UNAVAILABLE — never estimated.
 */
import OpeningHours from 'opening_hours';
import { prisma } from '../lib/db.js';
import type { AvailabilityMode, ParkingType, SourceType } from '../generated/prisma/client.js';

export const TYPE_LABEL: Record<ParkingType, string> = {
  PUBLIC: 'Public',
  ON_STREET: 'On-street',
  OFF_STREET: 'Off-street',
  MULTI_LEVEL: 'Multi-level',
  UNDERGROUND: 'Underground',
  MALL: 'Mall',
  HOSPITAL: 'Hospital',
  HOTEL: 'Hotel',
  METRO: 'Metro',
  RAILWAY: 'Railway',
  EDUCATIONAL: 'Campus',
  COMMERCIAL: 'Commercial',
  PRIVATE_PUBLIC_ACCESS: 'Private (public access)',
  RESIDENTIAL: 'Residential',
  EV_CHARGING: 'EV charging',
  UNKNOWN: 'Unclassified',
};

export function displayName(name: string | null, type: ParkingType, area: string | null): { displayName: string; nameIsDerived: boolean } {
  if (name) return { displayName: name, nameIsDerived: false };
  const base = type === 'EV_CHARGING' ? 'EV charging point' : type === 'UNKNOWN' ? 'Parking' : `${TYPE_LABEL[type]} parking`;
  return { displayName: area ? `${base} near ${area}` : base, nameIsDerived: true };
}

/** true/false when the hours string parses; null when unknown or unparseable. */
export function isOpenNow(hours: string | null, at: Date = new Date()): boolean | null {
  if (!hours) return null;
  try {
    return new OpeningHours(hours, null, 0).getState(at);
  } catch {
    return null;
  }
}

export type AvailabilityState = 'LIVE' | 'REPLAY' | 'STALE' | 'HISTORICAL_ONLY' | 'UNAVAILABLE';

/** States whose occupancy is current (at the replay clock, or live). */
export const isCurrent = (s: AvailabilityState) => s === 'LIVE' || s === 'REPLAY';

export interface AvailabilitySummary {
  state: AvailabilityState;
  message: string;
  occupied: number | null;
  available: number | null;
  capacity: number | null;
  occupancy: number | null;
  observedAt: string | null;
  ageMinutes: number | null;
  sourceType: SourceType | null;
}

interface LatestRow {
  facilityId: string;
  zoneId: string;
  observedAt: Date;
  occupied: number | null;
  available: number | null;
  capacity: number | null;
  occupancy: number;
  sourceType: SourceType;
}

export const UNAVAILABLE_SUMMARY: AvailabilitySummary = {
  state: 'UNAVAILABLE',
  message: 'No reading at this time.',
  occupied: null,
  available: null,
  capacity: null,
  occupancy: null,
  observedAt: null,
  ageMinutes: null,
  sourceType: null,
};

/** Latest snapshot at or before `now` (the replay clock) per zone, aggregated per facility. */
export async function availabilityFor(
  facilities: { id: string; availabilityMode: AvailabilityMode }[],
  staleAfterMinutes: number,
  now: Date,
): Promise<Map<string, AvailabilitySummary>> {
  const out = new Map<string, AvailabilitySummary>();
  if (!facilities.length) return out;
  const ids = facilities.map((f) => f.id);
  // One index lookup per zone (unique (zoneId, observedAt)) — the history table holds millions of rows.
  const rows = await prisma.$queryRaw<LatestRow[]>`
    SELECT z."facilityId", z.id AS "zoneId", s."observedAt", s.occupied, s.available, s.capacity, s.occupancy, s."sourceType"
      FROM "ParkingZone" z
      CROSS JOIN LATERAL (
        SELECT sn."observedAt", sn.occupied, sn.available, sn.capacity, sn.occupancy, sn."sourceType"
          FROM "OccupancySnapshot" sn
         WHERE sn."zoneId" = z.id AND sn."observedAt" <= ${now} AND sn."observedAt" > ${new Date(now.getTime() - 7 * 24 * 3_600_000)}
         ORDER BY sn."observedAt" DESC
         LIMIT 1) s
     WHERE z."facilityId" = ANY(${ids})`;

  const byFacility = new Map<string, LatestRow[]>();
  for (const r of rows) byFacility.set(r.facilityId, [...(byFacility.get(r.facilityId) ?? []), r]);

  for (const f of facilities) {
    const zones = byFacility.get(f.id);
    if (!zones?.length) {
      out.set(f.id, UNAVAILABLE_SUMMARY);
      continue;
    }
    const oldest = zones.reduce((a, b) => (a.observedAt < b.observedAt ? a : b));
    const ageMinutes = Math.max(0, Math.round((now.getTime() - oldest.observedAt.getTime()) / 60_000));
    const known = zones.every((z) => z.capacity != null && z.occupied != null);
    const capacity = known ? zones.reduce((s, z) => s + z.capacity!, 0) : null;
    const occupied = known ? zones.reduce((s, z) => s + z.occupied!, 0) : null;
    const occupancy = capacity ? occupied! / capacity : zones.length === 1 ? zones[0].occupancy : null;
    const base = {
      occupied,
      capacity,
      available: capacity != null ? Math.max(0, capacity - occupied!) : null,
      occupancy,
      observedAt: oldest.observedAt.toISOString(),
      ageMinutes,
      sourceType: oldest.sourceType,
    };

    if (f.availabilityMode === 'NONE') {
      out.set(f.id, { ...base, state: 'HISTORICAL_ONLY', message: 'Historical data available — live availability unavailable.' });
    } else if (ageMinutes > staleAfterMinutes) {
      out.set(f.id, { ...base, state: 'STALE', message: `No sensor reading for ${ageMinutes} min before this time.` });
    } else if (f.availabilityMode === 'REPLAY') {
      out.set(f.id, { ...base, state: 'REPLAY', message: 'Historical replay — recorded sensor data.' });
    } else {
      out.set(f.id, { ...base, state: 'LIVE', message: `Updated ${ageMinutes} min ago.` });
    }
  }
  return out;
}

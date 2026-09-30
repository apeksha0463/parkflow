import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { notFound } from '../lib/errors.js';
import { Prisma, type ParkingType } from '../generated/prisma/client.js';
import { ParkingType as ParkingTypeEnum, VehicleType as VehicleTypeEnum } from '../generated/prisma/enums.js';
import { getSettings } from '../services/settings.js';
import { facilityPredictions, pressureLevel } from '../services/predictions.js';
import { replayNow } from '../services/replay.js';
import { availabilityFor, displayName, isCurrent, isOpenNow, TYPE_LABEL, UNAVAILABLE_SUMMARY, type AvailabilitySummary } from '../services/facilities.js';

const MAX_CANDIDATES = 5000;

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const csvEnum = <T extends Record<string, string>>(e: T) =>
  z
    .string()
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.enum(e)).min(1));

const bboxSchema = z
  .string()
  .transform((s) => s.split(',').map(Number))
  .pipe(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90), z.number().min(-180).max(180), z.number().min(-90).max(90)]))
  .refine(([w, s, e, n]) => w < e && s < n, 'bbox must be west,south,east,north');

export const ListQuery = z
  .object({
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radius: z.coerce.number().int().min(100).max(10_000).default(2000),
    bbox: bboxSchema.optional(),
    q: z.string().trim().min(1).max(100).optional(),
    types: csvEnum(ParkingTypeEnum).optional(),
    vehicleType: z.enum(VehicleTypeEnum).optional(),
    ev: bool.optional(),
    free: bool.optional(),
    openNow: bool.optional(),
    hasAvailability: bool.optional(),
    sort: z.enum(['distance', 'name', 'capacity', 'availability']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((q) => (q.lat == null) === (q.lng == null), { message: 'lat and lng must be provided together', path: ['lat'] });

type ListQuery = z.infer<typeof ListQuery>;

interface CandidateRow {
  id: string;
  name: string | null;
  capacity: number | null;
  operatingHours: string | null;
  availabilityMode: 'NONE' | 'LIVE' | 'REPLAY';
  distance: number | null;
}

function whereClauses(q: ListQuery, origin: { lat: number; lng: number } | null): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (origin) {
    parts.push(Prisma.sql`ST_DWithin(f.location, ST_SetSRID(ST_MakePoint(${origin.lng}, ${origin.lat}), 4326)::geography, ${q.radius})`);
  }
  if (q.bbox) {
    const [w, s, e, n] = q.bbox;
    parts.push(Prisma.sql`f.location && ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326)::geography`);
  }
  if (q.q) parts.push(Prisma.sql`(lower(f.name) LIKE ${'%' + q.q.toLowerCase() + '%'} OR lower(f.area) LIKE ${'%' + q.q.toLowerCase() + '%'} OR lower(f.address) LIKE ${'%' + q.q.toLowerCase() + '%'})`);
  if (q.types) parts.push(Prisma.sql`f.type::text = ANY(${q.types})`);
  if (q.vehicleType) parts.push(Prisma.sql`${q.vehicleType}::"VehicleType" = ANY(f."vehicleTypes")`);
  if (q.ev) parts.push(Prisma.sql`f."evCharging" = TRUE`);
  if (q.free) parts.push(Prisma.sql`f."isFree" = TRUE`);
  if (q.hasAvailability) parts.push(Prisma.sql`f."availabilityMode" <> 'NONE'`);
  return Prisma.join(parts, ' AND ');
}

function resolveOrigin(q: ListQuery): { lat: number; lng: number } | null {
  return q.lat != null && q.lng != null ? { lat: q.lat, lng: q.lng } : null;
}

const facilityInclude = {
  dataSource: { select: { name: true, sourceType: true, url: true, license: true } },
} satisfies Prisma.ParkingFacilityInclude;

type FacilityWithSource = Prisma.ParkingFacilityGetPayload<{ include: typeof facilityInclude }>;

export function toFacilityDto(
  f: FacilityWithSource,
  extra: { distanceMeters?: number | null; availability: AvailabilitySummary; thresholds: { saturationThreshold: number; approachingThreshold: number } },
) {
  const a = extra.availability;
  return {
    id: f.id,
    name: f.name,
    externalId: f.externalId,
    ...displayName(f.name, f.type, f.area),
    type: f.type,
    typeLabel: TYPE_LABEL[f.type],
    address: f.address,
    area: f.area,
    latitude: f.latitude,
    longitude: f.longitude,
    distanceMeters: extra.distanceMeters != null ? Math.round(extra.distanceMeters) : null,
    capacity: f.capacity,
    vehicleTypes: f.vehicleTypes,
    evCharging: f.evCharging,
    pricingText: f.pricingText,
    isFree: f.isFree,
    operatingHours: f.operatingHours,
    openNow: isOpenNow(f.operatingHours),
    pressureLevel: isCurrent(a.state) ? pressureLevel(a.occupancy, extra.thresholds) : null,
    availabilityMode: f.availabilityMode,
    isDemo: f.isDemo,
    bookingEnabled: f.bookingEnabled,
    availability: extra.availability,
    source: { ...f.dataSource, recordUrl: f.sourceUrl, lastVerifiedAt: f.lastVerifiedAt },
  };
}

export async function listFacilities(q: ListQuery) {
  const origin = resolveOrigin(q);
  const [settings, now] = await Promise.all([getSettings(), replayNow()]);
  const distanceSql = origin
    ? Prisma.sql`ST_Distance(f.location, ST_SetSRID(ST_MakePoint(${origin.lng}, ${origin.lat}), 4326)::geography)`
    : Prisma.sql`NULL::float8`;

  let candidates = await prisma.$queryRaw<CandidateRow[]>`
    SELECT f.id, f.name, f.capacity, f."operatingHours", f."availabilityMode", ${distanceSql} AS distance
      FROM "ParkingFacility" f
     WHERE ${whereClauses(q, origin)}
     LIMIT ${MAX_CANDIDATES}`;

  if (q.openNow) candidates = candidates.filter((c) => isOpenNow(c.operatingHours) === true);

  // Availability is only computed for facilities that can have it, keeping the query small.
  const withSource = candidates.filter((c) => c.availabilityMode !== 'NONE');
  const availability = await availabilityFor(withSource, settings.staleAfterMinutes, now);
  const avail = (id: string) => availability.get(id);

  const sort = q.sort ?? (origin ? 'distance' : 'name');
  const byName = (a: CandidateRow, b: CandidateRow) => (a.name ?? '￿').localeCompare(b.name ?? '￿');
  const comparators: Record<string, (a: CandidateRow, b: CandidateRow) => number> = {
    distance: (a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity),
    name: byName,
    capacity: (a, b) => (b.capacity ?? -1) - (a.capacity ?? -1),
    // Facilities with current (non-stale) availability first, most free spaces first.
    availability: (a, b) => {
      const score = (id: string) => {
        const s = avail(id);
        return s && isCurrent(s.state) ? (s.available ?? 0) : -1;
      };
      return score(b.id) - score(a.id) || (a.distance ?? Infinity) - (b.distance ?? Infinity);
    },
  };
  candidates.sort(comparators[sort]);

  const total = candidates.length;
  const page = candidates.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
  const rows = await prisma.parkingFacility.findMany({ where: { id: { in: page.map((c) => c.id) } }, include: facilityInclude });
  const byId = new Map(rows.map((r) => [r.id, r]));

  return {
    items: page.map((c) =>
      toFacilityDto(byId.get(c.id)!, {
        distanceMeters: c.distance,
        availability: avail(c.id) ?? UNAVAILABLE_SUMMARY,
        thresholds: settings,
      }),
    ),
    page: q.page,
    pageSize: q.pageSize,
    total,
    origin,
    radiusMeters: origin ? q.radius : null,
    sort,
    at: now.toISOString(),
  };
}

export const parkingRouter = Router();

parkingRouter.get('/', async (req, res) => {
  res.json(await listFacilities(ListQuery.parse(req.query)));
});

/** Map markers accept the same filters as the list (minus location/sort/paging), so both views agree. */
const MapQuery = z.object({
  bbox: bboxSchema,
  types: csvEnum(ParkingTypeEnum).optional(),
  vehicleType: z.enum(VehicleTypeEnum).optional(),
  ev: bool.optional(),
  free: bool.optional(),
  openNow: bool.optional(),
  hasAvailability: bool.optional(),
});

/** Compact markers for the map viewport (clustered client-side). */
parkingRouter.get('/map', async (req, res) => {
  const mq = MapQuery.parse(req.query);
  const q: ListQuery = { ...ListQuery.parse({}), ...mq };
  let rows = await prisma.$queryRaw<
    { id: string; name: string | null; area: string | null; latitude: number; longitude: number; type: ParkingType; availabilityMode: 'NONE' | 'LIVE' | 'REPLAY'; isDemo: boolean; operatingHours: string | null }[]
  >`
    SELECT f.id, f.name, f.area, f.latitude, f.longitude, f.type, f."availabilityMode", f."isDemo", f."operatingHours"
      FROM "ParkingFacility" f
     WHERE ${whereClauses(q, null)}
     LIMIT ${MAX_CANDIDATES}`;
  if (q.openNow) rows = rows.filter((r) => isOpenNow(r.operatingHours) === true);
  const [settings, now] = await Promise.all([getSettings(), replayNow()]);
  const availability = await availabilityFor(rows.filter((r) => r.availabilityMode !== 'NONE'), settings.staleAfterMinutes, now);
  res.json({
    at: now.toISOString(),
    items: rows.map((r) => {
      const a = availability.get(r.id);
      const current = a != null && isCurrent(a.state);
      return {
        id: r.id,
        displayName: displayName(r.name, r.type, r.area).displayName,
        latitude: r.latitude,
        longitude: r.longitude,
        type: r.type,
        isDemo: r.isDemo,
        availabilityState: a?.state ?? 'UNAVAILABLE',
        occupancy: current ? a.occupancy : null,
        available: current ? a.available : null,
        capacity: current ? a.capacity : null,
        pressureLevel: current ? pressureLevel(a.occupancy, settings) : null,
      };
    }),
    truncated: rows.length >= MAX_CANDIDATES,
  });
});

parkingRouter.get('/:id', async (req, res) => {
  const f = await prisma.parkingFacility.findUnique({
    where: { id: req.params.id },
    include: { ...facilityInclude, zones: { orderBy: [{ levelNumber: 'asc' }, { name: 'asc' }] } },
  });
  if (!f) throw notFound('Parking facility');
  const [settings, now] = await Promise.all([getSettings(), replayNow()]);
  const availability = (await availabilityFor([f], settings.staleAfterMinutes, now)).get(f.id)!;
  res.json({
    at: now.toISOString(),
    facility: {
      ...toFacilityDto(f, { availability, thresholds: settings }),
      zones: f.zones.map((z) => ({ id: z.id, name: z.name, kind: z.kind, levelNumber: z.levelNumber, capacity: z.capacity, blockKey: z.replaySourceZone })),
    },
  });
});

const NeighbourQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

/** Research neighbours: zones within the model's neighbour radius, from the research pipeline's neighbour pairs. */
parkingRouter.get('/:id/neighbours', async (req, res) => {
  const q = NeighbourQuery.parse(req.query);
  const f = await prisma.parkingFacility.findUnique({ where: { id: req.params.id }, select: { id: true, zones: { select: { id: true } } } });
  if (!f) throw notFound('Parking facility');
  const [settings, now] = await Promise.all([getSettings(), replayNow()]);
  const pairs = await prisma.zoneNeighbour.findMany({
    where: { zoneId: { in: f.zones.map((z) => z.id) } },
    orderBy: { distanceM: 'asc' },
    select: { distanceM: true, neighbour: { select: { facilityId: true } } },
  });
  const distance = new Map<string, number>();
  for (const p of pairs) if (!distance.has(p.neighbour.facilityId) && p.neighbour.facilityId !== f.id) distance.set(p.neighbour.facilityId, p.distanceM);
  const ids = [...distance.keys()].slice(0, q.limit);
  const facilities = await prisma.parkingFacility.findMany({ where: { id: { in: ids } }, include: facilityInclude });
  const byId = new Map(facilities.map((x) => [x.id, x]));
  const availability = await availabilityFor(facilities, settings.staleAfterMinutes, now);
  res.json({
    at: now.toISOString(),
    method: 'Research neighbour pairs: block centroids within the neighbour radius used to train the spatial-temporal model',
    items: ids.map((id) => toFacilityDto(byId.get(id)!, { distanceMeters: distance.get(id), availability: availability.get(id)!, thresholds: settings })),
  });
});

/** Short-term occupancy predictions. Always returns a status; predictions only when real inputs exist. */
parkingRouter.get('/:id/predictions', async (req, res) => {
  const result = await facilityPredictions(req.params.id, await replayNow());
  if (!result) throw notFound('Parking facility');
  res.json(result);
});

const OccupancyQuery = z.object({ hours: z.coerce.number().int().min(1).max(24 * 7).default(24) });

/** Observed occupancy history (snapshots) with provenance. Empty when the facility has no availability source. */
parkingRouter.get('/:id/occupancy', async (req, res) => {
  const { hours } = OccupancyQuery.parse(req.query);
  const f = await prisma.parkingFacility.findUnique({ where: { id: req.params.id }, select: { id: true, availabilityMode: true, zones: { select: { id: true, name: true } } } });
  if (!f) throw notFound('Parking facility');
  const now = await replayNow();
  const since = new Date(now.getTime() - hours * 3_600_000);
  const snaps = await prisma.occupancySnapshot.findMany({
    where: { zoneId: { in: f.zones.map((z) => z.id) }, observedAt: { gte: since, lte: now } },
    select: { zoneId: true, observedAt: true, occupied: true, available: true, capacity: true, occupancy: true, sourceType: true },
    orderBy: { observedAt: 'asc' },
    take: 5000,
  });
  res.json({
    availabilityMode: f.availabilityMode,
    at: now.toISOString(),
    hours,
    zones: f.zones.map((z) => ({ ...z, points: snaps.filter((s) => s.zoneId === z.id).map(({ zoneId: _z, ...p }) => p) })),
  });
});

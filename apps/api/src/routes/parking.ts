import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { HttpError, notFound } from '../lib/errors.js';
import { Prisma, type ParkingType } from '../generated/prisma/client.js';
import { ParkingType as ParkingTypeEnum, VehicleType as VehicleTypeEnum } from '../generated/prisma/enums.js';
import { getSettings } from '../services/settings.js';
import { availabilityFor, displayName, isOpenNow, TYPE_LABEL, UNAVAILABLE_SUMMARY, type AvailabilitySummary } from '../services/facilities.js';

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
    areaId: z.string().max(40).optional(),
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
  availabilityMode: 'NONE' | 'LIVE' | 'SIMULATION';
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
  if (q.q) parts.push(Prisma.sql`(lower(f.name) LIKE ${'%' + q.q.toLowerCase() + '%'} OR lower(f.area) LIKE ${'%' + q.q.toLowerCase() + '%'})`);
  if (q.types) parts.push(Prisma.sql`f.type::text = ANY(${q.types})`);
  if (q.vehicleType) parts.push(Prisma.sql`${q.vehicleType}::"VehicleType" = ANY(f."vehicleTypes")`);
  if (q.ev) parts.push(Prisma.sql`f."evCharging" = TRUE`);
  if (q.free) parts.push(Prisma.sql`f."isFree" = TRUE`);
  if (q.hasAvailability) parts.push(Prisma.sql`f."availabilityMode" <> 'NONE'`);
  return Prisma.join(parts, ' AND ');
}

async function resolveOrigin(q: ListQuery): Promise<{ lat: number; lng: number } | null> {
  if (q.lat != null && q.lng != null) return { lat: q.lat, lng: q.lng };
  if (q.areaId) {
    const loc = await prisma.locality.findUnique({ where: { id: q.areaId }, select: { latitude: true, longitude: true } });
    if (!loc) throw notFound('Area');
    return { lat: loc.latitude, lng: loc.longitude };
  }
  return null;
}

const facilityInclude = {
  dataSource: { select: { name: true, sourceType: true, url: true, license: true } },
  locality: { select: { id: true, name: true } },
} satisfies Prisma.ParkingFacilityInclude;

type FacilityWithSource = Prisma.ParkingFacilityGetPayload<{ include: typeof facilityInclude }>;

export function toFacilityDto(f: FacilityWithSource, extra: { distanceMeters?: number | null; availability: AvailabilitySummary }) {
  return {
    id: f.id,
    name: f.name,
    ...displayName(f.name, f.type, f.area),
    type: f.type,
    typeLabel: TYPE_LABEL[f.type],
    address: f.address,
    area: f.area,
    locality: f.locality,
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
    availabilityMode: f.availabilityMode,
    isDemo: f.isDemo,
    bookingEnabled: f.bookingEnabled,
    availability: extra.availability,
    source: { ...f.dataSource, recordUrl: f.sourceUrl, lastVerifiedAt: f.lastVerifiedAt },
  };
}

export async function listFacilities(q: ListQuery) {
  const origin = await resolveOrigin(q);
  const settings = await getSettings();
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
  const availability = await availabilityFor(withSource, settings.staleAfterMinutes);
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
        return s && (s.state === 'LIVE' || s.state === 'SIMULATED') ? (s.available ?? 0) : -1;
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
      }),
    ),
    page: q.page,
    pageSize: q.pageSize,
    total,
    origin,
    radiusMeters: origin ? q.radius : null,
    sort,
  };
}

export const parkingRouter = Router();

parkingRouter.get('/', async (req, res) => {
  res.json(await listFacilities(ListQuery.parse(req.query)));
});

const MapQuery = z.object({ bbox: bboxSchema, types: csvEnum(ParkingTypeEnum).optional() });

/** Compact markers for the map viewport (clustered client-side). */
parkingRouter.get('/map', async (req, res) => {
  const q = MapQuery.parse(req.query);
  const [w, s, e, n] = q.bbox;
  const typeFilter = q.types ? Prisma.sql`AND f.type::text = ANY(${q.types})` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ id: string; latitude: number; longitude: number; type: ParkingType; availabilityMode: 'NONE' | 'LIVE' | 'SIMULATION'; isDemo: boolean }[]>`
    SELECT f.id, f.latitude, f.longitude, f.type, f."availabilityMode", f."isDemo"
      FROM "ParkingFacility" f
     WHERE f.location && ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326)::geography ${typeFilter}
     LIMIT ${MAX_CANDIDATES}`;
  const settings = await getSettings();
  const availability = await availabilityFor(rows.filter((r) => r.availabilityMode !== 'NONE'), settings.staleAfterMinutes);
  res.json({
    items: rows.map((r) => {
      const a = availability.get(r.id);
      return {
        id: r.id,
        latitude: r.latitude,
        longitude: r.longitude,
        type: r.type,
        isDemo: r.isDemo,
        availabilityState: a?.state ?? 'UNAVAILABLE',
        occupancy: a && (a.state === 'LIVE' || a.state === 'SIMULATED') ? a.occupancy : null,
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
  const settings = await getSettings();
  const availability = (await availabilityFor([f], settings.staleAfterMinutes)).get(f.id)!;
  res.json({
    facility: {
      ...toFacilityDto(f, { availability }),
      zones: f.zones.map((z) => ({ id: z.id, name: z.name, kind: z.kind, levelNumber: z.levelNumber, capacity: z.capacity, saturationState: z.saturationState })),
    },
  });
});

const NeighbourQuery = z.object({
  radius: z.coerce.number().int().min(100).max(5000).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/** Neighbours are determined by straight-line geographic distance (PostGIS), within a configurable radius. */
parkingRouter.get('/:id/neighbours', async (req, res) => {
  const q = NeighbourQuery.parse(req.query);
  const settings = await getSettings();
  const radius = q.radius ?? settings.neighbourRadiusMeters;
  const exists = await prisma.parkingFacility.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!exists) throw notFound('Parking facility');

  const rows = await prisma.$queryRaw<{ id: string; distance: number }[]>`
    SELECT n.id, ST_Distance(n.location, f.location) AS distance
      FROM "ParkingFacility" f
      JOIN "ParkingFacility" n ON n.id <> f.id AND ST_DWithin(n.location, f.location, ${radius})
     WHERE f.id = ${req.params.id}
     ORDER BY distance
     LIMIT ${q.limit}`;
  const facilities = await prisma.parkingFacility.findMany({ where: { id: { in: rows.map((r) => r.id) } }, include: facilityInclude });
  const byId = new Map(facilities.map((f) => [f.id, f]));
  const availability = await availabilityFor(facilities, settings.staleAfterMinutes);
  res.json({
    radiusMeters: radius,
    method: 'Straight-line geographic distance (PostGIS ST_DWithin on WGS84 geography)',
    items: rows.map((r) => toFacilityDto(byId.get(r.id)!, { distanceMeters: r.distance, availability: availability.get(r.id)! })),
  });
});

export const areasRouter = Router();

areasRouter.get('/:id', async (req, res) => {
  const area = await prisma.locality.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true, placeType: true, latitude: true, longitude: true },
  });
  if (!area) throw notFound('Area');
  res.json({ area });
});

areasRouter.get('/:id/parking', async (req, res) => {
  const q = ListQuery.parse({ radius: '1500', ...req.query, areaId: req.params.id });
  if (q.lat != null || q.bbox) throw new HttpError(400, 'VALIDATION_ERROR', 'Use either an area or coordinates, not both');
  res.json(await listFacilities(q));
});

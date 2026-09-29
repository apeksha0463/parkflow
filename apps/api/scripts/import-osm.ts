/**
 * Imports the Bengaluru parking directory and locality names from OpenStreetMap.
 *
 *   npm run import:osm -w apps/api            # uses cached data/raw/osm/bengaluru.json
 *   npm run import:osm -w apps/api -- --fetch # refreshes the cache from Overpass first
 *
 * Idempotent (upsert on externalId). Imports locations and tags only — never availability.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/lib/db.js';
import { mapFacility, mapLocality, type OsmElement } from '../src/services/osm.js';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const CACHE = path.join(ROOT, 'data/raw/osm/bengaluru.json');
const BBOX = '12.83,77.43,13.15,77.80'; // Bengaluru urban area (south,west,north,east)
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const LOCALITY_MAX_DISTANCE_M = 3000;

const QUERY = `[out:json][timeout:180];
(
  nwr["amenity"="parking"](${BBOX});
  nwr["amenity"="motorcycle_parking"](${BBOX});
  nwr["amenity"="charging_station"](${BBOX});
  node["place"~"^(suburb|neighbourhood|quarter)$"](${BBOX});
);
out center tags;`;

interface OverpassResponse {
  osm3s: { timestamp_osm_base: string };
  elements: OsmElement[];
}

async function fetchOverpass(): Promise<OverpassResponse> {
  for (const url of ENDPOINTS) {
    try {
      console.log(`Fetching from ${url} ...`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': process.env.GEOCODER_USER_AGENT ?? 'ParkFlow/0.1' },
        body: new URLSearchParams({ data: QUERY }),
        signal: AbortSignal.timeout(240_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as OverpassResponse;
      await fs.mkdir(path.dirname(CACHE), { recursive: true });
      await fs.writeFile(CACHE, JSON.stringify(data));
      return data;
    } catch (err) {
      console.warn(`  failed: ${(err as Error).message}`);
    }
  }
  throw new Error('All Overpass endpoints failed');
}

async function main() {
  const data: OverpassResponse = process.argv.includes('--fetch')
    ? await fetchOverpass()
    : JSON.parse(await fs.readFile(CACHE, 'utf8'));
  const snapshotAt = new Date(data.osm3s.timestamp_osm_base);
  console.log(`OSM snapshot: ${snapshotAt.toISOString()} — ${data.elements.length} elements`);

  const source = await prisma.dataSource.findUniqueOrThrow({ where: { name: 'OpenStreetMap' } });
  await prisma.dataSource.update({ where: { id: source.id }, data: { lastVerifiedAt: snapshotAt } });

  const localities = data.elements.map(mapLocality).filter((l) => l !== null);
  const facilities = data.elements.map(mapFacility).filter((f) => f !== null);
  const skipped = data.elements.filter((e) => e.tags?.amenity).length - facilities.length;

  for (let i = 0; i < localities.length; i += 200) {
    await prisma.$transaction(
      localities.slice(i, i + 200).map((l) => prisma.locality.upsert({ where: { externalId: l.externalId }, create: l, update: l })),
    );
  }
  console.log(`Localities upserted: ${localities.length}`);

  for (let i = 0; i < facilities.length; i += 200) {
    await prisma.$transaction(
      facilities.slice(i, i + 200).map((f) => {
        const data = { ...f, dataSourceId: source.id, lastVerifiedAt: snapshotAt, availabilityMode: 'NONE' as const };
        return prisma.parkingFacility.upsert({ where: { externalId: f.externalId }, create: data, update: data });
      }),
    );
  }
  console.log(`Facilities upserted: ${facilities.length} (skipped ${skipped} private/invalid)`);

  // Label each OSM facility with its nearest named locality (KNN on the GiST index).
  const labelled = await prisma.$executeRaw`
    WITH nearest AS (
      SELECT f.id AS fid, l.id AS lid, l.name
        FROM "ParkingFacility" f
        CROSS JOIN LATERAL (
          SELECT id, name, location FROM "Locality"
           ORDER BY location <-> f.location
           LIMIT 1
        ) l
       WHERE f."dataSourceId" = ${source.id}
         AND ST_DWithin(f.location, l.location, ${LOCALITY_MAX_DISTANCE_M})
    )
    UPDATE "ParkingFacility" p
       SET "localityId" = n.lid, "area" = n.name
      FROM nearest n
     WHERE p.id = n.fid`;
  console.log(`Facilities labelled with nearest locality: ${labelled}`);

  // Every facility needs a zone to hold occupancy; directory facilities get one WHOLE_FACILITY zone.
  const zones = await prisma.$executeRaw`
    INSERT INTO "ParkingZone" (id, "facilityId", name, kind, capacity, latitude, longitude, "updatedAt")
    SELECT 'z_' || f.id, f.id, 'Main', 'WHOLE_FACILITY', f.capacity, f.latitude, f.longitude, now()
      FROM "ParkingFacility" f
     WHERE f."dataSourceId" = ${source.id}
       AND NOT EXISTS (SELECT 1 FROM "ParkingZone" z WHERE z."facilityId" = f.id)`;
  console.log(`Zones created: ${zones}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

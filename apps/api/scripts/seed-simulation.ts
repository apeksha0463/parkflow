/**
 * Seeds the SIMULATION demo: a small cluster of clearly-labelled demo parking zones that replay the
 * research dataset (see services/replay.ts). Demo facilities are placed around a real Bengaluru locality
 * from the directory, keeping the research cluster's real relative spacing (so neighbour distances match
 * what the model was trained on). They are never real parking facilities and are flagged isDemo.
 *
 * Usage: npm run db:seed:simulation -w apps/api [-- --anchor "Koramangala"]
 */
import { prisma } from '../src/lib/db.js';
import { loadReplay } from '../src/services/replay.js';

const M_PER_DEG_LAT = 111_195;

async function main() {
  const anchorName = process.argv.includes('--anchor') ? process.argv[process.argv.indexOf('--anchor') + 1] : 'Koramangala';
  const payload = loadReplay();
  if (!payload) throw new Error('Replay data not found. Run `python -m parkflow_ml.replay` in ml/ or set REPLAY_DATA_PATH.');
  const anchor = await prisma.locality.findFirst({ where: { name: anchorName }, orderBy: { placeType: 'desc' } });
  if (!anchor) throw new Error(`Locality "${anchorName}" not found. Import the directory first (npm run import:osm -w apps/api).`);
  const source = await prisma.dataSource.findUnique({ where: { name: 'ParkFlow Simulation' } });
  if (!source) throw new Error('Data source "ParkFlow Simulation" missing. Run npm run db:seed -w apps/api first.');

  const keep: string[] = [];
  for (const [i, z] of payload.zones.entries()) {
    const latitude = anchor.latitude + z.northM / M_PER_DEG_LAT;
    const longitude = anchor.longitude + z.eastM / (M_PER_DEG_LAT * Math.cos((anchor.latitude * Math.PI) / 180));
    const externalId = `sim:${z.sourceZone}`;
    keep.push(externalId);
    const data = {
      name: `Simulation demo ${i + 1}`,
      type: 'ON_STREET' as const,
      address: `Demo only — replays Melbourne sensor block "${z.label}" (${payload.dataset})`,
      area: anchor.name,
      localityId: anchor.id,
      latitude,
      longitude,
      capacity: z.sensorCount,
      vehicleTypes: ['CAR' as const],
      availabilityMode: 'SIMULATION' as const,
      isDemo: true,
      bookingEnabled: false,
      dataSourceId: source.id,
      sourceUrl: 'https://data.melbourne.vic.gov.au/explore/dataset/on-street-car-parking-sensor-data-2019/',
    };
    const f = await prisma.parkingFacility.upsert({ where: { externalId }, create: { externalId, ...data }, update: data });
    await prisma.parkingZone.deleteMany({ where: { facilityId: f.id, NOT: { replaySourceZone: z.sourceZone } } });
    const zone = await prisma.parkingZone.findFirst({ where: { facilityId: f.id } });
    const zoneData = { name: 'Street block (demo)', kind: 'SEGMENT' as const, capacity: z.sensorCount, latitude, longitude, replaySourceZone: z.sourceZone };
    if (zone) await prisma.parkingZone.update({ where: { id: zone.id }, data: zoneData });
    else await prisma.parkingZone.create({ data: { facilityId: f.id, ...zoneData } });
  }
  const removed = await prisma.parkingFacility.deleteMany({ where: { externalId: { startsWith: 'sim:', notIn: keep } } });
  console.log(`Simulation demo ready: ${keep.length} demo zones around ${anchor.name} (removed ${removed.count} outdated). Start the API to replay occupancy.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

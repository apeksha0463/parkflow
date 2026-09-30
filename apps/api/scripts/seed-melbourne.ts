/**
 * Seeds the Melbourne HISTORICAL REPLAY from the research export (ml: `python -m parkflow_ml.replay`):
 *  - one on-street facility + SEGMENT zone per research block, at the block's real coordinates,
 *  - the research neighbour pairs (200 m) the spatial-temporal model was trained with,
 *  - every recorded 5-minute occupancy value of the test split (+7 days of model-input history), with its
 *    real 2019 timestamp and sourceType HISTORICAL_DATA,
 *  - the research-defined saturation events of the test split.
 * Everything else (the former Bengaluru directory and simulation demo) is removed. Idempotent.
 *
 * Usage: npm run db:seed:melbourne -w apps/api
 */
import { prisma } from '../src/lib/db.js';
import { loadReplay, setReplayRange, SOURCE_NAME } from '../src/services/replay.js';

const CHUNK = 20_000;

async function main() {
  const payload = loadReplay();
  if (!payload) throw new Error('Replay data not found. Run `python -m parkflow_ml.replay` in ml/ or set REPLAY_DATA_PATH.');
  const stepMs = payload.stepMinutes * 60_000;
  const t0 = new Date(payload.seriesStart).getTime();

  const source = await prisma.dataSource.upsert({
    where: { name: SOURCE_NAME },
    create: { name: SOURCE_NAME, sourceType: 'HISTORICAL_DATA', url: payload.sourceUrl, license: payload.licence, description: payload.note },
    update: { sourceType: 'HISTORICAL_DATA', url: payload.sourceUrl, license: payload.licence, description: payload.note },
  });

  const keep = payload.zones.map((z) => `melbourne:${z.key}`);
  const removed = await prisma.parkingFacility.deleteMany({ where: { externalId: { notIn: keep } } });
  await prisma.parkingFacility.deleteMany({ where: { externalId: null } });
  await prisma.dataSource.deleteMany({ where: { name: { not: SOURCE_NAME } } });

  const zoneIdByKey = new Map<string, string>();
  for (const z of payload.zones) {
    const externalId = `melbourne:${z.key}`;
    const data = {
      name: z.label,
      type: 'ON_STREET' as const,
      address: z.label,
      area: z.area,
      latitude: z.latitude,
      longitude: z.longitude,
      capacity: z.sensorCount,
      vehicleTypes: ['CAR' as const],
      availabilityMode: 'REPLAY' as const,
      isDemo: false,
      bookingEnabled: false,
      dataSourceId: source.id,
      sourceUrl: payload.sourceUrl,
    };
    const f = await prisma.parkingFacility.upsert({ where: { externalId }, create: { externalId, ...data }, update: data });
    const zoneData = { name: z.label, kind: 'SEGMENT' as const, capacity: z.sensorCount, latitude: z.latitude, longitude: z.longitude, replaySourceZone: z.key };
    await prisma.parkingZone.deleteMany({ where: { facilityId: f.id, NOT: { replaySourceZone: z.key } } });
    const zone = await prisma.parkingZone.findFirst({ where: { facilityId: f.id } });
    const saved = zone
      ? await prisma.parkingZone.update({ where: { id: zone.id }, data: zoneData })
      : await prisma.parkingZone.create({ data: { facilityId: f.id, ...zoneData } });
    zoneIdByKey.set(z.key, saved.id);
  }

  await prisma.zoneNeighbour.deleteMany({});
  await prisma.zoneNeighbour.createMany({
    data: payload.zones.flatMap((z) =>
      z.neighbours.map((n) => ({ zoneId: zoneIdByKey.get(z.key)!, neighbourId: zoneIdByKey.get(n.key)!, distanceM: n.distanceM })),
    ),
  });

  // Replay data is immutable history: replace it wholesale. Predictions depend on it, so they go too.
  await prisma.prediction.deleteMany({});
  await prisma.saturationEvent.deleteMany({});
  await prisma.$executeRaw`TRUNCATE "OccupancySnapshot" RESTART IDENTITY`;

  let snapshots = 0;
  for (const z of payload.zones) {
    const zoneId = zoneIdByKey.get(z.key)!;
    const at: Date[] = [];
    const occ: number[] = [];
    const occupied: number[] = [];
    const bays: number[] = [];
    z.occupancy.forEach((o, k) => {
      if (o == null || !z.bays[k]) return; // unknown in the source stays unknown
      at.push(new Date(t0 + k * stepMs));
      occ.push(o);
      occupied.push(Math.round(o * z.bays[k]));
      bays.push(z.bays[k]);
    });
    for (let i = 0; i < at.length; i += CHUNK) {
      const s = i;
      const e = i + CHUNK;
      snapshots += await prisma.$executeRaw`
        INSERT INTO "OccupancySnapshot" ("zoneId", "observedAt", occupied, available, capacity, occupancy, "sourceType")
        SELECT ${zoneId}, t, o, b - o, b, x, 'HISTORICAL_DATA'::"SourceType"
          FROM unnest(${at.slice(s, e)}::timestamptz[], ${occupied.slice(s, e)}::int[], ${bays.slice(s, e)}::int[], ${occ.slice(s, e)}::float8[]) AS u(t, o, b, x)`;
    }
  }

  const events = payload.zones.flatMap((z) =>
    z.events.map((e) => ({
      zoneId: zoneIdByKey.get(z.key)!,
      startedAt: new Date(t0 + e.onset * stepMs),
      endedAt: e.end == null ? null : new Date(t0 + e.end * stepMs),
      peakOccupancy: e.peak,
      threshold: payload.saturationThreshold,
      isSimulated: false,
    })),
  );
  for (let i = 0; i < events.length; i += 5000) await prisma.saturationEvent.createMany({ data: events.slice(i, i + 5000) });

  await setReplayRange({ start: payload.replayStart, end: payload.replayEnd, timezone: payload.timezone, dataset: payload.dataset });

  console.log(
    `Melbourne replay ready: ${payload.zones.length} zones, ${snapshots} snapshots, ${events.length} saturation events ` +
      `(${payload.replayStart} .. ${payload.replayEnd}); removed ${removed.count} non-Melbourne facilities.`,
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

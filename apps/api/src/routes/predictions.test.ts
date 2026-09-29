import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { config } from '../config.js';
import { prisma } from '../lib/db.js';
import { clearRegistryCache } from '../services/ml.js';
import { evaluateDuePredictions, floorToStep, gridHistories, HISTORY_STEPS } from '../services/predictions.js';
import { rankAlternatives } from '../services/spillover.js';
import { DEFAULT_SETTINGS } from '../services/settings.js';
import { createUser, loginAs, resetDb } from '../test/helpers.js';

const app = createApp();
const ORIGIN = { lat: 12.9716, lng: 77.5946 };

/**
 * Stand-in for the Python ML service. It checks request plumbing only: the "prediction" is a fixed rule
 * of the request (last value + 0.01 per 5 min) so tests can assert the numbers flow through unchanged.
 */
let stub: http.Server;
let stubUrl = '';
let requests: { path: string; body: any }[] = [];
const REGISTRY = {
  active: 'spatial_temporal-hgb-v1',
  generated_at: '2026-01-01T00:00:00Z',
  models: [
    {
      id: 'spatial_temporal-hgb-v1', feature_set: 'spatial_temporal', algorithm: 'HGB', training_dataset: 'test', trained_at: '2026-01-01T00:00:00Z',
      feature_version: 'v1', features: [], horizons_minutes: [5, 15], test_metrics: [], config: { neighbour_radius_m: 400, bucket_minutes: 5, saturation_threshold: 0.9 },
    },
  ],
};

beforeAll(async () => {
  stub = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      requests.push({ path: req.url!, body });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/models') return res.end(JSON.stringify(REGISTRY));
      if (req.url === '/evaluation') return res.end(JSON.stringify({ metrics: [] }));
      if (req.url === '/predict') {
        const last = body.history[body.history.length - 1];
        return res.end(JSON.stringify({
          zoneId: body.zoneId, generatedAt: 'x', modelVersion: body.model, featureSet: 'spatial_temporal', basedOn: body.timestamp,
          currentOccupancy: last, currentState: null, neighboursUsed: body.neighbours.length,
          predictions: [5, 15].map((h) => ({ horizonMinutes: h, predictedOccupancy: Math.min(1, last + 0.01 * (h / 5)), pressureLevel: null })),
        }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => stub.close(() => r())));

beforeEach(async () => {
  await resetDb();
  requests = [];
  clearRegistryCache();
  config.ML_SERVICE_URL = stubUrl;
});

async function fixtures() {
  const osm = await prisma.dataSource.create({ data: { name: 'OpenStreetMap', sourceType: 'VERIFIED_DIRECTORY' } });
  const sim = await prisma.dataSource.create({ data: { name: 'ParkFlow Simulation', sourceType: 'SIMULATION' } });
  const mk = (id: string, dLat: number, simulated: boolean, extra: Record<string, unknown> = {}) =>
    prisma.parkingFacility.create({
      data: {
        id, externalId: `test:${id}`, name: id, latitude: ORIGIN.lat + dLat, longitude: ORIGIN.lng,
        dataSourceId: simulated ? sim.id : osm.id, availabilityMode: simulated ? 'SIMULATION' : 'NONE', isDemo: simulated,
        zones: { create: { id: `z_${id}`, name: 'Main', latitude: ORIGIN.lat + dLat, longitude: ORIGIN.lng } },
        ...extra,
      },
    });
  await mk('a', 0, true);
  await mk('b', 0.002, true); // ~220 m: within the model radius (400 m)
  await mk('c', 0.006, true); // ~670 m: outside the model radius, inside the app radius (800 m)
  await mk('osm', 0.001, false);
}

/** Snapshots every 5 minutes for the last `count` steps ending at the current grid instant. */
async function series(zoneId: string, values: number[], capacity = 20) {
  const end = floorToStep(new Date());
  await prisma.occupancySnapshot.createMany({
    data: values.map((v, i) => ({
      zoneId,
      observedAt: new Date(end.getTime() - (values.length - 1 - i) * 300_000),
      occupied: Math.round(v * capacity), capacity, available: capacity - Math.round(v * capacity), occupancy: v, sourceType: 'SIMULATION' as const,
    })),
  });
}

describe('GET /api/parking/:id/predictions', () => {
  it('says prediction is unavailable for a directory-only facility, without calling the ML service', async () => {
    await fixtures();
    const res = await request(app).get('/api/parking/osm/predictions');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'INSUFFICIENT_DATA', message: 'Prediction unavailable — insufficient historical data.', zones: [] });
    expect(requests).toHaveLength(0);
  });

  it('never applies the research (Melbourne) model to a real live facility, nor uses it as a neighbour', async () => {
    await fixtures();
    await prisma.parkingFacility.update({ where: { id: 'osm' }, data: { availabilityMode: 'LIVE' } });
    await series('z_osm', Array(24).fill(0.8));
    await series('z_a', Array(24).fill(0.5));

    const live = await request(app).get('/api/parking/osm/predictions');
    expect(live.body).toMatchObject({ status: 'NO_MODEL', message: 'Prediction unavailable — no model has been trained for this area yet.', model: null, zones: [] });
    expect(requests.filter((r) => r.path === '/predict')).toHaveLength(0);

    // The live zone (~110 m away) is inside the model radius but must not feed the simulation zone's model.
    await request(app).get('/api/parking/a/predictions');
    const sent = requests.find((r) => r.path === '/predict')!;
    expect(sent.body.neighbours.every((n: { history: (number | null)[] }) => !n.history.includes(0.8))).toBe(true);
  });

  it('is unavailable when a simulated facility has no snapshots, and stale when data is old', async () => {
    await fixtures();
    expect((await request(app).get('/api/parking/a/predictions')).body.status).toBe('INSUFFICIENT_DATA');
    await prisma.occupancySnapshot.create({
      data: { zoneId: 'z_a', observedAt: new Date(Date.now() - 3 * 3_600_000), occupied: 5, capacity: 20, available: 15, occupancy: 0.25, sourceType: 'SIMULATION' },
    });
    const stale = await request(app).get('/api/parking/a/predictions');
    expect(stale.body).toMatchObject({ status: 'STALE', message: 'Prediction unavailable — occupancy data is out of date.' });
  });

  it('degrades to "temporarily unavailable" when the ML service is down, and discovery keeps working', async () => {
    await fixtures();
    await series('z_a', [0.5, 0.6]);
    config.ML_SERVICE_URL = 'http://127.0.0.1:9'; // nothing listens here
    const res = await request(app).get('/api/parking/a/predictions');
    expect(res.body).toMatchObject({ status: 'SERVICE_UNAVAILABLE', message: 'Prediction temporarily unavailable.' });
    expect((await request(app).get('/api/parking/a')).status).toBe(200);
  });

  it('sends grid histories of the zone and its neighbours within the model radius, stores and reuses predictions', async () => {
    await fixtures();
    await series('z_a', Array.from({ length: 24 }, (_, i) => 0.5 + i * 0.01));
    await series('z_b', Array(24).fill(0.7));
    await series('z_c', Array(24).fill(0.3));

    const res = await request(app).get('/api/parking/a/predictions');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('AVAILABLE');
    expect(res.body.model.id).toBe('spatial_temporal-hgb-v1');
    const zone = res.body.zones[0];
    expect(zone.isSimulated).toBe(true);
    expect(zone.currentOccupancy).toBeCloseTo(0.73);
    expect(zone.predictions.map((p: any) => p.horizonMinutes)).toEqual([5, 15]);
    expect(zone.predictions[1].predictedOccupancy).toBeCloseTo(0.76);
    expect(zone.predictions[1].pressureLevel).toBe('NORMAL');

    const sent = requests.find((r) => r.path === '/predict')!.body;
    expect(sent.history).toHaveLength(HISTORY_STEPS);
    expect(sent.history.at(-1)).toBeCloseTo(0.73);
    expect(sent.history.at(-25)).toBeNull(); // before the first snapshot: unknown, not filled
    expect(sent.observedBays).toBe(20);
    expect(sent.neighbours).toHaveLength(1); // b only: c is beyond 400 m, osm has no availability source
    expect(sent.neighbours[0].distanceM).toBeGreaterThan(200);
    expect(sent.neighbours[0].history.at(-1)).toBeCloseTo(0.7);
    expect(sent.timestamp).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:00$/);

    expect(await prisma.prediction.count({ where: { zoneId: 'z_a' } })).toBe(2);
    const again = await request(app).get('/api/parking/a/predictions');
    expect(again.body.zones[0].predictions[1].predictedOccupancy).toBeCloseTo(0.76);
    expect(requests.filter((r) => r.path === '/predict')).toHaveLength(1);
  });
});

describe('prediction evaluation', () => {
  it('fills actual occupancy and absolute error once the target time is observed', async () => {
    await fixtures();
    await series('z_a', Array(24).fill(0.5));
    await request(app).get('/api/parking/a/predictions');
    const p = await prisma.prediction.findFirstOrThrow({ where: { zoneId: 'z_a', horizonMinutes: 5 } });
    await prisma.occupancySnapshot.create({
      data: { zoneId: 'z_a', observedAt: new Date(p.targetTime.getTime() + 60_000), occupied: 12, capacity: 20, available: 8, occupancy: 0.6, sourceType: 'SIMULATION' },
    });
    expect(await evaluateDuePredictions(new Date(p.targetTime.getTime() + 120_000))).toBe(1);
    const done = await prisma.prediction.findUniqueOrThrow({ where: { id: p.id } });
    expect(done.actualOccupancy).toBeCloseTo(0.6);
    expect(done.absError).toBeCloseTo(Math.abs(p.predictedOccupancy - 0.6));
  });

  it('grid histories take the latest snapshot per 5-minute instant and leave gaps unknown', async () => {
    await fixtures();
    const end = floorToStep(new Date());
    await prisma.occupancySnapshot.createMany({
      data: [
        { zoneId: 'z_a', observedAt: new Date(end.getTime() - 240_000), occupancy: 0.2, sourceType: 'SIMULATION' },
        { zoneId: 'z_a', observedAt: new Date(end.getTime() - 60_000), occupancy: 0.4, sourceType: 'SIMULATION' },
        { zoneId: 'z_a', observedAt: new Date(end.getTime() - 900_000), occupancy: 0.9, sourceType: 'SIMULATION' },
      ],
    });
    const h = (await gridHistories(['z_a'], end, 5)).get('z_a')!;
    // instants: end-20, -15, -10, -5, 0 min. 0.9 sits exactly on -15; 0.2 (-4 min) is superseded by 0.4 (-1 min).
    expect(h).toEqual([null, 0.9, null, null, 0.4]);
  });
});

describe('spillover', () => {
  it('records a saturation event, warns about predicted pressure nearby and explains alternatives', async () => {
    await fixtures();
    await series('z_a', Array(24).fill(0.95)); // origin saturated
    await series('z_b', Array.from({ length: 24 }, (_, i) => 0.6 + i * 0.01)); // rising towards 0.83 -> predicted 0.86
    await series('z_c', Array(24).fill(0.3));

    const res = await request(app).get('/api/spillover/predictions').query({ facilityId: 'a' });
    expect(res.status).toBe(200);
    expect(res.body.origin.pressureLevel).toBe('SATURATED');
    expect(res.body.spilloverContext).toBe(true);
    expect(res.body.origin.activeSaturationEvent).toMatchObject({ zoneId: 'z_a', threshold: 0.9, isSimulated: true });
    expect(res.body.warnings.map((w: any) => w.facilityId)).toEqual(['b']);
    expect(res.body.warnings[0].message).toMatch(/^Parking pressure is likely to increase around b: predicted occupancy 86% in 15 min/);
    expect(res.body.warnings[0].message).not.toMatch(/will/i);
    expect(res.body.alternatives[0]).toMatchObject({ id: 'c' });
    expect(res.body.alternatives[0].reason).toMatch(/14 spaces currently available, predicted occupancy 33% in 15 min, 0\.7 km away/);
    expect(res.body.neighbours.find((n: any) => n.id === 'osm').predictionStatus).toBe('INSUFFICIENT_DATA');

    const events = await request(app).get('/api/spillover/events').query({ active: 'true' });
    expect(events.body.total).toBe(1);
    expect(events.body.items[0].facility.id).toBe('a');
  });

  it('treats re-saturation within 30 minutes as the same event', async () => {
    await fixtures();
    const t0 = floorToStep(new Date(Date.now() - 20 * 60_000));
    const snap = (min: number, occupancy: number) =>
      prisma.occupancySnapshot.create({ data: { zoneId: 'z_a', observedAt: new Date(t0.getTime() + min * 60_000), occupancy, occupied: Math.round(occupancy * 20), capacity: 20, sourceType: 'SIMULATION' } });
    await snap(0, 0.95);
    await request(app).get('/api/spillover/events');
    await snap(5, 0.85); // dips below
    await request(app).get('/api/spillover/events');
    await snap(10, 0.95); // back within 30 min
    const res = await request(app).get('/api/spillover/events');
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].endedAt).toBeNull();
  });

  it('closes the event when occupancy drops below the threshold', async () => {
    await fixtures();
    await series('z_a', [0.95]);
    await request(app).get('/api/spillover/events');
    await prisma.occupancySnapshot.create({
      data: { zoneId: 'z_a', observedAt: new Date(Date.now() + 1000), occupied: 10, capacity: 20, available: 10, occupancy: 0.5, sourceType: 'SIMULATION' },
    });
    const res = await request(app).get('/api/spillover/events').query({ active: 'false' });
    // the future-dated snapshot is ignored until it is observed
    expect(res.body.total).toBe(0);
  });

  it('ranking excludes closed, saturated and unavailable facilities and weighs distance', () => {
    const base = { type: 'PUBLIC', latitude: 0, longitude: 0, predictionStatus: 'AVAILABLE' as const };
    const avail = (occupancy: number, available: number) => ({ state: 'SIMULATED' as const, occupancy, available, message: '', occupied: null, capacity: null, observedAt: null, ageMinutes: 1, sourceType: null });
    const ranked = rankAlternatives(
      [
        { ...base, id: 'closed', displayName: 'closed', distanceMeters: 100, openNow: false, availability: avail(0.1, 50), predicted: null },
        { ...base, id: 'full', displayName: 'full', distanceMeters: 100, openNow: true, availability: avail(0.95, 1), predicted: null },
        { ...base, id: 'fillsup', displayName: 'fillsup', distanceMeters: 100, openNow: true, availability: avail(0.8, 5), predicted: { horizonMinutes: 15, predictedOccupancy: 0.93, pressureLevel: null } },
        { ...base, id: 'far', displayName: 'far', distanceMeters: 3000, openNow: null, availability: avail(0.4, 30), predicted: null },
        { ...base, id: 'near', displayName: 'near', distanceMeters: 200, openNow: null, availability: avail(0.5, 20), predicted: null },
        { ...base, id: 'none', displayName: 'none', distanceMeters: 50, openNow: null, availability: { ...avail(0, 0), state: 'UNAVAILABLE' as const, occupancy: null }, predicted: null },
      ],
      DEFAULT_SETTINGS,
    );
    expect(ranked.map((r) => r.id)).toEqual(['near', 'far']);
    expect(ranked[1].reason).toContain('no prediction available');
  });
});

describe('analytics', () => {
  it('reports model performance and marks the ML service unavailable instead of failing', async () => {
    const ok = await request(app).get('/api/analytics/model-performance');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ mlService: 'up', registry: { active: 'spatial_temporal-hgb-v1' }, online: [] });
    clearRegistryCache();
    config.ML_SERVICE_URL = 'http://127.0.0.1:9';
    const down = await request(app).get('/api/analytics/model-performance');
    expect(down.status).toBe(200);
    expect(down.body).toMatchObject({ mlService: 'unavailable', registry: null, offline: null });
  });

  it('restricts individual prediction errors to admins', async () => {
    expect((await request(app).get('/api/analytics/prediction-errors')).status).toBe(401);
    await createUser('USER');
    const user = await loginAs(app, 'user@test.local');
    expect((await user.get('/api/analytics/prediction-errors')).status).toBe(403);
    await createUser('ADMIN');
    const admin = await loginAs(app, 'admin@test.local');
    const res = await admin.get('/api/analytics/prediction-errors');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 0, items: [] });
  });
});

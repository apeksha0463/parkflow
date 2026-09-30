import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/db.js';
import { CSRF, createUser, loginAs, resetDb } from '../test/helpers.js';
import { clearGeocodeCache, mergeResults } from '../services/geocode.js';
import { clearReplayCache } from '../services/replay.js';

const app = createApp();
const ORIGIN = { lat: -37.8136, lng: 144.9631 }; // test fixture coordinates (Melbourne CBD)

async function fixtures() {
  const other = await prisma.dataSource.create({ data: { name: 'Test directory', sourceType: 'VERIFIED_DIRECTORY' } });
  const sensors = await prisma.dataSource.create({ data: { name: 'Test sensors', sourceType: 'HISTORICAL_DATA' } });
  const mk = (id: string, dLat: number, extra: Record<string, unknown> = {}) =>
    prisma.parkingFacility.create({
      data: {
        id,
        externalId: `test:${id}`,
        latitude: ORIGIN.lat + dLat,
        longitude: ORIGIN.lng,
        dataSourceId: other.id,
        area: 'Test Area',
        zones: { create: { id: `z_${id}`, name: 'Main', latitude: ORIGIN.lat + dLat, longitude: ORIGIN.lng } },
        ...extra,
      },
    });
  await mk('near', 0.001, { name: 'Near Lot', type: 'OFF_STREET', operatingHours: '24/7', isFree: true, evCharging: true });
  await mk('mid', 0.005, { type: 'MULTI_LEVEL', operatingHours: 'off', vehicleTypes: ['CAR'] });
  await mk('far', 0.03, { name: 'Far Mall', type: 'MALL' });
  await mk('sim', 0.002, {
    name: 'Test Street between A Street and B Street',
    type: 'ON_STREET',
    availabilityMode: 'REPLAY',
    dataSourceId: sensors.id,
    capacity: 100,
  });
  // research neighbour pairs (directed, as in neighbours.csv)
  await prisma.zoneNeighbour.createMany({
    data: [
      { zoneId: 'z_near', neighbourId: 'z_sim', distanceM: 111 },
      { zoneId: 'z_near', neighbourId: 'z_mid', distanceM: 445 },
    ],
  });
}

async function snapshot(zoneId: string, minutesAgo: number, occupied: number, capacity = 100) {
  await prisma.occupancySnapshot.create({
    data: {
      zoneId,
      observedAt: new Date(Date.now() - minutesAgo * 60_000),
      occupied,
      capacity,
      available: capacity - occupied,
      occupancy: occupied / capacity,
      sourceType: 'HISTORICAL_DATA',
    },
  });
}

beforeEach(async () => {
  await resetDb();
  clearReplayCache();
  clearGeocodeCache();
  vi.restoreAllMocks();
});

describe('GET /api/parking', () => {
  it('returns facilities within the radius ordered by distance, with derived names flagged', async () => {
    await fixtures();
    const res = await request(app).get('/api/parking').query({ ...ORIGIN, radius: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.items.map((f: { id: string }) => f.id)).toEqual(['near', 'sim', 'mid']);
    expect(res.body.total).toBe(3);
    const [near, , mid] = res.body.items;
    expect(near.distanceMeters).toBeGreaterThan(90);
    expect(near.distanceMeters).toBeLessThan(130);
    expect(mid).toMatchObject({ name: null, nameIsDerived: true, displayName: 'Multi-level parking near Test Area' });
    expect(near.source.name).toBe('Test directory');
  });

  it('never invents availability for facilities without a source', async () => {
    await fixtures();
    const res = await request(app).get('/api/parking').query({ ...ORIGIN, radius: 1000 });
    const near = res.body.items.find((f: { id: string }) => f.id === 'near');
    expect(near.availability).toMatchObject({ state: 'UNAVAILABLE', message: 'No reading at this time.', available: null, occupancy: null });
  });

  it('reports replayed availability with freshness and pressure, and marks old data stale', async () => {
    await fixtures();
    await snapshot('z_sim', 3, 92);
    let res = await request(app).get('/api/parking').query({ ...ORIGIN, radius: 1000 });
    let sim = res.body.items.find((f: { id: string }) => f.id === 'sim');
    expect(sim.availability).toMatchObject({ state: 'REPLAY', occupied: 92, available: 8, capacity: 100, ageMinutes: 3 });
    expect(sim.availability.message).toMatch(/Historical replay/);
    expect(sim.pressureLevel).toBe('SATURATED');

    await prisma.occupancySnapshot.deleteMany();
    await snapshot('z_sim', 45, 50);
    res = await request(app).get('/api/parking').query({ ...ORIGIN, radius: 1000 });
    sim = res.body.items.find((f: { id: string }) => f.id === 'sim');
    expect(sim.availability.state).toBe('STALE');
  });

  it('filters by type, EV, free, vehicle type, open now and availability', async () => {
    await fixtures();
    const ids = async (q: Record<string, string | number>) =>
      (await request(app).get('/api/parking').query({ ...ORIGIN, radius: 5000, ...q })).body.items.map((f: { id: string }) => f.id).sort();
    expect(await ids({ types: 'MALL,MULTI_LEVEL' })).toEqual(['far', 'mid']);
    expect(await ids({ ev: 'true' })).toEqual(['near']);
    expect(await ids({ free: 'true' })).toEqual(['near']);
    expect(await ids({ vehicleType: 'CAR' })).toEqual(['mid']);
    expect(await ids({ openNow: 'true' })).toEqual(['near']);
    expect(await ids({ hasAvailability: 'true' })).toEqual(['sim']);
    expect(await ids({ q: 'mall' })).toEqual(['far']);
  });

  it('paginates', async () => {
    await fixtures();
    const res = await request(app).get('/api/parking').query({ ...ORIGIN, radius: 5000, pageSize: 2, page: 2 });
    expect(res.body.items.map((f: { id: string }) => f.id)).toEqual(['mid', 'far']);
    expect(res.body.total).toBe(4);
  });

  it('validates query parameters', async () => {
    expect((await request(app).get('/api/parking').query({ lat: 12.9 })).status).toBe(400);
    expect((await request(app).get('/api/parking').query({ bbox: '1,2,0,1' })).status).toBe(400);
    expect((await request(app).get('/api/parking').query({ types: 'SPACESHIP' })).status).toBe(400);
    expect((await request(app).get('/api/parking').query({ ...ORIGIN, radius: 999999 })).status).toBe(400);
  });
});

describe('map, detail, neighbours', () => {
  it('returns compact markers inside a bbox', async () => {
    await fixtures();
    const bbox = [ORIGIN.lng - 0.01, ORIGIN.lat - 0.01, ORIGIN.lng + 0.01, ORIGIN.lat + 0.01].join(',');
    const res = await request(app).get('/api/parking/map').query({ bbox });
    expect(res.status).toBe(200);
    expect(res.body.items.map((m: { id: string }) => m.id).sort()).toEqual(['mid', 'near', 'sim']);
    expect(res.body.items[0]).toHaveProperty('availabilityState');
  });

  it('applies the same filters to map markers as to the list', async () => {
    await fixtures();
    const bbox = [ORIGIN.lng - 0.05, ORIGIN.lat - 0.05, ORIGIN.lng + 0.05, ORIGIN.lat + 0.05].join(',');
    const ids = async (q: Record<string, string>) =>
      (await request(app).get('/api/parking/map').query({ bbox, ...q })).body.items.map((m: { id: string }) => m.id).sort();
    expect(await ids({ ev: 'true' })).toEqual(['near']);
    expect(await ids({ openNow: 'true' })).toEqual(['near']);
    expect(await ids({ types: 'MALL' })).toEqual(['far']);
  });

  it('returns facility detail with zones and 404 for unknown ids', async () => {
    await fixtures();
    const res = await request(app).get('/api/parking/near');
    expect(res.status).toBe(200);
    expect(res.body.facility.zones).toHaveLength(1);
    expect(res.body.facility.openNow).toBe(true);
    expect((await request(app).get('/api/parking/nope')).status).toBe(404);
  });

  it('labels snapshot data on a no-source facility as historical, not live', async () => {
    await fixtures();
    await snapshot('z_near', 2, 10);
    const res = await request(app).get('/api/parking/near');
    expect(res.body.facility.availability.state).toBe('HISTORICAL_ONLY');
  });

  it('returns the research neighbour pairs, nearest first', async () => {
    await fixtures();
    const res = await request(app).get('/api/parking/near/neighbours');
    expect(res.status).toBe(200);
    expect(res.body.items.map((f: { id: string }) => f.id)).toEqual(['sim', 'mid']);
    expect(res.body.items[0].distanceMeters).toBe(111);
    expect((await request(app).get('/api/parking/far/neighbours')).body.items).toEqual([]);
  });
});

describe('search', () => {
  it('suggests sensor zones without calling the external geocoder', async () => {
    await fixtures();
    const spy = vi.spyOn(globalThis, 'fetch');
    const res = await request(app).get('/api/search/geocode').query({ q: 'test street' });
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ label: 'Test Street between A Street and B Street', kind: 'zone' });
    expect(res.body.geocoder).toBe('not_used');
    expect(spy).not.toHaveBeenCalled();
  });

  it('degrades gracefully when the geocoder is unavailable', async () => {
    await fixtures();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const res = await request(app).get('/api/search/geocode').query({ q: 'test street', mode: 'full' });
    expect(res.status).toBe(200);
    expect(res.body.geocoder).toBe('unavailable');
    expect(res.body.results[0].kind).toBe('zone');
  });

  it('bounds the geocoder to Melbourne, lists places first and removes near-duplicates', async () => {
    await fixtures();
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          { place_id: 1, lat: String(ORIGIN.lat + 0.002), lon: String(ORIGIN.lng), name: 'Test Street between A Street and B Street', display_name: 'x, Melbourne' },
          { place_id: 2, lat: '-37.8183', lon: '144.9671', name: 'Some Place', display_name: 'Some Place, Melbourne, Victoria' },
        ]),
      ),
    );
    const res = await request(app).get('/api/search/geocode').query({ q: 'test street', mode: 'full' });
    expect(res.body.geocoder).toBe('ok');
    expect(res.body.results.map((r: { kind: string }) => r.kind)).toEqual(['place', 'place']);
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain('countrycodes=au');
    expect(url).toContain('bounded=1');
    expect(mergeResults([], [])).toEqual([]);
  });

  it('rejects too-short queries', async () => {
    expect((await request(app).get('/api/search/geocode').query({ q: 'k' })).status).toBe(400);
  });

  it('stores recent searches only for signed-in users', async () => {
    const body = { query: 'Test place', latitude: ORIGIN.lat, longitude: ORIGIN.lng };
    expect((await request(app).post('/api/search/recent').set(CSRF).send(body)).status).toBe(401);
    await createUser('USER', 'u@example.com');
    const agent = await loginAs(app, 'u@example.com');
    expect((await agent.post('/api/search/recent').set(CSRF).send(body)).status).toBe(201);
    const list = await agent.get('/api/search/recent');
    expect(list.body.items[0].query).toBe('Test place');
  });
});

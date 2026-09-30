import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/db.js';
import { clearRegistryCache } from '../services/ml.js';
import { clearReplayCache } from '../services/replay.js';
import { config } from '../config.js';
import { resetDb } from '../test/helpers.js';

const app = createApp();
beforeEach(async () => {
  await resetDb();
  clearReplayCache();
  clearRegistryCache();
  config.ML_SERVICE_URL = 'http://127.0.0.1:9'; // unreachable: the overview must still answer
});

describe('GET /api/stats', () => {
  it('computes overview figures from the data and reports the model as unavailable when the ML service is down', async () => {
    const src = await prisma.dataSource.create({ data: { name: 'Test sensors', sourceType: 'HISTORICAL_DATA' } });
    const mk = (id: string, lat: number, lng: number) =>
      prisma.parkingFacility.create({
        data: { id, latitude: lat, longitude: lng, dataSourceId: src.id, availabilityMode: 'REPLAY', zones: { create: { id: `z_${id}`, name: id, latitude: lat, longitude: lng } } },
      });
    await mk('a', -37.81, 144.96);
    await mk('b', -37.82, 144.97);
    await prisma.zoneNeighbour.create({ data: { zoneId: 'z_a', neighbourId: 'z_b', distanceM: 150 } });
    await prisma.saturationEvent.create({ data: { zoneId: 'z_a', startedAt: new Date(), peakOccupancy: 0.95, threshold: 0.9 } });
    const res = await request(app).get('/api/stats');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ zones: 2, zonesWithNeighbours: 1, neighbourRelations: 1, saturationEvents: 1 });
    expect(res.body.bounds).toEqual({ south: -37.82, west: 144.96, north: -37.81, east: 144.97 });
    expect(res.body.model).toMatchObject({ status: 'unavailable', horizonsMinutes: null });
    expect(res.body.replay.mode).toBe('NOT_CONFIGURED');
    expect(res.body.sources[0].name).toBe('Test sensors');
  });
});

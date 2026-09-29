import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/db.js';
import { resetDb } from '../test/helpers.js';

const app = createApp();
beforeEach(resetDb);

describe('GET /api/stats', () => {
  it('counts real directory facilities separately from demo ones', async () => {
    const src = await prisma.dataSource.create({ data: { name: 'OpenStreetMap', sourceType: 'VERIFIED_DIRECTORY' } });
    const base = { latitude: 12.97, longitude: 77.59, dataSourceId: src.id };
    await prisma.parkingFacility.createMany({
      data: [
        { ...base, type: 'MALL' },
        { ...base, type: 'MALL' },
        { ...base, type: 'METRO' },
        { ...base, type: 'PUBLIC', isDemo: true, availabilityMode: 'SIMULATION' },
      ],
    });
    const res = await request(app).get('/api/stats');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ facilities: 3, demoFacilities: 1, liveAvailabilityFacilities: 0, localities: 0 });
    expect(res.body.byType[0]).toEqual({ type: 'MALL', label: 'Mall', count: 2 });
    expect(res.body.sources[0].name).toBe('OpenStreetMap');
  });
});

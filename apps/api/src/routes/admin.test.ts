import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/db.js';
import { CSRF, createUser, loginAs, resetDb } from '../test/helpers.js';
import { DEFAULT_SETTINGS } from '../services/settings.js';

const app = createApp();

beforeEach(resetDb);

describe('admin authorization', () => {
  it('rejects anonymous users with 401 and regular users with 403', async () => {
    expect((await request(app).get('/api/admin/settings')).status).toBe(401);
    await createUser('USER', 'u@example.com');
    const user = await loginAs(app, 'u@example.com');
    const res = await user.get('/api/admin/settings');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('admin settings', () => {
  it('returns defaults, updates the saturation threshold and writes an audit log', async () => {
    await createUser('ADMIN', 'a@example.com');
    const admin = await loginAs(app, 'a@example.com');

    const initial = await admin.get('/api/admin/settings');
    expect(initial.body.settings).toEqual(DEFAULT_SETTINGS);

    const upd = await admin.patch('/api/admin/settings').set(CSRF).send({ saturationThreshold: 0.85 });
    expect(upd.status).toBe(200);
    expect(upd.body.settings.saturationThreshold).toBe(0.85);

    const pub = await request(app).get('/api/config');
    expect(pub.body.saturationThreshold).toBe(0.85);

    const logs = await admin.get('/api/admin/audit-logs?action=settings');
    expect(logs.body.total).toBe(1);
    expect(logs.body.items[0].actor.email).toBe('a@example.com');
  });

  it('rejects invalid or inconsistent thresholds and unknown keys', async () => {
    await createUser('ADMIN', 'a@example.com');
    const admin = await loginAs(app, 'a@example.com');
    expect((await admin.patch('/api/admin/settings').set(CSRF).send({ saturationThreshold: 1.5 })).status).toBe(400);
    expect((await admin.patch('/api/admin/settings').set(CSRF).send({ approachingThreshold: 0.95 })).status).toBe(400);
    expect((await admin.patch('/api/admin/settings').set(CSRF).send({ bogus: 1 })).status).toBe(400);
    expect(await prisma.systemConfig.count()).toBe(0);
  });
});

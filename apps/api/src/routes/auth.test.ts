import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';
import { prisma } from '../lib/db.js';
import { config } from '../config.js';
import { CSRF, createUser, loginAs, resetDb } from '../test/helpers.js';

const app = createApp();

beforeEach(resetDb);

describe('POST /api/auth/register', () => {
  it('creates a USER, hashes the password and sets an httpOnly session cookie', async () => {
    const res = await request(app).post('/api/auth/register').set(CSRF).send({ name: 'Asha', email: 'Asha@Example.com', password: 'longenough1' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'asha@example.com', role: 'USER' });
    expect(res.body.user.passwordHash).toBeUndefined();
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/pf_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'asha@example.com' } });
    expect(stored.passwordHash).not.toContain('longenough1');
  });

  it('ignores attempts to self-assign ADMIN', async () => {
    const res = await request(app).post('/api/auth/register').set(CSRF).send({ name: 'X', email: 'x@example.com', password: 'longenough1', role: 'ADMIN' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('USER');
  });

  it('rejects duplicate emails and weak passwords', async () => {
    await createUser('USER', 'dup@example.com');
    const dup = await request(app).post('/api/auth/register').set(CSRF).send({ name: 'D', email: 'dup@example.com', password: 'longenough1' });
    expect(dup.status).toBe(409);
    const weak = await request(app).post('/api/auth/register').set(CSRF).send({ name: 'W', email: 'w@example.com', password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects state-changing requests without the CSRF header', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'A', email: 'a@example.com', password: 'longenough1' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
  });
});

describe('login / me / logout', () => {
  it('logs in, returns the current user, and logout revokes the session', async () => {
    await createUser('USER', 'u@example.com');
    const agent = await loginAs(app, 'u@example.com');
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('u@example.com');

    const cookieBefore = me.request.cookies;
    const out = await agent.post('/api/auth/logout').set(CSRF);
    expect(out.status).toBe(204);

    // A replayed pre-logout token must be rejected (tokenVersion bumped).
    const replay = await request(app).get('/api/auth/me').set('Cookie', cookieBefore);
    expect(replay.status).toBe(401);
  });

  it('returns the same error for unknown email and wrong password', async () => {
    await createUser('USER', 'u@example.com');
    const wrong = await request(app).post('/api/auth/login').set(CSRF).send({ email: 'u@example.com', password: 'nope-nope' });
    const unknown = await request(app).post('/api/auth/login').set(CSRF).send({ email: 'ghost@example.com', password: 'nope-nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('reports SESSION_EXPIRED for an expired token', async () => {
    const user = await createUser('USER', 'u@example.com');
    const expired = jwt.sign({ sub: user.id, role: user.role, tv: 0, exp: Math.floor(Date.now() / 1000) - 10 }, config.JWT_SECRET);
    const res = await request(app).get('/api/auth/me').set('Cookie', `pf_session=${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('rejects tampered tokens', async () => {
    const user = await createUser('USER', 'u@example.com');
    const forged = jwt.sign({ sub: user.id, role: 'ADMIN', tv: 0 }, 'not-the-secret');
    const res = await request(app).get('/api/auth/me').set('Cookie', `pf_session=${forged}`);
    expect(res.status).toBe(401);
  });

  it('changes password only with the current password', async () => {
    await createUser('USER', 'u@example.com');
    const agent = await loginAs(app, 'u@example.com');
    const bad = await agent.patch('/api/auth/me').set(CSRF).send({ currentPassword: 'wrong', newPassword: 'another-pass-1' });
    expect(bad.status).toBe(400);
    const ok = await agent.patch('/api/auth/me').set(CSRF).send({ currentPassword: 'correct-horse-9', newPassword: 'another-pass-1' });
    expect(ok.status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    await loginAs(app, 'u@example.com', 'another-pass-1');
  });
});

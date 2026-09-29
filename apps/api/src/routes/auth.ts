import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { SESSION_COOKIE, sessionCookieOptions, signSession } from '../lib/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { config } from '../config.js';

const BCRYPT_ROUNDS = 12;
// Compared against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('parkflow-timing-equaliser', BCRYPT_ROUNDS);

const email = z.string().trim().toLowerCase().email().max(254);
const RegisterBody = z.object({
  name: z.string().trim().min(1).max(100),
  email,
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});
const LoginBody = z.object({ email, password: z.string().min(1).max(128) });

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes and try again.' } },
});

const publicUser = { id: true, email: true, name: true, role: true, createdAt: true } as const;

export const authRouter = Router();

authRouter.post('/register', authLimiter, async (req, res) => {
  const body = RegisterBody.parse(req.body);
  const existing = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
  if (existing) throw new HttpError(409, 'EMAIL_IN_USE', 'An account with this email already exists.');

  // Self-registration always creates USER accounts; admins are provisioned by seed/admin only.
  const user = await prisma.user.create({
    data: { name: body.name, email: body.email, passwordHash: await bcrypt.hash(body.password, BCRYPT_ROUNDS) },
    select: { ...publicUser, tokenVersion: true },
  });
  res.cookie(SESSION_COOKIE, signSession({ sub: user.id, role: user.role, tv: user.tokenVersion }), sessionCookieOptions());
  req.user = user;
  await audit(req, 'auth.register', 'User', user.id);
  const { tokenVersion: _tv, ...out } = user;
  res.status(201).json({ user: out });
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const body = LoginBody.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  const valid = await bcrypt.compare(body.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');

  res.cookie(SESSION_COOKIE, signSession({ sub: user.id, role: user.role, tv: user.tokenVersion }), sessionCookieOptions());
  req.user = user;
  await audit(req, 'auth.login', 'User', user.id);
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt } });
});

authRouter.post('/logout', requireAuth, async (req, res) => {
  // Bumping tokenVersion revokes this and any other outstanding session tokens.
  await prisma.user.update({ where: { id: req.user!.id }, data: { tokenVersion: { increment: 1 } } });
  await audit(req, 'auth.logout', 'User', req.user!.id);
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: publicUser });
  res.json({ user });
});

const ProfileBody = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    currentPassword: z.string().max(128).optional(),
    newPassword: z.string().min(8, 'Password must be at least 8 characters').max(128).optional(),
  })
  .refine((b) => !b.newPassword || b.currentPassword, { message: 'Current password is required', path: ['currentPassword'] });

authRouter.patch('/me', requireAuth, async (req, res) => {
  const body = ProfileBody.parse(req.body);
  const data: { name?: string; passwordHash?: string; tokenVersion?: { increment: number } } = {};
  if (body.name) data.name = body.name;
  if (body.newPassword) {
    const current = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await bcrypt.compare(body.currentPassword!, current.passwordHash))) {
      throw new HttpError(400, 'INVALID_PASSWORD', 'Current password is incorrect.');
    }
    data.passwordHash = await bcrypt.hash(body.newPassword, BCRYPT_ROUNDS);
    data.tokenVersion = { increment: 1 };
  }
  const user = await prisma.user.update({ where: { id: req.user!.id }, data, select: { ...publicUser, tokenVersion: true } });
  if (body.newPassword) {
    // Password change revokes other sessions; issue a fresh token for this one.
    res.cookie(SESSION_COOKIE, signSession({ sub: user.id, role: user.role, tv: user.tokenVersion }), sessionCookieOptions());
  }
  await audit(req, body.newPassword ? 'auth.password_change' : 'user.profile_update', 'User', user.id);
  const { tokenVersion: _tv, ...out } = user;
  res.json({ user: out });
});

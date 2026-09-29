import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { GeocoderUnavailableError, mergeResults, searchLocalities, searchNominatim } from '../services/geocode.js';

export const searchRouter = Router();

const SearchQuery = z.object({
  q: z.string().trim().min(2, 'Type at least 2 characters').max(120),
  mode: z.enum(['suggest', 'full']).default('suggest'),
});

// Full searches reach an external service; keep per-client volume modest.
const fullSearchLimiter = rateLimit({
  windowMs: 60_000,
  limit: config.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many searches. Please wait a moment.' } },
});

searchRouter.get('/geocode', (req, res, next) => (req.query.mode === 'full' ? fullSearchLimiter(req, res, next) : next()), async (req, res) => {
  const { q, mode } = SearchQuery.parse(req.query);
  const localities = await searchLocalities(q);
  if (mode === 'suggest') {
    res.json({ results: localities, geocoder: 'not_used' });
    return;
  }
  try {
    const places = await searchNominatim(q);
    res.json({ results: mergeResults(localities, places), geocoder: 'ok' });
  } catch (err) {
    if (!(err instanceof GeocoderUnavailableError)) throw err;
    req.log?.warn({ err: err.message }, 'Geocoder unavailable');
    // Degrade gracefully to our own locality index.
    res.json({ results: localities, geocoder: 'unavailable' });
  }
});

const RecentBody = z.object({
  query: z.string().trim().min(1).max(200),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

searchRouter.post('/recent', requireAuth, async (req, res) => {
  const body = RecentBody.parse(req.body);
  const created = await prisma.recentSearch.create({ data: { ...body, userId: req.user!.id } });
  // Keep only the 20 most recent per user.
  const stale = await prisma.recentSearch.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, skip: 20, select: { id: true } });
  if (stale.length) await prisma.recentSearch.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  res.status(201).json({ search: created });
});

searchRouter.get('/recent', requireAuth, async (req, res) => {
  const items = await prisma.recentSearch.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 10 });
  res.json({ items });
});

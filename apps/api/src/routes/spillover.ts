import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { notFound } from '../lib/errors.js';
import { displayName } from '../services/facilities.js';
import { spilloverAround, syncSaturation } from '../services/spillover.js';

export const spilloverRouter = Router();

const EventsQuery = z.object({
  active: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  facilityId: z.string().max(40).optional(),
  simulated: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Saturation events derived from occupancy snapshots (observed or simulation-replay, flagged per event). */
spilloverRouter.get('/events', async (req, res) => {
  const q = EventsQuery.parse(req.query);
  await syncSaturation();
  const where = {
    ...(q.active != null ? { endedAt: q.active ? null : { not: null } } : {}),
    ...(q.facilityId ? { zone: { facilityId: q.facilityId } } : {}),
    ...(q.simulated != null ? { isSimulated: q.simulated } : {}),
  };
  const [total, events] = await Promise.all([
    prisma.saturationEvent.count({ where }),
    prisma.saturationEvent.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { zone: { select: { id: true, name: true, facility: { select: { id: true, name: true, type: true, area: true, latitude: true, longitude: true } } } } },
    }),
  ]);
  res.json({
    total,
    page: q.page,
    pageSize: q.pageSize,
    items: events.map((e) => ({
      id: e.id,
      startedAt: e.startedAt,
      endedAt: e.endedAt,
      peakOccupancy: e.peakOccupancy,
      threshold: e.threshold,
      isSimulated: e.isSimulated,
      zone: { id: e.zone.id, name: e.zone.name },
      facility: { ...e.zone.facility, ...displayName(e.zone.facility.name, e.zone.facility.type, e.zone.facility.area) },
    })),
  });
});

const PredictionsQuery = z.object({ facilityId: z.string().min(1).max(40) });

/** Predicted pressure in the neighbourhood of a facility, with warnings and ranked alternatives. */
spilloverRouter.get('/predictions', async (req, res) => {
  const { facilityId } = PredictionsQuery.parse(req.query);
  await syncSaturation();
  const out = await spilloverAround(facilityId);
  if (!out) throw notFound('Parking facility');
  res.json(out);
});

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { notFound } from '../lib/errors.js';
import type { Prisma } from '../generated/prisma/client.js';
import { displayName } from '../services/facilities.js';
import { replayNow } from '../services/replay.js';
import { spilloverAround } from '../services/spillover.js';

export const spilloverRouter = Router();

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const EventsQuery = z.object({
  facilityId: z.string().max(40).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** Only events whose zone has research neighbours (i.e. where spillover can be analysed). */
  withNeighbours: bool.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const eventInclude = {
  zone: {
    select: {
      id: true,
      name: true,
      _count: { select: { neighbours: true } },
      facility: { select: { id: true, name: true, type: true, area: true, latitude: true, longitude: true, capacity: true } },
    },
  },
} satisfies Prisma.SaturationEventInclude;

type EventRow = Prisma.SaturationEventGetPayload<{ include: typeof eventInclude }>;

function toEventDto(e: EventRow, now: Date) {
  return {
    id: e.id,
    startedAt: e.startedAt,
    endedAt: e.endedAt,
    durationMinutes: e.endedAt ? Math.round((e.endedAt.getTime() - e.startedAt.getTime()) / 60_000) : null,
    peakOccupancy: e.peakOccupancy,
    threshold: e.threshold,
    activeAtReplayTime: e.startedAt <= now && (e.endedAt == null || e.endedAt > now),
    zone: { id: e.zone.id, name: e.zone.name, neighbourCount: e.zone._count.neighbours },
    facility: { ...e.zone.facility, ...displayName(e.zone.facility.name, e.zone.facility.type, e.zone.facility.area) },
  };
}

function eventWhere(q: { facilityId?: string; withNeighbours?: boolean }): Prisma.SaturationEventWhereInput {
  return {
    ...(q.facilityId ? { zone: { facilityId: q.facilityId } } : {}),
    ...(q.withNeighbours ? { zone: { ...(q.facilityId ? { facilityId: q.facilityId } : {}), neighbours: { some: {} } } } : {}),
  };
}

/** Research-defined saturation events of the replayed history, newest first. */
spilloverRouter.get('/events', async (req, res) => {
  const q = EventsQuery.parse(req.query);
  const now = await replayNow();
  const where: Prisma.SaturationEventWhereInput = {
    ...eventWhere(q),
    ...(q.from || q.to ? { startedAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
  };
  const [total, events] = await Promise.all([
    prisma.saturationEvent.count({ where }),
    prisma.saturationEvent.findMany({ where, orderBy: { startedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: eventInclude }),
  ]);
  res.json({ total, page: q.page, pageSize: q.pageSize, replayTime: now, items: events.map((e) => toEventDto(e, now)) });
});

const AdjacentQuery = z.object({
  direction: z.enum(['next', 'previous']),
  /** Reference instant; defaults to the replay clock. */
  from: z.coerce.date().optional(),
  /** Reference event: events starting at the same instant are ordered by id. */
  eventId: z.string().max(40).optional(),
  facilityId: z.string().max(40).optional(),
  withNeighbours: bool.optional(),
});

/** The event immediately after/before a reference instant (the replay clock by default). null at either end. */
spilloverRouter.get('/events/adjacent', async (req, res) => {
  const q = AdjacentQuery.parse(req.query);
  const now = await replayNow();
  const ref = q.eventId ? await prisma.saturationEvent.findUnique({ where: { id: q.eventId }, select: { id: true, startedAt: true } }) : null;
  const at = ref?.startedAt ?? q.from ?? now;
  const next = q.direction === 'next';
  const tie = ref ? [{ startedAt: at, id: next ? { gt: ref.id } : { lt: ref.id } }] : [];
  const event = await prisma.saturationEvent.findFirst({
    where: { ...eventWhere(q), OR: [{ startedAt: next ? { gt: at } : { lt: at } }, ...tie] },
    orderBy: [{ startedAt: next ? 'asc' : 'desc' }, { id: next ? 'asc' : 'desc' }],
    include: eventInclude,
  });
  res.json({ event: event ? toEventDto(event, now) : null });
});

spilloverRouter.get('/events/:id', async (req, res) => {
  const e = await prisma.saturationEvent.findUnique({ where: { id: req.params.id }, include: eventInclude });
  if (!e) throw notFound('Saturation event');
  res.json({ event: toEventDto(e, await replayNow()) });
});

const PredictionsQuery = z.object({ facilityId: z.string().min(1).max(40) });

/** Predicted pressure in the neighbourhood of a facility at the replay clock, with warnings and ranked alternatives. */
spilloverRouter.get('/predictions', async (req, res) => {
  const { facilityId } = PredictionsQuery.parse(req.query);
  const out = await spilloverAround(facilityId, await replayNow());
  if (!out) throw notFound('Parking facility');
  res.json(out);
});

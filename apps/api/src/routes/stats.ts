import { Router } from 'express';
import { prisma } from '../lib/db.js';
import { TYPE_LABEL } from '../services/facilities.js';

export const statsRouter = Router();

/** Public coverage figures, computed from the database (used on the landing page). */
statsRouter.get('/', async (_req, res) => {
  const [facilities, localities, withAvailability, demo, byType, sources] = await Promise.all([
    prisma.parkingFacility.count({ where: { isDemo: false } }),
    prisma.locality.count(),
    prisma.parkingFacility.count({ where: { availabilityMode: 'LIVE' } }),
    prisma.parkingFacility.count({ where: { isDemo: true } }),
    prisma.parkingFacility.groupBy({ by: ['type'], where: { isDemo: false }, _count: { _all: true } }),
    prisma.dataSource.findMany({ select: { name: true, sourceType: true, license: true, url: true, lastVerifiedAt: true }, orderBy: { name: 'asc' } }),
  ]);
  res.json({
    facilities,
    localities,
    liveAvailabilityFacilities: withAvailability,
    demoFacilities: demo,
    byType: byType
      .map((t) => ({ type: t.type, label: TYPE_LABEL[t.type], count: t._count._all }))
      .sort((a, b) => b.count - a.count),
    sources,
  });
});

import { Router } from 'express';
import { prisma } from '../lib/db.js';
import { getRegistry, MlUnavailableError, type Registry } from '../services/ml.js';
import { getReplayClock } from '../services/replay.js';

export const statsRouter = Router();

/** Overview figures, all computed from the database / model registry (used on the Overview page and map). */
statsRouter.get('/', async (_req, res) => {
  const [zones, zonesWithNeighbours, neighbourRelations, events, bounds, sources, clock] = await Promise.all([
    prisma.parkingFacility.count({ where: { availabilityMode: 'REPLAY' } }),
    prisma.parkingZone.count({ where: { neighbours: { some: {} } } }),
    prisma.zoneNeighbour.count(),
    prisma.saturationEvent.count(),
    prisma.parkingFacility.aggregate({ _min: { latitude: true, longitude: true }, _max: { latitude: true, longitude: true } }),
    prisma.dataSource.findMany({ select: { name: true, sourceType: true, license: true, url: true, description: true }, orderBy: { name: 'asc' } }),
    getReplayClock(),
  ]);
  let registry: Registry | null = null;
  try {
    registry = await getRegistry();
  } catch (err) {
    if (!(err instanceof MlUnavailableError)) throw err;
  }
  const active = registry ? (registry.models.find((m) => m.id === registry.active) ?? null) : null;
  res.json({
    zones,
    zonesWithNeighbours,
    neighbourRelations,
    saturationEvents: events,
    bounds:
      bounds._min.latitude != null
        ? { south: bounds._min.latitude, west: bounds._min.longitude, north: bounds._max.latitude, east: bounds._max.longitude }
        : null,
    replay: { mode: clock.configured ? 'HISTORICAL_REPLAY' : 'NOT_CONFIGURED', range: clock.range },
    model: {
      status: registry ? 'available' : 'unavailable',
      active: active?.id ?? null,
      featureSet: active?.feature_set ?? null,
      horizonsMinutes: active?.horizons_minutes ?? null,
      neighbourRadiusMeters: active?.config.neighbour_radius_m ?? null,
      saturationThreshold: active?.config.saturation_threshold ?? null,
      models: registry?.models.map((m) => ({ id: m.id, featureSet: m.feature_set })) ?? [],
    },
    sources,
  });
});

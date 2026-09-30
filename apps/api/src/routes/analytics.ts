import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireRole } from '../middleware/auth.js';
import { notFound } from '../lib/errors.js';
import { getDataset, getEvaluation, getRegistry, MlUnavailableError } from '../services/ml.js';
import { evaluateDuePredictions, predictedVsActual } from '../services/predictions.js';
import { replayNow } from '../services/replay.js';

export const analyticsRouter = Router();

interface OnlineRow {
  modelVersionId: string;
  horizonMinutes: number;
  isSimulated: boolean;
  n: bigint;
  mae: number | null;
  rmse: number | null;
}

/**
 * Model performance:
 *  - offline: the research evaluation (test split) exactly as written by the training run
 *  - online: predicted-vs-actual errors of predictions served by this deployment (only once actuals exist)
 * Either part is null when unavailable — never estimated.
 */
analyticsRouter.get('/model-performance', async (_req, res) => {
  let registry = null;
  let evaluation = null;
  let dataset = null;
  let mlStatus: 'up' | 'unavailable' = 'up';
  try {
    [registry, evaluation, dataset] = await Promise.all([getRegistry(), getEvaluation(), getDataset()]);
  } catch (err) {
    if (!(err instanceof MlUnavailableError)) throw err;
    mlStatus = 'unavailable';
  }
  await evaluateDuePredictions(await replayNow());
  const online = await prisma.$queryRaw<OnlineRow[]>`
    SELECT "modelVersionId", "horizonMinutes", "isSimulated", count(*) AS n,
           avg("absError") AS mae, sqrt(avg("absError" * "absError")) AS rmse
      FROM "Prediction"
     WHERE "evaluatedAt" IS NOT NULL
     GROUP BY 1, 2, 3
     ORDER BY 1, 2, 3`;
  res.json({
    mlService: mlStatus,
    registry,
    offline: evaluation,
    dataset,
    online: online.map((r) => ({ ...r, n: Number(r.n) })),
  });
});

const ErrorsQuery = z.object({
  horizon: z.coerce.number().int().min(1).max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

/** Individual served predictions with their observed outcome (admin). */
analyticsRouter.get('/prediction-errors', requireRole('ADMIN'), async (req, res) => {
  const q = ErrorsQuery.parse(req.query);
  await evaluateDuePredictions(await replayNow());
  const where = { evaluatedAt: { not: null }, ...(q.horizon ? { horizonMinutes: q.horizon } : {}) };
  const [total, items] = await Promise.all([
    prisma.prediction.count({ where }),
    prisma.prediction.findMany({
      where,
      orderBy: { targetTime: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true, zoneId: true, modelVersionId: true, predictionTime: true, horizonMinutes: true, targetTime: true,
        predictedOccupancy: true, actualOccupancy: true, absError: true, isSimulated: true,
      },
    }),
  ]);
  res.json({ total, page: q.page, pageSize: q.pageSize, items: items.map((i) => ({ ...i, id: i.id.toString() })) });
});

const PvaQuery = z
  .object({
    facilityId: z.string().min(1).max(40),
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .refine((q) => q.to >= q.from && q.to.getTime() - q.from.getTime() <= 3 * 3_600_000, { message: 'Window must be 0-3 hours', path: ['to'] });

/**
 * Predicted vs actual for one zone over a window of the replayed history: every registered model's prediction
 * (served by the ML service) for each 5-minute base time, the recorded outcome and the persistence baseline.
 */
analyticsRouter.get('/predicted-vs-actual', async (req, res) => {
  const q = PvaQuery.parse(req.query);
  const facility = await prisma.parkingFacility.findUnique({ where: { id: q.facilityId }, select: { id: true, availabilityMode: true, zones: { select: { id: true, name: true } } } });
  if (!facility) throw notFound('Parking facility');
  const zone = facility.zones[0];
  if (facility.availabilityMode !== 'REPLAY' || !zone) {
    res.json({ status: 'NO_MODEL', message: 'No model covers this zone.', result: null });
    return;
  }
  let registry;
  try {
    registry = await getRegistry();
  } catch (err) {
    if (!(err instanceof MlUnavailableError)) throw err;
    res.json({ status: 'SERVICE_UNAVAILABLE', message: 'Prediction service temporarily unavailable.', result: null });
    return;
  }
  try {
    res.json({ status: 'AVAILABLE', message: null, result: { zoneName: zone.name, ...(await predictedVsActual(zone.id, q.from, q.to, registry)) } });
  } catch (err) {
    if (!(err instanceof MlUnavailableError)) throw err;
    res.json({ status: 'SERVICE_UNAVAILABLE', message: 'Prediction service temporarily unavailable.', result: null });
  }
});

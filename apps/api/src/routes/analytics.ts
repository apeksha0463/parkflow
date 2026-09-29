import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireRole } from '../middleware/auth.js';
import { getEvaluation, getRegistry, MlUnavailableError } from '../services/ml.js';
import { evaluateDuePredictions } from '../services/predictions.js';

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
  let mlStatus: 'up' | 'unavailable' = 'up';
  try {
    [registry, evaluation] = await Promise.all([getRegistry(), getEvaluation()]);
  } catch (err) {
    if (!(err instanceof MlUnavailableError)) throw err;
    mlStatus = 'unavailable';
  }
  await evaluateDuePredictions();
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
  await evaluateDuePredictions();
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

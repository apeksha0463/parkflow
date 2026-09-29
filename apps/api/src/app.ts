import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { checkDatabase } from './lib/db.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authenticate, requireCsrfHeader } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { getSettings } from './services/settings.js';
import { areasRouter, parkingRouter } from './routes/parking.js';
import { searchRouter } from './routes/search.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  if (config.NODE_ENV !== 'test') app.use(pinoHttp());

  app.get('/health', async (_req, res) => {
    const database = await checkDatabase();
    res.status(database ? 200 : 503).json({
      status: database ? 'ok' : 'degraded',
      service: 'parkflow-api',
      database: database ? 'up' : 'down',
      time: new Date().toISOString(),
    });
  });

  const api = express.Router();
  api.use(rateLimit({ windowMs: 60_000, limit: config.NODE_ENV === 'test' ? 10_000 : 300, standardHeaders: 'draft-8', legacyHeaders: false }));
  api.use(requireCsrfHeader);
  api.use(authenticate);

  // Thresholds the UI needs to render status consistently with the server.
  api.get('/config', async (_req, res) => {
    const s = await getSettings();
    res.json({ saturationThreshold: s.saturationThreshold, approachingThreshold: s.approachingThreshold, staleAfterMinutes: s.staleAfterMinutes });
  });
  api.use('/auth', authRouter);
  api.use('/parking', parkingRouter);
  api.use('/areas', areasRouter);
  api.use('/search', searchRouter);
  api.use('/admin', adminRouter);

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

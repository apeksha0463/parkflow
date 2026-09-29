import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

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
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'parkflow-api', time: new Date().toISOString() });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError, z } from 'zod';
import { HttpError } from '../lib/errors.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } });
};

// Never leak stack traces or internal messages to clients.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: z.flattenError(err).fieldErrors } });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
    return;
  }
  req.log?.error({ err }, 'Unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
};

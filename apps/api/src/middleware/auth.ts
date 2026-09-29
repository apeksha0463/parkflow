import type { RequestHandler } from 'express';
import { SESSION_COOKIE, sessionCookieOptions, verifySession } from '../lib/auth.js';
import { prisma } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import type { Role } from '../generated/prisma/client.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

/** Attaches req.user when a valid session cookie is present. Never rejects. */
export const authenticate: RequestHandler = async (req, res, next) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  const result = verifySession(token);
  if (!result.ok) {
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
    res.locals.sessionError = result.reason;
    return next();
  }
  const user = await prisma.user.findUnique({
    where: { id: result.claims.sub },
    select: { id: true, email: true, name: true, role: true, tokenVersion: true },
  });
  if (!user || user.tokenVersion !== result.claims.tv) {
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
    res.locals.sessionError = 'invalid';
    return next();
  }
  req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
  next();
};

export const requireAuth: RequestHandler = (req, res, next) => {
  if (req.user) return next();
  if (res.locals.sessionError === 'expired') {
    return next(new HttpError(401, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.'));
  }
  next(new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.'));
};

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, res, next) =>
    requireAuth(req, res, (err?: unknown) => {
      if (err) return next(err);
      if (!roles.includes(req.user!.role)) {
        return next(new HttpError(403, 'FORBIDDEN', 'You do not have permission to perform this action.'));
      }
      next();
    });

/**
 * CSRF defence for cookie auth: state-changing requests must carry a custom header.
 * Browsers cannot send it cross-origin without a CORS preflight, which our allow-list rejects.
 */
export const requireCsrfHeader: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'ParkFlow') {
    return next(new HttpError(403, 'CSRF_REJECTED', 'Missing required request header.'));
  }
  next();
};

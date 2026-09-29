import type { CookieOptions } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import type { Role } from '../generated/prisma/client.js';

export const SESSION_COOKIE = 'pf_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface SessionClaims {
  sub: string;
  role: Role;
  tv: number;
}

export function signSession(claims: SessionClaims): string {
  return jwt.sign(claims, config.JWT_SECRET, { expiresIn: SESSION_TTL_SECONDS, algorithm: 'HS256' });
}

export type VerifyResult = { ok: true; claims: SessionClaims } | { ok: false; reason: 'expired' | 'invalid' };

export function verifySession(token: string): VerifyResult {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload & SessionClaims;
    return { ok: true, claims: { sub: payload.sub, role: payload.role, tv: payload.tv } };
  } catch (err) {
    return { ok: false, reason: err instanceof jwt.TokenExpiredError ? 'expired' : 'invalid' };
  }
}

export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: config.isProd || config.COOKIE_SAMESITE === 'none',
    sameSite: config.COOKIE_SAMESITE,
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: '/',
  };
}

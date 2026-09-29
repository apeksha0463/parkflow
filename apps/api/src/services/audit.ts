import type { Request } from 'express';
import { prisma } from '../lib/db.js';
import type { Prisma } from '../generated/prisma/client.js';

export async function audit(
  req: Request,
  action: string,
  entityType: string,
  entityId?: string | null,
  metadata?: Prisma.InputJsonValue,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: { actorId: req.user?.id ?? null, action, entityType, entityId: entityId ?? null, metadata, ip: req.ip ?? null },
    });
  } catch (err) {
    // Auditing must never break the request that triggered it.
    req.log?.error({ err, action }, 'Failed to write audit log');
  }
}

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { getSettings, updateSettings } from '../services/settings.js';

export const adminRouter = Router();
adminRouter.use(requireRole('ADMIN'));

adminRouter.get('/settings', async (_req, res) => {
  res.json({ settings: await getSettings() });
});

const SettingsPatch = z
  .object({
    saturationThreshold: z.number(),
    approachingThreshold: z.number(),
    neighbourRadiusMeters: z.number().int(),
    staleAfterMinutes: z.number().int(),
  })
  .partial()
  .strict();

adminRouter.patch('/settings', async (req, res) => {
  const patch = SettingsPatch.parse(req.body);
  const before = await getSettings();
  const settings = await updateSettings(patch, req.user!.id);
  await audit(req, 'settings.update', 'SystemConfig', null, { before, after: settings });
  res.json({ settings });
});

const AuditQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  entityType: z.string().max(50).optional(),
  action: z.string().max(80).optional(),
});

adminRouter.get('/audit-logs', async (req, res) => {
  const q = AuditQuery.parse(req.query);
  const where = { entityType: q.entityType, action: q.action ? { startsWith: q.action } : undefined };
  const [items, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { actor: { select: { id: true, email: true, name: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  res.json({ items, page: q.page, pageSize: q.pageSize, total });
});

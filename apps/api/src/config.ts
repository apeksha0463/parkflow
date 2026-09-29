import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(1).default('dev-only-secret'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  ML_SERVICE_URL: z.string().url().default('http://localhost:8000'),
  GEOCODER_USER_AGENT: z.string().default('ParkFlow/0.1'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration', z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

const env = parsed.data;

if (env.NODE_ENV === 'production') {
  const problems: string[] = [];
  if (!env.DATABASE_URL) problems.push('DATABASE_URL is required');
  if (env.JWT_SECRET.length < 32 || env.JWT_SECRET === 'change-me') problems.push('JWT_SECRET must be a strong secret (>=32 chars)');
  if (/localhost|127\.0\.0\.1/.test(env.CORS_ORIGINS + env.ML_SERVICE_URL)) problems.push('localhost URLs are not allowed in production');
  if (problems.length) {
    console.error('Refusing to start in production:', problems);
    process.exit(1);
  }
}

export const config = {
  ...env,
  corsOrigins: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
  isProd: env.NODE_ENV === 'production',
};

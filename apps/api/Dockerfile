# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /app

# Copy workspace manifests for layer caching
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN npm ci --ignore-scripts

# Copy API source
COPY apps/api/ ./apps/api/

# Generate Prisma client + compile TypeScript
WORKDIR /app/apps/api
RUN npx prisma generate
RUN npx tsc -p tsconfig.json

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/

# Production deps only
RUN npm ci --workspace=apps/api --omit=dev --ignore-scripts

# Compiled JS
COPY --from=builder /app/apps/api/dist ./apps/api/dist
# Prisma engine (generated at build time)
COPY --from=builder /app/apps/api/node_modules/.prisma ./apps/api/node_modules/.prisma
# Prisma schema (for migrate deploy)
COPY apps/api/prisma ./apps/api/prisma
# Seed scripts
COPY apps/api/scripts ./apps/api/scripts

# Replay dataset (38 MB) — baked into the image so the seed command works.
# This file is git-ignored locally but is committed for deployment builds.
COPY data/processed/replay_melbourne.json ./data/processed/replay_melbourne.json

ENV NODE_ENV=production
ENV TZ=Australia/Melbourne
ENV PORT=4000

WORKDIR /app/apps/api

EXPOSE 4000

CMD ["node", "dist/index.js"]

# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/

RUN npm ci --ignore-scripts

COPY apps/web/ ./apps/web/

# VITE_API_URL is intentionally left empty so the browser uses same-origin /api
# (Nginx in the runtime stage proxies /api → the API service internally)

WORKDIR /app/apps/web
RUN npm run build

# ── Stage 2: nginx ───────────────────────────────────────────────────────────
FROM nginx:alpine AS runtime

# Install envsubst (part of gettext) so we can template the upstream address
RUN apk add --no-cache gettext

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template

EXPOSE 80

# envsubst substitutes $API_UPSTREAM from the environment, then starts nginx
CMD ["/bin/sh", "-c", "envsubst '${API_UPSTREAM}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]

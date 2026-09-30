# Deployment

| Part | Host | Notes |
|---|---|---|
| Frontend (`apps/web`) | Vercel | Static build; `/api/*` is rewritten to the API, so the browser stays same-origin |
| API (`apps/api`) | Render (web service, `render.yaml`) | Runs migrations on start |
| ML service (`ml/service`) | Render (web service, `render.yaml`) | Loads the committed models; never trains |
| Database | Neon PostgreSQL + PostGIS | Free tier: 0.5 GB → replay 2 test weeks |

Free Render services sleep after ~15 min idle; the first request afterwards takes up to a minute.

## 1. Database (Neon)
1. Create a Neon project (region close to the Render region) and copy the pooled-off (direct) connection string with `sslmode=require`.
2. From a machine with the processed research data:
   ```bash
   cd ml && .venv/Scripts/python -m parkflow_ml.replay --weeks 2 && cd ..   # ~250 MB in the database
   DATABASE_URL="<neon url>" npm run db:migrate -w apps/api
   DATABASE_URL="<neon url>" npm run db:seed:melbourne -w apps/api
   ```
   The whole test split (`--weeks` omitted) needs ~0.8 GB.

## 2. API and ML service (Render)
1. Render → New → Blueprint → this repository (`render.yaml`).
2. Set `DATABASE_URL` (Neon), `ML_SERVICE_URL` (the `parkflow-ml` URL) and `CORS_ORIGINS` (the Vercel URL).
3. Check `https://<parkflow-api>.onrender.com/health` → `{"status":"ok","database":"up"}`.

## 3. Frontend (Vercel)
1. Set the API URL in `apps/web/vercel.json` (rewrite destination).
2. `cd apps/web && npx vercel --prod` (project root `apps/web`; the build reads `../../ml/evaluation` for the research figure).

Production start-up refuses weak `JWT_SECRET`, a missing `DATABASE_URL` and localhost URLs. Never commit `.env*` files.

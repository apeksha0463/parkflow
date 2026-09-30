# ParkFlow — Melbourne Parking Intelligence

**Forecast parking-pressure spillover across neighbouring parking zones.**

ParkFlow replays the City of Melbourne's 2019 on-street parking-sensor records, detects saturation events with the
research definition, and uses two trained models (temporal-only and spatial-temporal) to forecast occupancy of the
neighbouring blocks at 5–30 minutes. It warns where parking pressure is predicted to rise and ranks alternatives.

> Everything shown is **historical replay** of recorded sensor data (the research test period), never live availability.
> Predictions are estimates ("predicted occupancy"), not facts. We study parking-pressure propagation after saturation,
> not individual driver movements.

## Pages

| Route | Page |
|---|---|
| `/` | **Overview** — headline figures and zone pressure at the replay time, all from the API |
| `/map` | **Parking Map** — search any Melbourne place, sensor zones in view / nearest, zone details, forecasts, neighbours |
| `/spillover` | **Spillover Intelligence** — Research Demo, previous/next saturation event, forecasts, affected neighbours, warnings, alternatives, predicted vs actual, event history |
| `/research` | **Research & Models** — question, methodology, Model A vs B vs baselines from `results.json`, findings, limitations |

The dark bar under the header is the shared **server replay clock** (play/pause, ±5 min, ±1 h, speed, jump to a time).

## Repository layout

| Path | Purpose |
|---|---|
| `apps/web` | React + Vite + TypeScript frontend (Tailwind, Leaflet/OSM, Recharts) |
| `apps/api` | Node/Express + TypeScript REST API (Prisma, PostgreSQL + PostGIS) |
| `ml/` | Python ML pipeline (`parkflow_ml`) and FastAPI prediction service (`service`) |
| `data/raw`, `data/processed` | Research data (raw data and large processed files are **not** committed — see DATASET.md) |

## Quick start (local)

Prerequisites: Node 24+, Python 3.13, Docker Desktop, and the processed research data (see below).

```bash
cp .env.example .env            # then edit values
npm install
npm run db:up                   # PostGIS in Docker
npm run db:migrate -w apps/api
npm run db:seed -w apps/api     # admin account
npm run db:seed:melbourne -w apps/api   # Melbourne zones, recorded occupancy, neighbours, saturation events (~2 min)

cd ml
py -3.13 -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt   # Windows
.venv/Scripts/python -m uvicorn service.app:app --port 8000
cd ..
npm run dev:api                 # http://localhost:4000/health
npm run dev:web                 # http://localhost:5173
```

### Research pipeline and replay data

```bash
cd ml
# ~720 MB download, ~1 h end to end on a laptop; see DATASET.md and ML_PIPELINE.md
.venv/Scripts/python -m parkflow_ml.download
.venv/Scripts/python -m parkflow_ml.ingest
.venv/Scripts/python -m parkflow_ml.occupancy
.venv/Scripts/python -m parkflow_ml.geo
.venv/Scripts/python -m parkflow_ml.train     # models -> ml/artifacts, results -> ml/evaluation
.venv/Scripts/python -m parkflow_ml.plots
.venv/Scripts/python -m parkflow_ml.replay    # data/processed/replay_melbourne.json (test split, for the product)
```

`replay.py` only re-exports the pipeline's processed outputs: every modelled block with data in the test split, its
coordinates and street description, its research neighbours (200 m) and the research-defined saturation events.

## Tests

```bash
npm test                        # API + web
npm run build && npm run lint
cd ml && .venv/Scripts/python -m pytest -q
```

See ARCHITECTURE.md, API.md, DATASET.md, ML_PIPELINE.md, RESEARCH.md and TESTING.md.

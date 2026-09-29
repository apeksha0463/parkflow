# ParkFlow

**Know where to park before you arrive.**

ParkFlow is a Bengaluru-wide parking discovery platform with an event-based spatial-temporal
parking-spillover forecasting component. It answers two questions:

- *Where is parking available now?* — where a legitimate availability source exists.
- *Where is parking pressure likely to increase next?* — short-term occupancy forecasts after nearby saturation events.

> Predictions are estimates, not facts. Availability is shown only when a real source exists;
> otherwise the app says so. Simulated/demo data is always labelled.

## Repository layout

| Path | Purpose |
|---|---|
| `apps/web` | React + Vite + TypeScript frontend (Tailwind, Leaflet/OSM) |
| `apps/api` | Node/Express + TypeScript REST API (Prisma, PostgreSQL + PostGIS) |
| `ml/` | Python ML pipeline (`parkflow_ml`) and FastAPI prediction service (`service`) |
| `data/raw`, `data/processed` | Research datasets (raw data is **not** committed — see DATASET.md) |
| `docs/` | Supporting documentation |

## Quick start (local)

Prerequisites: Node 24+, Python 3.13, Docker Desktop.

```bash
cp .env.example .env            # then edit values
npm install
npm run db:up                   # PostGIS in Docker
npm run dev:api                 # http://localhost:4000/health
npm run dev:web                 # http://localhost:5173

cd ml
py -3.13 -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt   # Windows
.venv/Scripts/python -m uvicorn service.app:app --reload --port 8000
```

### Research pipeline and simulation demo

```bash
cd ml
# ~720 MB download, ~1 h end to end on a laptop; see DATASET.md and ML_PIPELINE.md
.venv/Scripts/python -m parkflow_ml.download
.venv/Scripts/python -m parkflow_ml.ingest
.venv/Scripts/python -m parkflow_ml.occupancy
.venv/Scripts/python -m parkflow_ml.geo
.venv/Scripts/python -m parkflow_ml.train     # models -> ml/artifacts, results -> ml/evaluation
.venv/Scripts/python -m parkflow_ml.plots
.venv/Scripts/python -m parkflow_ml.replay    # test-period replay data for the demo
cd ..
npm run db:seed -w apps/api
npm run import:osm -w apps/api
npm run db:seed:simulation -w apps/api        # labelled demo zones around Koramangala
```

With the ML service running, the API replays the demo zones (Simulation Mode) and serves real model predictions for them.
Every other facility shows "Prediction unavailable — insufficient historical data."

## Tests

```bash
npm test                        # API + web
cd ml && .venv/Scripts/python -m pytest -q
```

See ARCHITECTURE.md, API.md, DATASET.md, ML_PIPELINE.md and RESEARCH.md (TESTING.md and DEPLOYMENT.md land with their milestones).

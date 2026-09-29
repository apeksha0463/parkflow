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

## Tests

```bash
npm test                        # API + web
cd ml && .venv/Scripts/python -m pytest -q
```

See ARCHITECTURE.md, and (as milestones land) DATASET.md, ML_PIPELINE.md, API.md, TESTING.md, DEPLOYMENT.md, RESEARCH.md.

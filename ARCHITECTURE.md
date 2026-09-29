# Architecture

```
Browser (React SPA, Leaflet/OSM)
      │ HTTPS (cookie JWT)
      ▼
Node/Express API ───────────► PostgreSQL + PostGIS
      │ HTTP (internal)
      ▼
Python FastAPI ML service ──► versioned model artifacts (joblib + registry.json)
```

## Data layers (kept strictly separate)
1. **City parking directory** — Bengaluru facilities (OpenStreetMap-derived, source-attributed).
2. **Live availability** — only from real providers via a pluggable provider interface. None connected by default.
3. **Historical research data** — public parking-occupancy dataset used for the ML experiment (not Bengaluru).
4. **Predictions** — model outputs, stored with model version for predicted-vs-actual evaluation.
5. **Demo / simulation** — historical-replay data on clearly labelled demo facilities.

## Key decisions
- **PostGIS** for radius search, nearest-neighbour and neighbour identification (GiST indexes).
- **ML isolated** in a Python service; models are trained offline and loaded from artifacts — never retrained per request.
- **Auth**: JWT in httpOnly, SameSite cookies; bcrypt password hashes; roles `USER` / `ADMIN`.
- **Geocoding**: Nominatim (OSM) bounded to Bengaluru, cached and throttled per its usage policy.

Sections on the data model, neighbour identification and prediction flow are added as those milestones land.

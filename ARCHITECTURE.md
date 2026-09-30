# Architecture

```
Browser (React SPA, Leaflet/OSM, Recharts)
      │ HTTPS (same origin /api)
      ▼
Node/Express API ───────────► PostgreSQL + PostGIS
      │ HTTP (internal)          (Melbourne zones, recorded occupancy, research neighbours,
      ▼                           saturation events, stored predictions, replay clock)
Python FastAPI ML service ──► versioned model artifacts (joblib + registry.json), results.json, dataset reports
```

Every value in the UI flows **dataset → API/ML service → React state → UI**. The frontend contains no zone, occupancy,
prediction, event or metric values.

## Data layers
1. **Sensor zones** — City of Melbourne street blocks (research zones with data in the test split), at their real
   coordinates, with the street description from the source (or the block key when there is none).
2. **Recorded occupancy** — every 5-minute value of the 2019 test split (+7 days of model-input history), stored with
   its real timestamp and `sourceType = HISTORICAL_DATA`. Unknown values stay absent; nothing is interpolated.
3. **Research neighbours** — the pipeline's 200 m neighbour pairs (`ZoneNeighbour`), exactly those the spatial-temporal
   model was trained with.
4. **Saturation events** — the research-defined events of the test split (saturated after ≥ 30 min known and below 90%).
5. **Predictions** — ML-service outputs, stored with model version and base time; reused, and compared with recorded values.

## Historical replay
- `ml/parkflow_ml/replay.py` exports the above to `data/processed/replay_melbourne.json` (no change to the research
  pipeline). `npm run db:seed:melbourne -w apps/api` loads it and removes anything else.
- A single **server replay clock** (`services/replay.ts`, stored in `SystemConfig`) maps wall time to a 2019 instant in
  the test split: `replayAt + (now − anchor) × speed`, wrapping at the end, floored to the 5-minute grid.
  `GET/POST /api/replay` reads, seeks, plays/pauses and sets the speed. Every "current" value (availability, pressure,
  active event, predictions, spillover) is computed at the replay instant.
- The UI labels all of it **Historical replay** and never calls it live.

## Key decisions
- **PostGIS** for radius/bbox search; neighbour relations come from the research pairs, not a new radius.
- **ML isolated** in a Python service; models are trained offline and loaded from artifacts — never retrained per request.
- **Model time features** use Melbourne wall-clock time of the base instant, as in training.
- **Geocoding**: Nominatim bounded to Greater Melbourne (`countrycodes=au`), cached and throttled per its usage policy;
  results are ordered by distance to the monitored zones (centre computed from the data). Typing suggests matching zones.

## Prediction flow
```
UI --GET /api/parking/:id/predictions--> Node API (at the replay instant)
  Node: no replay source / no snapshot / stale --> status + honest message (ML not called)
  Node: 5-min histories (1 week) of the zone + its research neighbours within the model radius
        --POST /predict--> FastAPI: build_features (same code as training) -> HGB models -> occupancy per horizon
  Node: stores Prediction rows (model version, base time, horizon) -> response
```
- **Spillover** (`services/spillover.ts`): neighbours' current occupancy and 15-minute predictions. A neighbour whose
  predicted occupancy is ≥ the high-pressure threshold and above its current value gets a hedged warning.
  Alternatives: neighbours with a current reading, below saturation now and predicted, not warned; ranked by
  predicted occupancy + 0.1 × distance in km.
- **Predicted vs actual** (`predictedVsActual`): for each 5-minute base time in a window (≤ 3 h), every registered
  model's prediction next to the recorded value at the target time and the persistence baseline. Missing readings stay null.
- Verified: for 40 research samples (`ml/evaluation/actual_vs_predicted_sample.csv`), the API's 15-minute predictions
  match the research outputs to a mean absolute difference of 0.0009 occupancy (max 0.0056). The residual comes from the
  neighbour set: 8 research zones have no test-split data and are not exported.

## Data model (apps/api/prisma/schema.prisma)
- **ParkingFacility** (one per block, `availabilityMode = REPLAY`) → **ParkingZone** (`SEGMENT`, `replaySourceZone` = block key).
- **ZoneNeighbour**, **OccupancySnapshot**, **SaturationEvent**, **Prediction**, **ModelVersion**, **DataSource**, **SystemConfig**.
- Accounts (**User**, **AuditLog**) remain for the admin settings; the product pages need no sign-in.

## Security model
- bcrypt password hashes; JWT in `httpOnly` cookie with server-side revocation; CSRF header + CORS allow-list; Helmet,
  rate limiting, zod validation, parameterised queries. Production start-up refuses weak secrets or localhost URLs.
- The replay clock is shared by all viewers of a deployment (a research demo setting, not per-user state).

## Web
- **Pages:** Overview, Parking Map, Spillover Intelligence, Research & Models (`src/pages`). Shared: `AppShell`
  (navigation, mobile menu, replay bar), `ZoneMap` (Leaflet circle markers coloured by pressure, links to neighbours /
  warned zones / alternatives), `ZoneParts` (occupancy readout, forecast strip, zone card), `PredictedVsActualChart`.
- Queries include the replay instant in their keys, so everything refetches when the clock moves.
- Pressure colours are semantic tokens (`index.css`, mirrored in `lib/pressure.ts`); thresholds come from `/api/config`.

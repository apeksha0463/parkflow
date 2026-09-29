# Testing

```bash
npm run db:up                                   # API tests need PostGIS; they use an isolated <db>_test database
npm test                                        # API (vitest + supertest) then web (vitest + Testing Library)
npm run build && npm run lint
cd ml && .venv/Scripts/python -m pytest -q      # ML pipeline + ML service
```

## What is covered

**ML (`ml/tests`)** uses small hand-built inputs where the correct answer is known. It never uses the research data, so tests stay fast and deterministic.
- **Ingest:** timestamp parsing; every removal reason is counted (missing fields, bad time, non-positive duration, out of range, invalid flag); zone keys treat the cross streets as unordered.
- **Occupancy:** overlap clipping; half-open grid coverage; occupied/observed counts and the ratio; occupancy is unknown (not vacant) when no sensor reports or fewer than 4 bays report.
- **Neighbours:** street-name normalisation and segment parsing; zone location from matched bays, with unmatched zones left unknown; haversine distance; neighbours are found by distance (not ID) and are symmetric.
- **Saturation:** state thresholds; configurable threshold; an onset needs a known prior below the threshold; the default 30-minute debounce ignores flicker.
- **Features and leakage:** temporal features match hand calculations; unknown history stays NaN; spatial features use actual neighbours; the recent-onset count works; **features are unchanged when every value after k is altered**; targets come from k + h and are unknown past the grid end.
- **Service:** `/health` without models; `/predict` returns 503 without a model; only trained horizons, in [0, 1], with no confidence field; the temporal model ignores neighbours; short or unknown history is refused with 422; out-of-range input is rejected.

**API (`apps/api/src/**/*.test.ts`)** runs against a real PostGIS test database. The ML service is replaced by a local HTTP stub that checks request plumbing, not accuracy.
- **Existing coverage:** auth, roles, admin settings and audit, parking list/map/detail/neighbours, geocoding, stats.
- **Predictions:**
  - directory-only facilities → "insufficient historical data", without calling ML
  - no snapshots → insufficient data; old snapshots → stale
  - ML down → "temporarily unavailable" while discovery still works
  - correct history grid and neighbour selection within the model radius
  - predictions are stored and reused
- **Evaluation:** actual occupancy and absolute error are filled once the target time is observed.
- **Grid histories:** the latest snapshot per 5-minute instant is used; gaps stay null.
- **Spillover:**
  - an event is recorded; the warning uses hedged wording; alternatives come with reasons
  - re-saturation within 30 minutes is the same event; future-dated snapshots are ignored
  - ranking excludes closed, saturated and no-data facilities
- **Analytics:** degrades to `mlService: "unavailable"`; prediction errors are admin-only.

**Web (`apps/web/src/**/*.test.tsx`)** replaces Leaflet with a stand-in map that exposes the centre, zoom, markers and viewport callbacks.
- **Search and map:** search geocodes and moves the map (centre + zoom) and loads nearby parking; markers render; a marker click opens a preview with prediction, details and directions to the facility's coordinates.
- **List ↔ map:** a result click flies the map to the facility and highlights it.
- **Search this area:** appears after a pan and queries the visible bounds without moving the map.
- **Location:** "Use my location" works when permission is granted; a denial shows a message and keeps the search.
- **Predictions and spillover:** facilities without a source never request predictions; "temporarily unavailable" when ML is down; the spillover warning appears only in a saturation context.
- **Existing coverage:** routing, 404, unavailable availability, empty/error states, auth, facility page.

## Not automated
- **Real map rendering** (Leaflet tiles, clustering, fly animation) is verified manually in the browser. jsdom has no layout engine.
- **Full-dataset runs** (`python -m parkflow_ml.train`) are too heavy for CI. Their outputs are committed as report files (`data/processed/*_report.json`, `ml/evaluation/results.*`).

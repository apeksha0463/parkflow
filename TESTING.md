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
- **Existing coverage:** auth, roles, admin settings and audit, parking list/map/detail, stats.
- **Replay clock:** not configured without a loaded replay; seeks are limited to the replay range; every current value follows the clock.
- **Neighbours:** come from the research neighbour pairs, nearest first; the model radius is applied.
- **Predictions:** no source → insufficient data without calling ML; stale data; ML down → "temporarily unavailable"; the model is never applied to (or fed by) a non-replay source; histories and neighbours sent to the model; predictions stored and reused.
- **Spillover:** active event at the replay time; hedged warning text; warned zones never recommended; alternatives explained; ranking excludes closed, saturated and no-data zones.
- **Events:** active only between start and end; next/previous navigation, with and without the neighbours filter; 404.
- **Predicted vs actual:** both models per base time with the recorded outcome and persistence; missing actuals are null; cached; window limits.
- **Search:** zone suggestions without the geocoder; geocoder bounded to Melbourne (`countrycodes=au`); nearest-to-zones ordering; graceful degradation.
- **Analytics:** degrades to `mlService: "unavailable"`; prediction errors are admin-only.

**Web (`apps/web/src/**/*.test.tsx`)** replaces Leaflet with a stand-in map that exposes zones, selection, fly target and highlights. Fixtures live in the tests only.
- **Overview:** figures and replay time come from the API; replay controls post to the server clock; mobile menu; 404.
- **Parking map:** zones in view with replayed occupancy and API forecasts, readings first, compact rows for zones without a reading; selecting a zone shows details, threshold, forecast, neighbours and directions; searching a place lists the nearest zones.
- **Spillover:** Research Demo loads a real event from the API and seeks the replay; warnings and alternatives are rendered exactly as returned; warned zones are highlighted and not recommended; predicted vs actual with missing actuals; event history opens events.
- **Research:** figures from `results.json` and the dataset reports; findings are derived from the data and change when the data changes; no metrics when the evaluation is unavailable.
- **Auth:** login errors and registration validation.

**End-to-end (manual, real Chrome):** see the verification section of the final report; covers search for arbitrary Melbourne places, map pan/zoom and Search this area, three zones, several saturation events, warnings, alternatives, predicted vs actual, replay changes and mobile width.

## Not automated
- **Real map rendering** (Leaflet tiles, markers, fly animation) is verified in Chrome. jsdom has no layout engine.
- **Full-dataset runs** (`python -m parkflow_ml.train`) are too heavy for CI. Their outputs are committed as report files (`data/processed/*_report.json`, `ml/evaluation/results.*`).

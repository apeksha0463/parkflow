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
3. **Historical research data** — City of Melbourne on-street sensors 2019 (DATASET.md), used only for the ML experiment (not Bengaluru).
4. **Predictions** — model outputs, stored with model version for predicted-vs-actual evaluation.
5. **Demo / simulation** — historical-replay data on clearly labelled demo facilities.

## Key decisions
- **PostGIS** for radius search, nearest-neighbour and neighbour identification (GiST indexes).
- **ML isolated** in a Python service; models are trained offline and loaded from artifacts — never retrained per request.
- **Auth**: JWT in httpOnly, SameSite cookies; bcrypt password hashes; roles `USER` / `ADMIN`.
- **Geocoding**: Nominatim (OSM) bounded to Bengaluru, cached and throttled per its usage policy.


## Data model (apps/api/prisma/schema.prisma)
- **ParkingFacility**: what users search for. Unknown attributes (capacity, pricing, hours, EV) are `NULL`. `availabilityMode` is `NONE | LIVE | SIMULATION`; `isDemo` marks demo facilities. Linked to a **DataSource** (type, URL, licence, last verified).
- **ParkingZone**: the unit whose occupancy is tracked/predicted. `WHOLE_FACILITY` for simple lots, `LEVEL` per floor, `SEGMENT` for on-street stretches, `AREA` for large sites. Avoids separate level/segment tables.
- **OccupancySnapshot** (zone, observedAt, counts, occupancy, sourceType), **SaturationEvent**, **Prediction** (with `actualOccupancy`/`absError` filled in later), **ModelVersion** (metrics copied from the real evaluation run).
- **Booking** (platform reservations only), **SavedParking**, **RecentSearch**, **AuditLog**, **SystemConfig** (admin settings).
- PostGIS `geography(Point,4326)` columns on facilities and zones are maintained by triggers from lat/lng and GiST-indexed. CHECK constraints guard coordinates, capacities, occupancy, horizons and booking time order.

## Security model
- bcrypt (12 rounds) password hashes; timing-equalised login; generic credential errors.
- JWT (HS256) in `httpOnly` cookie; `tokenVersion` enables server-side revocation on logout/password change.
- CSRF: custom-header requirement + CORS allow-list. Helmet headers, rate limiting, zod validation on all inputs, Prisma parameterised queries.
- Production start-up refuses weak secrets, missing DB URL, or localhost URLs.

## Prediction flow
```
Explore / Facility page --GET /api/parking/:id/predictions--> Node API
  Node: availabilityMode NONE / no snapshot / stale --> status + honest message (ML not called)
  Node: 5-min histories (1 week) of the zone + neighbours within the model's radius (PostGIS ST_DWithin on zones)
        --POST /predict--> FastAPI: build_features (same code as training) -> HGB models (joblib) -> occupancy per horizon
  Node: stores Prediction rows (model version, base time, horizon, isSimulated) -> response
  Later: evaluateDuePredictions() fills actualOccupancy / absError from snapshots at targetTime
```
- **Saturation state and events** (`services/spillover.ts`) are derived from the latest snapshot of each zone, using the admin thresholds. Spillover analysis combines neighbours' current availability with their predictions.
- **Neighbour radii:**
  - The *model's* neighbour radius is fixed by training (200 m) and read from model metadata.
  - The *admin* `neighbourRadiusMeters` controls the "nearby / alternatives" lists.

## Simulation mode (historical replay)
- `ml/parkflow_ml/replay.py` exports a cluster of Melbourne blocks from the **test period** only. It picks the block with the most test-period saturation events, plus its nearest neighbours.
- `npm run db:seed:simulation -w apps/api` creates clearly labelled demo facilities (`isDemo`, `availabilityMode = SIMULATION`, "Simulation demo N") around a real Bengaluru locality (default Koramangala). They keep the cluster's real relative spacing, so neighbour distances match training.
- On start-up the API (`services/replay.ts`) backfills one week of snapshots and then writes one every 5 minutes. The value comes from the same weekday and time of day, cycling through the exported weeks, with `sourceType = SIMULATION`.
- The UI marks the markers as dashed and shows "Simulation Mode — historical parking data replay". Real OSM facilities never receive simulated data.

## Map and search architecture (web)
- **Map:** Leaflet with OSM/CARTO tiles, starting on the Bengaluru view and clustered with `react-leaflet-cluster`. Markers come from `GET /api/parking/map?bbox=` for the visible viewport, with the bbox rounded so small pans reuse the cache. Marker colour = current availability state; dashed = demo.
- **Search:** debounced geocoder suggestions (`/api/search/geocode`, Nominatim bounded to Bengaluru). Choosing a result sets `lat/lng/label` in the URL; the map flies there, zooms by radius and the list loads `/api/parking?lat&lng&radius` (paginated).
- **Search this area:** appears after the view moves more than 25% away from the list's centre (zoom ≥ 13). It lists facilities inside the visible bounds (`bbox`) without moving the map.
- **Use my location:** browser geolocation. If permission is denied or unavailable, a message appears and the current search stays.
- **List ↔ map:** clicking a result flies to it, highlights its marker and opens the preview. Clicking a marker highlights and scrolls to the card and opens the preview. The preview shows prediction, spillover warning, details and OSM directions to the recorded coordinates.

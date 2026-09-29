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

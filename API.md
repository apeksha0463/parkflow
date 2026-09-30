# ParkFlow REST API

Base URL: `${VITE_API_URL}` (e.g. `https://api.example.com`). All JSON.

## Conventions
- **Auth**: session JWT in an `httpOnly` cookie `pf_session` (12h). Send requests with credentials.
- **CSRF**: every non-GET request under `/api` must include `X-Requested-With: ParkFlow`, otherwise `403 CSRF_REJECTED`.
- **Errors**: `{ "error": { "code": string, "message": string, "details"?: object } }`. Stack traces are never returned.
  Common codes: `VALIDATION_ERROR` (400), `BAD_JSON` (400), `UNAUTHENTICATED` / `SESSION_EXPIRED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `RATE_LIMITED` (429), `INTERNAL_ERROR` (500).
- **Pagination**: `?page=1&pageSize=25` → `{ items, page, pageSize, total }`.
- **Rate limits**: 300 req/min per IP on `/api`; 20 per 15 min on register/login.

## System
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | – | `200 {status:"ok", database:"up"}` or `503 {status:"degraded", database:"down"}` |
| GET | `/api/config` | – | Public thresholds: `saturationThreshold`, `approachingThreshold`, `staleAfterMinutes` |

## Auth
| Method | Path | Auth | Body / notes |
|---|---|---|---|
| POST | `/api/auth/register` | – | `{name, email, password(≥8)}` → `201 {user}`. Always role `USER`. `409 EMAIL_IN_USE` |
| POST | `/api/auth/login` | – | `{email, password}` → `{user}`. `401 INVALID_CREDENTIALS` (same response for unknown email) |
| POST | `/api/auth/logout` | user | `204`. Revokes all outstanding sessions for the user |
| GET | `/api/auth/me` | user | `{user}` |
| PATCH | `/api/auth/me` | user | `{name?, currentPassword?, newPassword?}`; password change revokes other sessions |

## Admin (role `ADMIN`)
| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/settings` | `{settings}` — `saturationThreshold` (0.9), `approachingThreshold` (0.8), `neighbourRadiusMeters` (200; not used for model neighbours), `staleAfterMinutes` (30) |
| PATCH | `/api/admin/settings` | Partial update; validated (`approaching < saturation`), audited |
| GET | `/api/admin/audit-logs` | `?page&pageSize&entityType&action` (action is a prefix match) |

## Replay clock
| Method | Path | Description |
|---|---|---|
| GET | `/api/replay` | `{mode: "HISTORICAL_REPLAY" \| "NOT_CONFIGURED", now, playing, speed, stepMinutes, range: {start, end, timezone, dataset}}`. `now` is the recorded instant every current value refers to. |
| POST | `/api/replay` | `{at?, playing?, speed? (1–600)}`. `at` must lie within `range` (`400`); `409 REPLAY_NOT_CONFIGURED` without a loaded replay. Shared by all viewers. |

## Overview
| Method | Path | Description |
|---|---|---|
| GET | `/api/stats` | Counts from the database (`zones`, `zonesWithNeighbours`, `neighbourRelations`, `saturationEvents`), zone `bounds`, replay range, active model (`horizonsMinutes`, `neighbourRadiusMeters`, status — `unavailable` when the ML service is down) and `sources`. |

## Search
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/search/geocode?q=&mode=suggest` | – | Sensor zones whose street description or area matches. Never calls external services. |
| GET | `/api/search/geocode?q=&mode=full` | – | Nominatim bounded to Greater Melbourne (`countrycodes=au`), ordered by distance to the monitored zones, then matching zones. Call on explicit submit only. `geocoder`: `ok` / `unavailable` (falls back to zones). 20/min per IP. |
| POST | `/api/search/recent` | user | `{query, latitude, longitude}`; keeps the last 20 |
| GET | `/api/search/recent` | user | Last 10 searches |

Result item: `{ id, label, sublabel, latitude, longitude, kind: 'zone' | 'place', source }` (`zone:<facilityId>` ids for zones).

## Sensor zones
All values are at the replay clock (`at` in responses).

| Method | Path | Description |
|---|---|---|
| GET | `/api/parking` | List/search. Location: `lat&lng&radius` (100–10000 m) or `bbox=w,s,e,n`. Filters: `q`, `hasAvailability`. `sort=distance\|name\|capacity\|availability`. Paginated. |
| GET | `/api/parking/map?bbox=w,s,e,n` | Compact zones `{id, displayName, latitude, longitude, availabilityState, occupancy, available, capacity, pressureLevel}` |
| GET | `/api/parking/:id` | Zone detail (`zones[].blockKey` = City of Melbourne block key) |
| GET | `/api/parking/:id/neighbours?limit=` | Research neighbour pairs (block centroids within the model's 200 m radius), nearest first |
| GET | `/api/parking/:id/occupancy?hours=24` | Recorded occupancy up to the replay time (1–168 h) |
| GET | `/api/parking/:id/predictions` | Predicted occupancy per horizon (below). Always 200 with a `status`. |

### Zone object (abridged)
```jsonc
{
  "id": "…", "name": "<street description from the source>", "externalId": "melbourne:<block key>", "area": "<source area>",
  "latitude": -37.8, "longitude": 144.9, "capacity": 14,            // capacity = sensors on the block
  "availabilityMode": "REPLAY", "pressureLevel": "SATURATED",
  "availability": { "state": "REPLAY", "message": "Historical replay — recorded sensor data.", "occupied": 11, "available": 1, "capacity": 12, "occupancy": 0.917, "observedAt": "…", "ageMinutes": 0 },
  "source": { "name": "City of Melbourne on-street parking sensors (2019)", "sourceType": "HISTORICAL_DATA", "license": "CC BY 4.0 …" }
}
```
`availability.state`: `REPLAY` (recorded value at the replay time) · `LIVE` (real feed; none connected) · `STALE` (no reading for more than `staleAfterMinutes` before the replay time) · `HISTORICAL_ONLY` · `UNAVAILABLE` (no reading). `availability.capacity` is the number of bays reporting at that instant.

## Predictions
`GET /api/parking/:id/predictions` → `{status: AVAILABLE | INSUFFICIENT_DATA | NO_MODEL | STALE | SERVICE_UNAVAILABLE, message, provenance: "PREDICTED", model, zones: [{basedOn, currentOccupancy, currentState, neighboursUsed, predictions: [{horizonMinutes, targetTime, predictedOccupancy, pressureLevel}]}]}`.
- The ML service is called only for REPLAY zones with a recent reading; inputs are 1 week of 5-minute history of the zone and its research neighbours within the model radius, with the Melbourne wall-clock time.
- Predictions are stored and reused for the same base time. No confidence values are returned (none are computed).

## Spillover and events
| Method | Path | Description |
|---|---|---|
| GET | `/api/spillover/predictions?facilityId=` | At the replay time: `origin` (availability, pressure level, `activeSaturationEvent`, `predictions`), `spilloverContext` (origin at/near saturation), `neighbourRadiusMeters`, `warningHorizonMinutes`, `warnings` (research neighbours with predicted occupancy ≥ the high-pressure threshold and above current; hedged message), `alternatives` (not warned, below saturation now and predicted; ranked by predicted occupancy + 0.1 × km; each with `reason`), `neighbours`. |
| GET | `/api/spillover/events?facilityId=&from=&to=&withNeighbours=&page=&pageSize=` | Research-defined saturation events of the replayed period, newest first; `activeAtReplayTime` per event. |
| GET | `/api/spillover/events/adjacent?direction=next\|previous&from=&eventId=&facilityId=&withNeighbours=` | The event right after/before the reference (replay time by default); `{event: null}` at either end. |
| GET | `/api/spillover/events/:id` | One event |

## Analytics
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/analytics/model-performance` | — | `registry`, `offline` (the research evaluation `results.json`, unmodified), `dataset` (pipeline reports) and `online` (served predictions' MAE/RMSE). `mlService: "unavailable"` with nulls when the ML service is down. |
| GET | `/api/analytics/predicted-vs-actual?facilityId=&from=&to=` | — | Window ≤ 3 h. Per horizon and 5-minute base time: each registered model's prediction, the recorded `actual` at the target time (null when not recorded) and the `persistence` baseline. `status` `NO_MODEL` / `SERVICE_UNAVAILABLE` instead of values when not possible. |
| GET | `/api/analytics/prediction-errors?horizon=&page=&pageSize=` | admin | Individual served predictions with actual occupancy and absolute error |

## ML service (internal; the frontend never calls it)
| Method | Path | Description |
|---|---|---|
| GET | `/health` | `{status, modelsLoaded, activeModelVersion}` |
| GET | `/models` | `registry.json` as written by training (503 if absent) |
| GET | `/evaluation` | `ml/evaluation/results.json` (503 if absent) |
| GET | `/dataset` | Pipeline reports `data/processed/{ingest,occupancy,geo}_report.json` (503 if none) |
| POST | `/predict` | `{zoneId, timestamp (local wall clock), history[], observedBays, neighbours[{distanceM, history[]}], horizons?, model?, threshold?}` → predictions. `422 INSUFFICIENT_HISTORY` / `503 NO_MODEL` instead of guessing. |



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
| GET | `/api/admin/settings` | `{settings}` — `saturationThreshold` (0.9), `approachingThreshold` (0.8), `neighbourRadiusMeters` (800), `staleAfterMinutes` (30) |
| PATCH | `/api/admin/settings` | Partial update; validated (`approaching < saturation`), audited |
| GET | `/api/admin/audit-logs` | `?page&pageSize&entityType&action` (action is a prefix match) |

## Search
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/search/geocode?q=&mode=suggest` | – | Type-ahead from ParkFlow's locality index (OSM place names). Never calls external services. |
| GET | `/api/search/geocode?q=&mode=full` | – | Localities + Nominatim geocoding bounded to Bengaluru. Call on explicit submit only (Nominatim forbids autocomplete). `geocoder`: `ok` / `unavailable` (falls back to localities). 20/min per IP. |
| POST | `/api/search/recent` | user | `{query, latitude, longitude}`; keeps the last 20 |
| GET | `/api/search/recent` | user | Last 10 searches |

Result item: `{ id, label, sublabel, latitude, longitude, kind: 'locality' | 'place', source }`.

## Parking directory
| Method | Path | Description |
|---|---|---|
| GET | `/api/parking` | List/search. Location: `lat&lng&radius` (100–10000 m, default 2000), `bbox=w,s,e,n`, or `areaId`. Filters: `q`, `types=A,B`, `vehicleType`, `ev`, `free`, `openNow`, `hasAvailability`. `sort=distance\|name\|capacity\|availability`. Paginated. |
| GET | `/api/parking/map?bbox=w,s,e,n&types=` | Compact markers `{id, latitude, longitude, type, isDemo, availabilityState, occupancy}` for client-side clustering |
| GET | `/api/parking/:id` | Facility detail including zones |
| GET | `/api/parking/:id/neighbours?radius=&limit=` | Facilities within `radius` metres (default: admin `neighbourRadiusMeters`), nearest first |
| GET | `/api/areas/:id` | Locality |
| GET | `/api/areas/:id/parking` | Same as `/api/parking`, centred on the locality (default radius 1500 m) |

### Facility object (abridged)
```jsonc
{
  "id": "…", "name": null, "displayName": "Multi-level parking near Koramangala 6th Block", "nameIsDerived": true,
  "type": "MULTI_LEVEL", "typeLabel": "Multi-level", "distanceMeters": 502,
  "capacity": null, "pricingText": null, "isFree": null, "operatingHours": null, "openNow": null, // null = unknown
  "availabilityMode": "NONE", "isDemo": false,
  "availability": { "state": "UNAVAILABLE", "message": "Availability currently unavailable.", "available": null, "occupancy": null, "observedAt": null, "ageMinutes": null },
  "source": { "name": "OpenStreetMap", "sourceType": "VERIFIED_DIRECTORY", "license": "ODbL 1.0 …", "recordUrl": "https://www.openstreetmap.org/way/…", "lastVerifiedAt": "2026-06-01T08:52:28Z" }
}
```

`availability.state`:
- `LIVE`: real provider feed, fresh.
- `SIMULATED`: historical replay, fresh.
- `STALE`: older than `staleAfterMinutes`.
- `HISTORICAL_ONLY`: no current source; the numbers are historical.
- `UNAVAILABLE`: no data.

Spillover, prediction, analytics, booking and simulation endpoints are documented as they land.


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

Parking, spillover, analytics, bookings and simulation endpoints are documented as they land.

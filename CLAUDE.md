# CLAUDE.md — working notes for AI assistants

## Non-negotiable rules
- Never fabricate: live availability, predictions, metrics (MAE/RMSE/R²), dataset stats, citations, facilities.
- Unknown values are `null`/"Unknown" — never guessed. Every availability value carries source + freshness.
- Predictions use hedged language ("predicted occupancy", "estimated pressure"), never "will be full".
- We study parking-pressure propagation after saturation, NOT individual driver movements.
- Simulation/demo data is always labelled and never used in research evaluation.
- No localhost URLs in production config; never commit `.env` or secrets.

## Commands
- `npm test` (API + web), `npm run build`, `npm run lint`
- ML: `cd ml && .venv/Scripts/python -m pytest -q`
- DB: `npm run db:up` (Docker PostGIS)

## Conventions
- API: Express 5 + zod validation; errors via `HttpError`, JSON shape `{ error: { code, message, details? } }`.
- Web: status colours are semantic (`src/lib/status.ts`, tokens in `src/index.css`); use `ProvenanceBadge` for observed/predicted/simulated.
- Rolldown native bindings are pinned in root `optionalDependencies` (npm bug #4828) — keep versions in sync with `rolldown` when upgrading Vite.
- Work in milestones; run tests + build after each; commit per milestone.

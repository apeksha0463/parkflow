import { Link } from 'react-router-dom'
import { ArrowRight, Database } from 'lucide-react'
import { AppShell } from '../components/layout/AppShell'
import { buttonClass } from '../components/ui/Button'
import { PressureBadge } from '../components/ui/Badges'
import { ErrorState, Skeleton } from '../components/ui/primitives'
import { errorMessage } from '../lib/api'
import { cn } from '../lib/cn'
import { formatDate, formatInt, formatPercent } from '../lib/format'
import { useMapZones, useStats, useThresholds } from '../lib/hooks'
import { pressureFromLevel, type Pressure } from '../lib/pressure'

const WORKFLOW = [
  { title: 'Occupancy', text: 'Recorded bay-sensor occupancy per street block, every 5 minutes.' },
  { title: 'Saturation', text: 'A block crosses the saturation threshold after being below it for 30 minutes.' },
  { title: 'Neighbour pressure', text: 'Occupancy and recent change of the blocks around it.' },
  { title: 'Forecast', text: 'Temporal and spatial-temporal models predict occupancy ahead.' },
  { title: 'Spillover', text: 'Neighbours predicted to rise into high pressure are flagged.' },
  { title: 'Alternative', text: 'Nearby blocks with lower predicted occupancy are ranked.' },
]

function Metric({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="animate-fade-in border-l border-ink-100 px-5 py-1 first:border-l-0 max-sm:border-l-0 max-sm:px-0">
      <p className="text-2xs font-medium tracking-wide text-ink-500 uppercase">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold tracking-tight text-ink-900">{value}</p>
      {note && <p className="mt-0.5 text-xs text-ink-500">{note}</p>}
    </div>
  )
}

const BAR: Record<Pressure, string> = {
  saturated: 'bg-pressure-saturated',
  high: 'bg-pressure-high',
  moderate: 'bg-pressure-moderate',
  normal: 'bg-pressure-normal',
  unknown: 'bg-pressure-unknown',
}

function CurrentPressure() {
  const thresholds = useThresholds()
  const { zones } = useMapZones()
  if (!thresholds || !zones.data) return <Skeleton className="h-24" />
  const counts: Record<Pressure, number> = { normal: 0, moderate: 0, high: 0, saturated: 0, unknown: 0 }
  for (const z of zones.data.items) counts[pressureFromLevel(z.pressureLevel, z.occupancy, thresholds)]++
  const total = zones.data.items.length
  const order: Pressure[] = ['saturated', 'high', 'moderate', 'normal', 'unknown']
  return (
    <div>
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {order.map((p) =>
          counts[p] ? <span key={p} className={cn('h-full', BAR[p])} style={{ width: `${(counts[p] / total) * 100}%` }} /> : null,
        )}
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {order.map((p) => (
          <li key={p} className="flex items-center gap-1.5">
            <PressureBadge pressure={p} />
            <span className="tabular text-sm font-medium text-ink-800">{counts[p]}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-500">Zones by pressure at the current replay time (saturated ≥ {formatPercent(thresholds.saturation)}).</p>
    </div>
  )
}

export default function Overview() {
  const stats = useStats()
  const s = stats.data

  return (
    <AppShell>
      <section className="border-b border-ink-100 bg-white">
        <div className="mx-auto grid max-w-[1440px] gap-10 px-4 py-12 sm:px-6 md:py-16 lg:grid-cols-[1.25fr_1fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-data uppercase">Parking intelligence for Melbourne</p>
            <h1 className="mt-3 max-w-2xl text-3xl leading-tight font-semibold tracking-tight text-ink-900 md:text-5xl">
              Forecast parking-pressure spillover before neighbouring zones become saturated.
            </h1>
            <p className="mt-4 max-w-xl text-base text-ink-600">
              ParkFlow replays the City of Melbourne’s on-street sensor records, detects saturation events, and predicts how occupancy is expected to change in the surrounding blocks.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/map" className={buttonClass('primary', 'lg')}>
                Open Parking Map
              </Link>
              <Link to="/spillover" className={buttonClass('secondary', 'lg')}>
                Explore Spillover Intelligence <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-ink-100 bg-ink-25 p-5">
            <p className="text-sm font-semibold text-ink-900">Right now in the replay</p>
            <div className="mt-4">
              <CurrentPressure />
            </div>
            {s && (
              <div className="mt-5 flex items-start gap-2 border-t border-ink-100 pt-4 text-xs text-ink-600">
                <Database className="mt-0.5 size-3.5 shrink-0 text-data" />
                <p>
                  <span className="font-medium text-ink-800">Data source:</span> {s.sources.map((x) => x.name).join(', ') || '—'}
                  {s.replay.range && (
                    <>
                      <br />
                      <span className="font-medium text-ink-800">Mode:</span> Historical replay, {formatDate(s.replay.range.start)} – {formatDate(s.replay.range.end)} (research test period)
                    </>
                  )}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section aria-label="Key figures" className="border-b border-ink-100 bg-white">
        <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
          {stats.isError ? (
            <ErrorState message={errorMessage(stats.error)} onRetry={() => stats.refetch()} />
          ) : !s ? (
            <Skeleton className="h-16" />
          ) : (
            <div className="grid grid-cols-2 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
              <Metric label="Monitored zones" value={formatInt(s.zones)} note={`${formatInt(s.zonesWithNeighbours)} with neighbours`} />
              <Metric label="Saturation events" value={formatInt(s.saturationEvents)} note="in the replayed period" />
              <Metric label="Forecast horizons" value={s.model.horizonsMinutes ? s.model.horizonsMinutes.map((h) => `${h}`).join(' · ') : '—'} note="minutes ahead" />
              <Metric label="Neighbour radius" value={s.model.neighbourRadiusMeters != null ? `${s.model.neighbourRadiusMeters} m` : '—'} note="as used in training" />
              <Metric
                label="Model service"
                value={<span className={s.model.status === 'available' ? 'text-pressure-normal' : 'text-pressure-saturated'}>{s.model.status === 'available' ? 'Online' : 'Unavailable'}</span>}
                note={s.model.models.length ? `${s.model.models.length} trained models` : undefined}
              />
            </div>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-4 py-12 sm:px-6">
        <h2 className="text-xl font-semibold tracking-tight text-ink-900">How ParkFlow works</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-600">From recorded occupancy to a ranked alternative — each step runs on the replayed data through the API and the trained models.</p>
        <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {WORKFLOW.map((w, i) => (
            <li key={w.title} className="relative rounded-lg border border-ink-100 bg-white p-4 shadow-card">
              <span className="tabular text-2xs font-semibold text-ink-400">{String(i + 1).padStart(2, '0')}</span>
              <p className="mt-1 text-sm font-semibold text-ink-900">{w.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-600">{w.text}</p>
              {i < WORKFLOW.length - 1 && <ArrowRight className="absolute top-1/2 -right-3 z-10 hidden size-4 -translate-y-1/2 text-ink-300 lg:block" aria-hidden />}
            </li>
          ))}
        </ol>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <Link to="/spillover" className="group rounded-lg border border-ink-100 bg-white p-5 shadow-card hover:border-ink-300">
            <p className="text-sm font-semibold text-ink-900">Spillover Intelligence</p>
            <p className="mt-1 text-sm text-ink-600">Open a real saturation event, see forecasts for its neighbours, warnings, alternatives and predicted vs actual.</p>
            <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-600 group-hover:text-brand-700">
              Open <ArrowRight className="size-3.5" />
            </span>
          </Link>
          <Link to="/research" className="group rounded-lg border border-ink-100 bg-white p-5 shadow-card hover:border-ink-300">
            <p className="text-sm font-semibold text-ink-900">Research & Models</p>
            <p className="mt-1 text-sm text-ink-600">Does neighbouring occupancy improve short-term prediction after saturation? Methodology, metrics and limitations.</p>
            <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-600 group-hover:text-brand-700">
              Read <ArrowRight className="size-3.5" />
            </span>
          </Link>
        </div>
      </section>
    </AppShell>
  )
}

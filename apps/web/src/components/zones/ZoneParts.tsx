import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { formatPercent, formatTime } from '../../lib/format'
import { useReplay } from '../../lib/hooks'
import { PRESSURE_LABEL, pressureFromLevel, type Pressure, type Thresholds } from '../../lib/pressure'
import type { Availability, HorizonPrediction, PressureLevel, Zone, ZonePredictions } from '../../lib/types'
import { PressureBadge } from '../ui/Badges'
import { Skeleton } from '../ui/primitives'

/** Current replay instant, used in query keys so data refetches when the replay clock moves. */
export function useReplayNow(): string | null {
  return useReplay().data?.now ?? null
}

export function useZonePredictions(id: string | null | undefined, enabled = true) {
  const now = useReplayNow()
  return useQuery({
    queryKey: ['predictions', id, now],
    queryFn: () => api<ZonePredictions>(`/api/parking/${id}/predictions`),
    enabled: !!id && !!now && enabled,
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  })
}

const isCurrent = (a: Availability) => a.state === 'REPLAY' || a.state === 'LIVE'

export function zonePressure(a: Availability, level: PressureLevel | null, t: Thresholds): Pressure {
  return isCurrent(a) ? pressureFromLevel(level, a.occupancy, t) : 'unknown'
}

const PRESSURE_TEXT: Record<Pressure, string> = {
  normal: 'text-pressure-normal',
  moderate: 'text-pressure-moderate',
  high: 'text-pressure-high',
  saturated: 'text-pressure-saturated',
  unknown: 'text-pressure-unknown',
}

/** Occupancy headline: percentage, occupied / reporting spaces, available spaces. */
export function OccupancyReadout({ a, pressure, size = 'md' }: { a: Availability; pressure: Pressure; size?: 'md' | 'lg' }) {
  if (!isCurrent(a) || a.occupancy == null) {
    return <p className="text-sm text-ink-500">{a.message}</p>
  }
  return (
    <div className="flex items-end gap-4">
      <p className={cn('tabular font-semibold tracking-tight', PRESSURE_TEXT[pressure], size === 'lg' ? 'text-4xl' : 'text-2xl')}>
        {formatPercent(a.occupancy)}
        <span className="ml-1 text-xs font-medium text-ink-500">occupied</span>
      </p>
      {a.capacity != null && a.occupied != null && (
        <p className="tabular pb-1 text-sm text-ink-600">
          {a.occupied} / {a.capacity} reporting spaces
          {a.available != null && <span className="text-ink-500"> · {a.available} free</span>}
        </p>
      )}
    </div>
  )
}

/** Forecasts for every horizon the prediction API returns. Unavailable states are one short line. */
export function ForecastStrip({ q, thresholds, compact }: { q: ReturnType<typeof useZonePredictions>; thresholds: Thresholds; compact?: boolean }) {
  if (q.isPending) return <Skeleton className={compact ? 'h-10' : 'h-16'} />
  if (q.isError) return <p className="text-xs text-ink-500">Forecast unavailable — the API could not be reached.</p>
  if (q.data.status !== 'AVAILABLE') return <p className="text-xs text-ink-500">{q.data.message}</p>
  const preds: HorizonPrediction[] = q.data.zones[0]?.predictions ?? []
  return (
    <div>
      <div className={cn('grid gap-1.5', preds.length > 3 ? 'grid-cols-4' : 'grid-cols-3')}>
        {preds.map((p) => {
          const pr = pressureFromLevel(p.pressureLevel, p.predictedOccupancy, thresholds)
          return (
            <div key={p.horizonMinutes} className="rounded-md border border-predicted-bg bg-predicted-bg/50 px-2 py-1.5">
              <p className="text-2xs font-medium text-predicted">+{p.horizonMinutes} min</p>
              <p className={cn('tabular font-semibold text-ink-900', compact ? 'text-sm' : 'text-lg')}>{formatPercent(p.predictedOccupancy)}</p>
              {!compact && <p className={cn('text-2xs', PRESSURE_TEXT[pr])}>{PRESSURE_LABEL[pr]}</p>}
            </div>
          )
        })}
      </div>
      {!compact && q.data.zones[0] && (
        <p className="mt-1.5 text-2xs text-ink-500">
          Predicted occupancy · {q.data.model?.featureSet === 'spatial_temporal' ? 'spatial-temporal model' : 'temporal model'} · {q.data.zones[0].neighboursUsed} neighbour
          {q.data.zones[0].neighboursUsed === 1 ? '' : 's'} used · from {formatTime(q.data.zones[0].basedOn)}
        </p>
      )}
    </div>
  )
}

export function ZoneCard({ zone, thresholds, selected, onSelect }: { zone: Zone; thresholds: Thresholds; selected?: boolean; onSelect?: (id: string) => void }) {
  const hasReading = isCurrent(zone.availability) && zone.availability.occupancy != null
  const q = useZonePredictions(zone.id, hasReading)
  const pressure = zonePressure(zone.availability, zone.pressureLevel, thresholds)
  if (!hasReading) {
    // Compact row: nothing to forecast without a current reading.
    return (
      <article id={`zone-${zone.id}`} className={cn('rounded-lg border bg-white px-4 py-2.5', selected ? 'border-ink-900 ring-1 ring-ink-900' : 'border-ink-100')}>
        <button type="button" onClick={() => onSelect?.(zone.id)} className="flex w-full items-center justify-between gap-3 text-left" aria-label={`Show ${zone.displayName} on the map`}>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink-800">{zone.displayName}</span>
            <span className="block text-xs text-ink-500">No sensor reading at this replay time</span>
          </span>
          <PressureBadge pressure="unknown" />
        </button>
      </article>
    )
  }
  return (
    <article
      id={`zone-${zone.id}`}
      className={cn(
        'rounded-lg border bg-white p-4 transition-shadow',
        selected ? 'border-ink-900 shadow-pop ring-1 ring-ink-900' : 'border-ink-100 shadow-card hover:border-ink-200',
      )}
    >
      <button type="button" onClick={() => onSelect?.(zone.id)} className="block w-full text-left" aria-label={`Show ${zone.displayName} on the map`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm leading-snug font-semibold text-ink-900">{zone.displayName}</h3>
            <p className="mt-0.5 truncate text-xs text-ink-500">
              {[zone.area, zone.distanceMeters != null ? `${Math.round(zone.distanceMeters)} m away` : null].filter(Boolean).join(' · ')}
            </p>
          </div>
          <PressureBadge pressure={pressure} />
        </div>
        <div className="mt-3">
          <OccupancyReadout a={zone.availability} pressure={pressure} />
        </div>
      </button>
      <div className="mt-3">
        <p className="mb-1 text-2xs font-medium tracking-wide text-ink-500 uppercase">Forecast</p>
        <ForecastStrip q={q} thresholds={thresholds} compact />
      </div>
      <Link
        to={`/spillover?zone=${zone.id}`}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
      >
        View intelligence <ArrowRight className="size-3" />
      </Link>
    </article>
  )
}

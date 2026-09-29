import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, TrendingUp } from 'lucide-react'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { formatDistance, formatPercent } from '../../lib/format'
import type { Facility, FacilityPredictions, HorizonPrediction, PressureLevel, Spillover } from '../../lib/types'
import { NO_HISTORY_MESSAGE, predictionUnavailableReason } from '../../lib/provenance'
import { ProvenanceBadge } from '../ui/Badges'
import { Skeleton } from '../ui/primitives'

const NO_SOURCE_MESSAGE = NO_HISTORY_MESSAGE

export const PRESSURE_LABEL: Record<PressureLevel, string> = {
  NORMAL: 'Low pressure',
  APPROACHING_SATURATION: 'Approaching saturation',
  SATURATED: 'High pressure',
}
const pressureText: Record<PressureLevel, string> = {
  NORMAL: 'text-status-available',
  APPROACHING_SATURATION: 'text-status-nearly-full',
  SATURATED: 'text-status-full',
}

type HasSource = Pick<Facility, 'id' | 'availabilityMode'>

/**
 * Predictions are only requested for simulation (research) zones: the only trained model uses the Melbourne 2019
 * research dataset and is never applied to real Bengaluru facilities. Others are unavailable by definition.
 */
export function usePredictions(f: HasSource | undefined) {
  return useQuery({
    queryKey: ['predictions', f?.id],
    queryFn: ({ signal }) => api<FacilityPredictions>(`/api/parking/${f!.id}/predictions`, { signal }),
    enabled: !!f && f.availabilityMode === 'SIMULATION',
    staleTime: 60_000,
  })
}

export function useSpillover(f: HasSource | undefined) {
  return useQuery({
    queryKey: ['spillover', f?.id],
    queryFn: ({ signal }) => api<Spillover>('/api/spillover/predictions', { query: { facilityId: f!.id }, signal }),
    enabled: !!f && f.availabilityMode !== 'NONE',
    staleTime: 60_000,
  })
}

function pick(preds: HorizonPrediction[], minutes = 15) {
  return preds.find((p) => p.horizonMinutes === minutes) ?? preds.at(-1)
}

function Unavailable({ message, className }: { message: string; className?: string }) {
  return <p className={cn('text-xs text-ink-500', className)}>{message}</p>
}

/** One-line forecast for cards and the map preview. `badge={false}` when the caller shows the source itself. */
export function PredictionLine({ facility, className, badge = true }: { facility: HasSource; className?: string; badge?: boolean }) {
  const q = usePredictions(facility)
  if (facility.availabilityMode !== 'SIMULATION') return <Unavailable message={predictionUnavailableReason(facility)} className={className} />
  if (q.isPending) return <Skeleton className={cn('h-4 w-48', className)} />
  if (q.isError) return <Unavailable message="Prediction temporarily unavailable." className={className} />
  const d = q.data
  if (d.status !== 'AVAILABLE') return <Unavailable message={d.message ?? NO_SOURCE_MESSAGE} className={className} />
  const p = pick(d.zones[0].predictions)
  if (!p) return <Unavailable message={NO_SOURCE_MESSAGE} className={className} />
  return (
    <p className={cn('flex flex-wrap items-center gap-1.5 text-xs text-ink-700', className)}>
      {badge && <ProvenanceBadge kind="predicted" />}
      <TrendingUp className="size-3.5 text-status-predicted" aria-hidden />
      <span>
        Predicted occupancy <span className="tabular font-semibold">{formatPercent(p.predictedOccupancy)}</span> in {p.horizonMinutes} min
      </span>
      {p.pressureLevel && <span className={cn('font-medium', pressureText[p.pressureLevel])}>· {PRESSURE_LABEL[p.pressureLevel]}</span>}
    </p>
  )
}

/** Detail-page forecast: current value and every horizon the model supports. */
export function PredictionPanel({ facility }: { facility: HasSource }) {
  const q = usePredictions(facility)
  if (facility.availabilityMode !== 'SIMULATION') return <Unavailable message={predictionUnavailableReason(facility)} />
  if (q.isPending) return <Skeleton className="h-32 w-full" />
  if (q.isError) return <Unavailable message="Prediction temporarily unavailable." />
  const d = q.data
  if (d.status !== 'AVAILABLE') return <Unavailable message={d.message ?? NO_SOURCE_MESSAGE} />
  return (
    <div className="space-y-4">
      {d.zones.map((z) => (
        <div key={z.zoneId}>
          {d.zones.length > 1 && <p className="mb-2 text-xs font-semibold text-ink-700">{z.zoneName}</p>}
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div className="rounded-md border border-ink-100 bg-white p-3">
              <dt className="flex items-center gap-1.5 text-2xs font-medium tracking-wide text-ink-500 uppercase">
                Now <ProvenanceBadge kind={z.isSimulated ? 'simulated' : 'observed'} />
              </dt>
              <dd className="tabular mt-1 text-lg font-semibold text-ink-900">{formatPercent(z.currentOccupancy)}</dd>
            </div>
            {z.predictions.map((p) => (
              <div key={p.horizonMinutes} className="rounded-md border border-status-predicted-bg bg-status-predicted-bg/40 p-3">
                <dt className="text-2xs font-medium tracking-wide text-status-predicted uppercase">+{p.horizonMinutes} min</dt>
                <dd className="tabular mt-1 text-lg font-semibold text-ink-900">{formatPercent(p.predictedOccupancy)}</dd>
                {p.pressureLevel && <dd className={cn('text-2xs font-medium', pressureText[p.pressureLevel])}>{PRESSURE_LABEL[p.pressureLevel]}</dd>}
              </div>
            ))}
          </dl>
        </div>
      ))}
      {d.model && (
        <p className="text-xs leading-relaxed text-ink-500">
          Predicted occupancy from model <span className="font-mono">{d.model.id}</span> ({d.model.featureSet === 'spatial_temporal' ? 'uses this zone and neighbouring zones' : 'uses this zone only'}), trained on{' '}
          {d.model.trainingDataset}. A forecast, not a guarantee.
          {d.zones.some((z) => z.isSimulated) && ' Inputs are simulated (historical replay), not live sensor data.'}
        </p>
      )}
    </div>
  )
}

/** Warnings about predicted pressure nearby, plus ranked alternatives with the reason for each. */
export function SpilloverPanel({ facility, compact = false }: { facility: HasSource; compact?: boolean }) {
  const q = useSpillover(facility)
  if (facility.availabilityMode === 'NONE') return compact ? null : <Unavailable message="Spillover analysis needs occupancy data for this facility." />
  if (q.isPending) return compact ? null : <Skeleton className="h-24 w-full" />
  if (q.isError) return compact ? null : <Unavailable message="Spillover analysis temporarily unavailable." />
  const s = q.data
  const showWarnings = s.warnings.length > 0
  if (compact && !s.spilloverContext && !showWarnings) return null
  return (
    <div className="space-y-3">
      {s.spilloverContext && (
        <div role="status" className="flex gap-2 rounded-md border border-status-nearly-full-bg bg-status-nearly-full-bg px-3 py-2 text-xs text-ink-800">
          <AlertTriangle className="mt-px size-4 shrink-0 text-status-nearly-full" aria-hidden />
          <p>
            This zone is {s.origin.pressureLevel === 'SATURATED' ? 'at or above' : 'approaching'} the saturation threshold ({formatPercent(s.thresholds.saturation)}).
            {showWarnings ? ' Parking pressure is likely to increase in nearby zones.' : ' No nearby zone currently has a predicted pressure increase.'}
          </p>
        </div>
      )}
      {showWarnings && (
        <ul className="space-y-1.5">
          {s.warnings.map((w) => (
            <li key={w.facilityId} className="flex gap-2 text-xs text-ink-700">
              <ProvenanceBadge kind="predicted" className="shrink-0" />
              <span>{w.message}</span>
            </li>
          ))}
        </ul>
      )}
      {!compact && (
        <div>
          <h4 className="mb-2 text-xs font-semibold text-ink-800">Suggested alternatives within {formatDistance(s.neighbourRadiusMeters)}</h4>
          {s.alternatives.length === 0 ? (
            <Unavailable message="No nearby facility has current availability data to recommend." />
          ) : (
            <ul className="space-y-2">
              {s.alternatives.map((a) => (
                <li key={a.id} className="rounded-md border border-ink-100 bg-white p-3">
                  <Link to={`/parking/${a.id}`} className="flex items-center justify-between gap-2 text-sm font-medium text-ink-900 hover:text-brand-700">
                    {a.displayName} <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                  <p className="mt-1 text-xs text-ink-600">{a.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

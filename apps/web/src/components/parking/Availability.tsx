import { Clock, History, Radio, WifiOff } from 'lucide-react'
import { cn } from '../../lib/cn'
import { formatAge, formatPercent } from '../../lib/format'
import { statusFromOccupancy, type StatusThresholds } from '../../lib/status'
import type { Availability } from '../../lib/types'
import { ProvenanceBadge, StatusBadge } from '../ui/Badges'

/** Current availability is only "current" for LIVE or SIMULATED fresh data. */
export const isCurrent = (a: Availability) => a.state === 'LIVE' || a.state === 'SIMULATED'

const barColor: Record<string, string> = {
  available: 'bg-status-available',
  moderate: 'bg-status-moderate',
  nearly_full: 'bg-status-nearly-full',
  full: 'bg-status-full',
  unknown: 'bg-ink-300',
}

export function OccupancyBar({ occupancy, status, className }: { occupancy: number; status: string; className?: string }) {
  const pct = Math.min(100, Math.max(0, Math.round(occupancy * 100)))
  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-ink-100', className)}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label="Occupancy"
    >
      <div className={cn('h-full rounded-full transition-[width]', barColor[status])} style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Compact availability line for list cards. */
export function AvailabilityInline({ availability: a, thresholds }: { availability: Availability; thresholds?: StatusThresholds }) {
  if (isCurrent(a)) {
    const status = statusFromOccupancy(a.occupancy, { thresholds })
    return (
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <StatusBadge status={status} />
          {a.available != null && (
            <span className="tabular font-medium text-ink-800">
              {a.available} <span className="font-normal text-ink-500">spaces</span>
            </span>
          )}
          <span className="tabular text-ink-500">· {formatPercent(a.occupancy)} occupied</span>
          {a.state === 'SIMULATED' && <ProvenanceBadge kind="simulated" />}
        </div>
        {a.occupancy != null && <OccupancyBar occupancy={a.occupancy} status={status} />}
        <p className="flex items-center gap-1 text-xs text-ink-500">
          <Clock className="size-3" aria-hidden /> Updated {formatAge(a.ageMinutes)}
        </p>
      </div>
    )
  }
  const Icon = a.state === 'STALE' ? Clock : a.state === 'HISTORICAL_ONLY' ? History : WifiOff
  return (
    <p className="flex items-center gap-1.5 text-sm text-ink-500">
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {a.state === 'STALE' ? `Last reported ${formatAge(a.ageMinutes)} — may be out of date` : a.message}
    </p>
  )
}

/** Full availability panel for the facility page. */
export function AvailabilityPanel({ availability: a, thresholds }: { availability: Availability; thresholds?: StatusThresholds }) {
  const current = isCurrent(a)
  const status = statusFromOccupancy(current ? a.occupancy : null, { thresholds })
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-900">Current availability</h2>
        {a.state === 'LIVE' && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-status-available">
            <Radio className="size-3.5" /> Live
          </span>
        )}
        {a.state === 'SIMULATED' && <ProvenanceBadge kind="simulated" />}
        {a.state === 'HISTORICAL_ONLY' && <ProvenanceBadge kind="historical" />}
      </div>

      {current ? (
        <>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Stat label="Available" value={a.available ?? '—'} />
            <Stat label="Occupied" value={formatPercent(a.occupancy)} />
            <Stat label="Capacity" value={a.capacity ?? '—'} />
          </div>
          {a.occupancy != null && <OccupancyBar occupancy={a.occupancy} status={status} className="mt-4 h-2" />}
          <div className="mt-3 flex items-center justify-between text-xs text-ink-500">
            <StatusBadge status={status} />
            <span className="flex items-center gap-1">
              <Clock className="size-3" /> Updated {formatAge(a.ageMinutes)}
            </span>
          </div>
          {a.state === 'SIMULATED' && (
            <p className="mt-3 rounded-md bg-status-simulated-bg px-3 py-2 text-xs text-status-simulated">
              Simulation Mode — historical parking data replay. This is not live sensor data.
            </p>
          )}
        </>
      ) : (
        <div className="mt-3 rounded-md border border-dashed border-ink-200 bg-ink-25 px-4 py-5 text-center">
          <p className="text-sm font-medium text-ink-700">
            {a.state === 'STALE' ? 'Availability data is out of date' : a.message}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            {a.state === 'STALE'
              ? `Last reported ${formatAge(a.ageMinutes)}. We don’t show stale readings as current.`
              : a.state === 'HISTORICAL_ONLY'
                ? 'Past occupancy exists for this facility, but there is no current feed.'
                : 'No availability source is connected for this facility. Location and details come from the parking directory.'}
          </p>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-ink-50 px-3 py-2.5">
      <p className="text-xs text-ink-500">{label}</p>
      <p className="tabular mt-0.5 text-xl font-semibold text-ink-900">{value}</p>
    </div>
  )
}

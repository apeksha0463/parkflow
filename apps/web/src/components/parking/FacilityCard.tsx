import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BatteryCharging, ChevronRight, Navigation } from 'lucide-react'
import { cn } from '../../lib/cn'
import { directionsUrl, formatDistance } from '../../lib/format'
import type { StatusThresholds } from '../../lib/status'
import type { Facility } from '../../lib/types'
import { predictionKind, predictionUnavailableReason } from '../../lib/provenance'
import { SourceBadge } from '../ui/Badges'
import { AvailabilityInline } from './Availability'
import { PredictionLine } from './Prediction'
import { TypeIcon } from './meta'

interface Props {
  facility: Facility
  selected?: boolean
  onSelect?: (id: string) => void
  thresholds?: StatusThresholds
  /** When set, clicking the card focuses it (e.g. on the map) and details/directions become explicit links. */
  onFocus?: (f: Facility) => void
  footer?: ReactNode
}

export function FacilityCard({ facility: f, selected, onSelect, thresholds, onFocus, footer }: Props) {
  return (
    <article
      className={cn(
        'group relative rounded-lg border bg-white p-4 transition-colors',
        selected ? 'border-brand-500 ring-3 ring-brand-100' : 'border-ink-100 hover:border-ink-200',
      )}
      onMouseEnter={() => onSelect?.(f.id)}
    >
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-md bg-ink-50 text-ink-600">
          <TypeIcon type={f.type} className="size-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 text-sm leading-snug font-semibold text-ink-900">
              {onFocus ? (
                <button type="button" onClick={() => onFocus(f)} className="text-left after:absolute after:inset-0 focus:outline-none" aria-label={`Show ${f.displayName} on the map`}>
                  <span className={cn(f.nameIsDerived && 'font-medium text-ink-700')}>{f.displayName}</span>
                </button>
              ) : (
                <Link to={`/parking/${f.id}`} className="after:absolute after:inset-0 focus:outline-none">
                  <span className={cn(f.nameIsDerived && 'font-medium text-ink-700')}>{f.displayName}</span>
                </Link>
              )}
            </h3>
            {f.distanceMeters != null && <span className="tabular shrink-0 text-xs font-medium text-ink-500">{formatDistance(f.distanceMeters)}</span>}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-500">
            <span>{f.typeLabel}</span>
            {/* Directory facts are shown only when the source states them; unknown facts are omitted, never guessed. */}
            {f.capacity != null && <span>· {f.capacity} spaces</span>}
            {f.evCharging && (
              <span className="inline-flex items-center gap-0.5">
                · <BatteryCharging className="size-3" aria-hidden /> EV charging
              </span>
            )}
            {f.openNow === true && <span className="text-status-available">· Open now</span>}
            {f.openNow === false && <span className="text-status-full">· Closed now</span>}
            {f.isFree === true && <span>· Free</span>}
            {f.isFree === false && <span>· Paid</span>}
            {f.isDemo && <span className="rounded bg-status-simulated-bg px-1 text-2xs font-medium text-status-simulated">DEMO</span>}
          </p>
          {/* Every status carries its source: LIVE, API, HISTORICAL, SIMULATION · RESEARCH or UNAVAILABLE. */}
          <dl className="mt-2.5 space-y-2">
            <div>
              <dt className="mb-1 text-2xs font-medium tracking-wide text-ink-400 uppercase">Availability</dt>
              <dd>
                <AvailabilityInline availability={f.availability} thresholds={thresholds} />
              </dd>
            </div>
            <div>
              <dt className="mb-1 text-2xs font-medium tracking-wide text-ink-400 uppercase">Prediction</dt>
              <dd className="flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                <SourceBadge kind={predictionKind(f)} />
                {predictionKind(f) === 'SIMULATION' ? <PredictionLine facility={f} badge={false} /> : <span>{predictionUnavailableReason(f)}</span>}
              </dd>
            </div>
          </dl>
        </div>
        {!onFocus && <ChevronRight className="mt-2 size-4 shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5" aria-hidden />}
      </div>
      {footer && <div className="relative z-10 mt-3 border-t border-ink-100 pt-3">{footer}</div>}
      {onFocus && (
        <div className="relative z-10 mt-3 flex gap-4 text-xs font-medium">
          <Link to={`/parking/${f.id}`} className="text-brand-700 hover:underline">
            Details
          </Link>
          <a href={directionsUrl(f.latitude, f.longitude)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink-600 hover:text-ink-900">
            <Navigation className="size-3" aria-hidden /> Directions
          </a>
        </div>
      )}
    </article>
  )
}

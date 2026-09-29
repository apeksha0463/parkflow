import { cn } from '../../lib/cn'
import { STATUS_LABEL, type ParkingStatus } from '../../lib/status'

const statusStyles: Record<ParkingStatus, string> = {
  available: 'bg-status-available-bg text-status-available',
  moderate: 'bg-status-moderate-bg text-status-moderate',
  nearly_full: 'bg-status-nearly-full-bg text-status-nearly-full',
  full: 'bg-status-full-bg text-status-full',
  unknown: 'bg-status-unknown-bg text-status-unknown',
}

const base = 'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap'

export function StatusBadge({ status, className }: { status: ParkingStatus; className?: string }) {
  return (
    <span className={cn(base, statusStyles[status], className)}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  )
}

/** Provenance label: every number shown must say whether it is observed, predicted or simulated. */
export type Provenance = 'observed' | 'predicted' | 'simulated' | 'historical'

const provenanceStyles: Record<Provenance, string> = {
  observed: 'bg-ink-100 text-ink-700',
  historical: 'bg-ink-100 text-ink-600',
  predicted: 'bg-status-predicted-bg text-status-predicted',
  simulated: 'bg-status-simulated-bg text-status-simulated',
}
const provenanceLabel: Record<Provenance, string> = {
  observed: 'Observed',
  historical: 'Historical',
  predicted: 'Predicted',
  simulated: 'Simulated',
}

export function ProvenanceBadge({ kind, className }: { kind: Provenance; className?: string }) {
  return <span className={cn(base, 'uppercase tracking-wide text-2xs', provenanceStyles[kind], className)}>{provenanceLabel[kind]}</span>
}

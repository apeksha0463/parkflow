import { AlertTriangle, Database, Sparkles } from 'lucide-react'
import { cn } from '../../lib/cn'
import { PRESSURE_LABEL, type Pressure } from '../../lib/pressure'

const base = 'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap'

const pressureStyles: Record<Pressure, string> = {
  normal: 'bg-pressure-normal-bg text-pressure-normal',
  moderate: 'bg-pressure-moderate-bg text-pressure-moderate',
  high: 'bg-pressure-high-bg text-pressure-high',
  saturated: 'bg-pressure-saturated-bg text-pressure-saturated',
  unknown: 'bg-pressure-unknown-bg text-pressure-unknown',
}

/** Current pressure band (observed/replayed occupancy). Always label + dot, never colour alone. */
export function PressureBadge({ pressure, className }: { pressure: Pressure; className?: string }) {
  return (
    <span className={cn(base, pressureStyles[pressure], className)}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {PRESSURE_LABEL[pressure]}
    </span>
  )
}

export type Provenance = 'replay' | 'predicted' | 'warning'

const provenance: Record<Provenance, { label: string; cls: string; icon: typeof Database }> = {
  replay: { label: 'Historical replay', cls: 'bg-data-bg text-data', icon: Database },
  predicted: { label: 'Predicted', cls: 'bg-predicted-bg text-predicted', icon: Sparkles },
  warning: { label: 'Spillover warning', cls: 'bg-warning-bg text-warning', icon: AlertTriangle },
}

/** Where a value comes from: every number shown says whether it is replayed history or a prediction. */
export function ProvenanceBadge({ kind, label, className }: { kind: Provenance; label?: string; className?: string }) {
  const p = provenance[kind]
  const Icon = p.icon
  return (
    <span className={cn(base, 'text-2xs uppercase tracking-wide', p.cls, className)}>
      <Icon className="size-3" aria-hidden />
      {label ?? p.label}
    </span>
  )
}

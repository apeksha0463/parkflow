import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react'
import { cn } from '../../lib/cn'
import type { ParkingType } from '../../lib/types'
import { FILTER_TYPES, TYPE_LABEL, TypeIcon } from './meta'

export type SortKey = 'distance' | 'availability' | 'capacity' | 'name'

export interface FilterState {
  types: ParkingType[]
  openNow: boolean
  ev: boolean
  free: boolean
  hasAvailability: boolean
  radius: number
  sort: SortKey
}

export const DEFAULT_FILTERS: FilterState = { types: [], openNow: false, ev: false, free: false, hasAvailability: false, radius: 2000, sort: 'distance' }

const RADII = [500, 1000, 2000, 5000]

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors',
        active ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300',
      )}
    >
      {children}
    </button>
  )
}

function TypeMenu({ value, onChange }: { value: ParkingType[]; onChange: (t: ParkingType[]) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  const toggle = (t: ParkingType) => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t])
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium whitespace-nowrap',
          value.length ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300',
        )}
      >
        <SlidersHorizontal className="size-3.5" />
        {value.length ? `Type · ${value.length}` : 'Parking type'}
        <ChevronDown className="size-3" />
      </button>
      {open && (
        <div className="absolute left-0 z-[1001] mt-1.5 w-60 rounded-lg border border-ink-100 bg-white p-1 shadow-pop">
          <div className="max-h-72 overflow-y-auto">
            {FILTER_TYPES.map((t) => {
              const on = value.includes(t)
              return (
                <button
                  key={t}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  onClick={() => toggle(t)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-ink-700 hover:bg-ink-50"
                >
                  <span className={cn('grid size-4 place-items-center rounded border', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300')}>
                    {on && <Check className="size-3" />}
                  </span>
                  <TypeIcon type={t} className="size-4 text-ink-400" />
                  {TYPE_LABEL[t]}
                </button>
              )
            })}
          </div>
          {value.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="mt-1 w-full rounded-md border-t border-ink-100 px-2.5 py-2 text-left text-xs font-medium text-brand-600 hover:bg-ink-50">
              Clear types
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const selectClass =
  'h-8 rounded-md border border-ink-200 bg-white pr-7 pl-2.5 text-xs font-medium text-ink-700 focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-100'

export function FilterBar({ value, onChange, hasDestination }: { value: FilterState; onChange: (f: FilterState) => void; hasDestination: boolean }) {
  const set = <K extends keyof FilterState>(k: K, v: FilterState[K]) => onChange({ ...value, [k]: v })
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        <TypeMenu value={value.types} onChange={(t) => set('types', t)} />
        <Chip active={value.openNow} onClick={() => set('openNow', !value.openNow)}>
          Open now
        </Chip>
        <Chip active={value.ev} onClick={() => set('ev', !value.ev)}>
          EV charging
        </Chip>
        <Chip active={value.free} onClick={() => set('free', !value.free)}>
          Free
        </Chip>
        <Chip active={value.hasAvailability} onClick={() => set('hasAvailability', !value.hasAvailability)}>
          With availability data
        </Chip>
      </div>
      {hasDestination && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
          <label className="flex items-center gap-1.5">
            Within
            <select aria-label="Search radius" className={selectClass} value={value.radius} onChange={(e) => set('radius', Number(e.target.value))}>
              {RADII.map((r) => (
                <option key={r} value={r}>
                  {r < 1000 ? `${r} m` : `${r / 1000} km`}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            Sort by
            <select aria-label="Sort results" className={selectClass} value={value.sort} onChange={(e) => set('sort', e.target.value as SortKey)}>
              <option value="distance">Distance</option>
              <option value="availability">Available spaces</option>
              <option value="capacity">Capacity</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>
      )}
    </div>
  )
}

/** Query params understood by /api/parking and /api/parking/map. */
export function filterQuery(f: FilterState) {
  return {
    types: f.types,
    openNow: f.openNow || undefined,
    ev: f.ev || undefined,
    free: f.free || undefined,
    hasAvailability: f.hasAvailability || undefined,
  }
}

import { useState } from 'react'
import { ChevronsLeft, ChevronsRight, Database, Pause, Play, StepBack, StepForward } from 'lucide-react'
import { cn } from '../../lib/cn'
import { formatDateTime, fromLocalInput, toLocalInput, tzName } from '../../lib/format'
import { useReplay, useReplayControl, useStats } from '../../lib/hooks'

const SPEEDS = [1, 10, 60]

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-7 place-items-center rounded text-ink-200 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
    >
      {children}
    </button>
  )
}

/**
 * Historical-replay context: which recorded 2019 instant every value in the app refers to, the data source,
 * and controls for the shared server replay clock. Never presented as live data.
 */
export function ReplayBar() {
  const replay = useReplay()
  const control = useReplayControl()
  const stats = useStats()
  const [editing, setEditing] = useState(false)
  const c = replay.data
  const source = stats.data?.sources[0]

  if (replay.isError) {
    return <div className="bg-ink-900 px-4 py-1.5 text-xs text-ink-300 sm:px-6">Replay clock unavailable — the API cannot be reached.</div>
  }
  if (!c) return <div className="h-9 bg-ink-900" aria-busy="true" />
  if (c.mode !== 'HISTORICAL_REPLAY' || !c.range) {
    return <div className="bg-ink-900 px-4 py-1.5 text-xs text-ink-300 sm:px-6">No historical replay is loaded on this server.</div>
  }

  const step = (min: number) => {
    const t = new Date(c.now).getTime() + min * 60_000
    const lo = new Date(c.range!.start).getTime()
    const hi = new Date(c.range!.end).getTime()
    control.mutate({ at: new Date(Math.min(hi, Math.max(lo, t))).toISOString() })
  }

  return (
    <div className="bg-ink-900 text-white">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-1.5 sm:px-6">
        <span className="inline-flex items-center gap-1.5 rounded bg-data/30 px-1.5 py-0.5 text-2xs font-semibold tracking-wider text-cyan-100 uppercase">
          <Database className="size-3" aria-hidden /> Historical replay
        </span>

        <div className="flex items-center gap-1" role="group" aria-label="Replay controls">
          <IconButton label="Back 1 hour" onClick={() => step(-60)} disabled={control.isPending}>
            <ChevronsLeft className="size-4" />
          </IconButton>
          <IconButton label="Back 5 minutes" onClick={() => step(-5)} disabled={control.isPending}>
            <StepBack className="size-3.5" />
          </IconButton>
          <IconButton label={c.playing ? 'Pause replay' : 'Play replay'} onClick={() => control.mutate({ playing: !c.playing })} disabled={control.isPending}>
            {c.playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </IconButton>
          <IconButton label="Forward 5 minutes" onClick={() => step(5)} disabled={control.isPending}>
            <StepForward className="size-3.5" />
          </IconButton>
          <IconButton label="Forward 1 hour" onClick={() => step(60)} disabled={control.isPending}>
            <ChevronsRight className="size-4" />
          </IconButton>
        </div>

        {editing ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const v = new FormData(e.currentTarget).get('at') as string
              if (v) control.mutate({ at: fromLocalInput(v) }, { onSettled: () => setEditing(false) })
            }}
          >
            <label className="sr-only" htmlFor="replay-at">
              Replay time (Melbourne)
            </label>
            <input
              id="replay-at"
              name="at"
              type="datetime-local"
              step={300}
              defaultValue={toLocalInput(c.now)}
              min={toLocalInput(c.range.start)}
              max={toLocalInput(c.range.end)}
              className="h-7 rounded border border-white/20 bg-white/10 px-2 text-xs text-white [color-scheme:dark]"
            />
            <button type="submit" className="h-7 rounded bg-white px-2.5 text-xs font-medium text-ink-900">
              Go
            </button>
            <button type="button" className="text-xs text-ink-300 hover:text-white" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="group text-left" title="Change replay time">
            <span className="tabular text-sm font-medium" aria-live="polite">
              {formatDateTime(c.now)} <span className="text-ink-300">{tzName(c.now)}</span>
            </span>
            <span className="ml-2 text-2xs text-ink-400 underline-offset-2 group-hover:text-ink-200 group-hover:underline">change</span>
          </button>
        )}

        <label className="flex items-center gap-1.5 text-2xs text-ink-300">
          Speed
          <select
            value={c.speed}
            onChange={(e) => control.mutate({ speed: Number(e.target.value) })}
            className="h-6 rounded border border-white/20 bg-ink-900 px-1 text-xs text-white"
          >
            {[...new Set([...SPEEDS, c.speed])].map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>

        {source && <p className={cn('ml-auto hidden text-2xs text-ink-400 xl:block')}>{source.name} · recorded data, not live</p>}
      </div>
    </div>
  )
}

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatPercent, formatTime } from '../../lib/format'
import { SERIES, TOKENS } from '../../lib/tokens'
import type { PvaPoint } from '../../lib/types'

export interface SeriesDef {
  key: string
  label: string
  color: string
  dashed?: boolean
}

interface Props {
  points: PvaPoint[]
  models: { id: string; featureSet: string }[]
  saturation: number
  /** Vertical marker (e.g. event onset or replay time). */
  marker?: { at: string; label: string } | null
}

export const modelLabel = (featureSet: string) => (featureSet === 'spatial_temporal' ? 'Model B · spatial-temporal' : 'Model A · temporal')

/** Predicted vs recorded occupancy at each target time. One y-axis (occupancy %); gaps stay gaps. */
export function PredictedVsActualChart({ points, models, saturation, marker }: Props) {
  const series: SeriesDef[] = [
    { key: 'actual', label: 'Actual (recorded)', color: SERIES.actual },
    ...models.map((m) => ({ key: m.id, label: modelLabel(m.featureSet), color: m.featureSet === 'spatial_temporal' ? SERIES.modelB : SERIES.modelA })),
    { key: 'persistence', label: 'Persistence baseline', color: SERIES.persistence, dashed: true },
  ]
  const data = points.map((p) => ({
    t: new Date(p.targetTime).getTime(),
    actual: p.actual,
    persistence: p.persistence,
    ...p.predicted,
  }))

  return (
    <figure>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-600" aria-label="Legend">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden>
              <line x1="0" y1="4" x2="18" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '4 3' : undefined} />
            </svg>
            {s.label}
          </li>
        ))}
      </ul>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={TOKENS.ink100} vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(v: number) => formatTime(new Date(v).toISOString())}
              tick={{ fontSize: 11, fill: TOKENS.ink500 }}
              stroke={TOKENS.ink200}
              minTickGap={24}
            />
            <YAxis domain={[0, 1]} tickFormatter={(v: number) => formatPercent(v)} tick={{ fontSize: 11, fill: TOKENS.ink500 }} stroke={TOKENS.ink200} width={48} />
            <ReferenceLine y={saturation} stroke={TOKENS.ink400} strokeDasharray="2 3" label={{ value: `Saturation ${formatPercent(saturation)}`, position: 'insideTopLeft', fontSize: 10, fill: TOKENS.ink500 }} />
            {marker && (
              <ReferenceLine x={new Date(marker.at).getTime()} stroke={TOKENS.ink700} strokeDasharray="3 3" label={{ value: marker.label, position: 'insideTopRight', fontSize: 10, fill: TOKENS.ink700 }} />
            )}
            <Tooltip
              labelFormatter={(v) => `Target ${formatTime(new Date(Number(v)).toISOString())}`}
              formatter={(value, name) => [value == null ? 'No reading' : formatPercent(Number(value)), series.find((s) => s.key === name)?.label ?? String(name)]}
              contentStyle={{ fontSize: 12, borderRadius: 6, borderColor: TOKENS.ink100 }}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                name={s.key}
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dashed ? '4 3' : undefined}
                dot={false}
                activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

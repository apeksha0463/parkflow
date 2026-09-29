import { useQuery } from '@tanstack/react-query'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../../lib/api'
import { formatPercent } from '../../lib/format'
import { TOKENS } from '../../lib/tokens'
import type { Facility } from '../../lib/types'
import { ProvenanceBadge } from '../ui/Badges'
import { Skeleton } from '../ui/primitives'

interface OccupancyResponse {
  availabilityMode: Facility['availabilityMode']
  hours: number
  zones: { id: string; name: string; points: { observedAt: string; occupancy: number; sourceType: string }[] }[]
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })

/** Observed (or simulation-replay) occupancy over the last 24 h. Renders nothing invented: no data -> says so. */
export function OccupancyHistory({ facility, saturationThreshold }: { facility: Pick<Facility, 'id' | 'availabilityMode'>; saturationThreshold: number }) {
  const q = useQuery({
    queryKey: ['occupancy', facility.id],
    queryFn: ({ signal }) => api<OccupancyResponse>(`/api/parking/${facility.id}/occupancy`, { query: { hours: 24 }, signal }),
    enabled: facility.availabilityMode !== 'NONE',
  })
  if (facility.availabilityMode === 'NONE') return <p className="text-sm text-ink-500">No historical occupancy has been recorded for this facility.</p>
  if (q.isPending) return <Skeleton className="h-48 w-full" />
  if (q.isError) return <p className="text-sm text-ink-500">Occupancy history is temporarily unavailable.</p>
  const zone = q.data.zones.find((z) => z.points.length > 0)
  if (!zone) return <p className="text-sm text-ink-500">No occupancy recorded in the last 24 hours.</p>
  const simulated = zone.points.some((p) => p.sourceType === 'SIMULATION')
  const color = simulated ? TOKENS.simulated : TOKENS.ink700
  const data = zone.points.map((p) => ({ t: new Date(p.observedAt).getTime(), v: p.occupancy }))
  const hourly = data.filter((_, i) => i % 12 === 0)

  return (
    <figure>
      <div className="mb-2 flex items-center gap-2 text-xs text-ink-500">
        <ProvenanceBadge kind={simulated ? 'simulated' : 'observed'} />
        <span>{simulated ? 'Simulation Mode — historical parking data replay' : 'Observed occupancy'}, last 24 h</span>
      </div>
      <div className="h-48" role="img" aria-label={`Occupancy over the last 24 hours, ${data.length} readings, latest ${formatPercent(data.at(-1)!.v)}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={TOKENS.ink100} vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(t) => time(new Date(t).toISOString())} tick={{ fontSize: 11, fill: TOKENS.ink500 }} stroke={TOKENS.ink200} minTickGap={40} />
            <YAxis domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} tick={{ fontSize: 11, fill: TOKENS.ink500 }} stroke={TOKENS.ink200} />
            <ReferenceLine y={saturationThreshold} stroke={TOKENS.ink400} strokeDasharray="4 4" label={{ value: `Saturation ${formatPercent(saturationThreshold)}`, position: 'insideTopLeft', fontSize: 11, fill: TOKENS.ink500 }} />
            <Tooltip
              cursor={{ stroke: TOKENS.ink300 }}
              formatter={(v) => [formatPercent(Number(v)), 'Occupancy']}
              labelFormatter={(t) => time(new Date(Number(t)).toISOString())}
              contentStyle={{ fontSize: 12, borderRadius: 6, borderColor: TOKENS.ink100 }}
            />
            <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-xs text-ink-600">
        <summary className="cursor-pointer text-ink-500">Show as table (hourly)</summary>
        <table className="mt-2 w-full max-w-xs">
          <thead>
            <tr className="text-left text-ink-500">
              <th className="font-medium">Time</th>
              <th className="font-medium">Occupancy</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {hourly.map((d) => (
              <tr key={d.t}>
                <td>{time(new Date(d.t).toISOString())}</td>
                <td>{formatPercent(d.v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

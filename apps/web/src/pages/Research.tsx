import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Check, X as XIcon } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AppShell } from '../components/layout/AppShell'
import { ErrorState, Skeleton } from '../components/ui/primitives'
import { api, errorMessage } from '../lib/api'
import { cn } from '../lib/cn'
import { formatInt, formatPercent, formatPp } from '../lib/format'
import { SERIES, TOKENS } from '../lib/tokens'
import type { DatasetReports, Evaluation, MetricRow, ModelPerformance } from '../lib/types'
// The committed research figure (ml/evaluation), bundled as-is: one source of truth.
import scatterFigure from '../../../../ml/evaluation/actual_vs_predicted_15min.png'

const SUBSETS: { key: string; label: string; help: string }[] = [
  { key: 'all', label: 'All test samples', help: 'Every 5-minute instant in the test period (experiment hours).' },
  { key: 'post_neighbour_saturation', label: 'After a neighbour saturates', help: 'Instants following a saturation event in a neighbouring zone — the research subset.' },
  { key: 'target_approaching_or_saturated', label: 'Target near saturation', help: 'The target zone’s actual occupancy is in the high-pressure or saturated band.' },
]
const ROWS: { model: string; feature_set: string; label: string }[] = [
  { model: 'persistence', feature_set: 'none', label: 'Persistence baseline (no change)' },
  { model: 'ridge', feature_set: 'temporal', label: 'Ridge · temporal' },
  { model: 'ridge', feature_set: 'spatial_temporal', label: 'Ridge · spatial-temporal' },
  { model: 'hgb', feature_set: 'temporal', label: 'Model A · temporal-only' },
  { model: 'hgb', feature_set: 'spatial_temporal', label: 'Model B · spatial-temporal' },
]
type MetricKey = 'mae' | 'rmse' | 'r2'

export default function Research() {
  const q = useQuery({ queryKey: ['model-performance'], queryFn: () => api<ModelPerformance>('/api/analytics/model-performance'), staleTime: 5 * 60_000 })

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl space-y-14 px-4 py-8 sm:px-6 md:py-12">
        <header className="max-w-3xl">
          <p className="text-2xs font-semibold tracking-[0.14em] text-data uppercase">Research & Models</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink-900 md:text-4xl">Research &amp; Models</h1>
          <div className="mt-5 rounded-lg border border-ink-100 bg-white p-5 shadow-card">
            <p className="text-2xs font-medium tracking-wide text-ink-500 uppercase">Research question</p>
            <blockquote className="mt-2 text-lg leading-relaxed font-medium text-ink-900">
              Does incorporating neighbouring parking occupancy improve short-term prediction of parking-pressure changes following a saturation event?
            </blockquote>
            <p className="mt-3 text-sm text-ink-600">
              We study parking-pressure propagation after saturation — how occupancy in surrounding blocks changes — not individual drivers. The data has no vehicle trajectories, so any effect
              is a statistical association between zones.
            </p>
          </div>
          <nav className="mt-5 flex flex-wrap gap-2 text-sm" aria-label="On this page">
            {[['#method', 'Methodology'], ['#results', 'Model comparison'], ['#findings', 'Findings'], ['#predicted-vs-actual', 'Predicted vs actual'], ['#limitations', 'Limitations']].map(([href, label]) => (
              <a key={href} href={href} className="rounded-full border border-ink-200 bg-white px-3 py-1 font-medium text-ink-700 hover:border-ink-300 hover:text-ink-900">
                {label}
              </a>
            ))}
          </nav>
        </header>

        {q.isPending ? (
          <Skeleton className="h-96 w-full" />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : !q.data.offline ? (
          <p className="rounded-lg border border-ink-100 bg-white p-6 text-sm text-ink-600">
            The evaluation results are not available (the model service is unreachable). No metrics are shown rather than estimates.
          </p>
        ) : (
          <ResearchBody e={q.data.offline} d={q.data.dataset} registry={q.data.registry} />
        )}
      </div>
    </AppShell>
  )
}

function Section({ id, title, lead, children }: { id: string; title: string; lead?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-2xl font-semibold tracking-tight text-ink-900">
        {title}
      </h2>
      {lead && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-600">{lead}</p>}
      <div className="mt-6">{children}</div>
    </section>
  )
}

function ResearchBody({ e, d, registry }: { e: Evaluation; d: DatasetReports | null; registry: ModelPerformance['registry'] }) {
  const [subset, setSubset] = useState('all')
  const [metric, setMetric] = useState<MetricKey>('mae')
  const horizons = e.config.horizons_minutes
  const get = (m: string, fs: string, h: number, sub = subset): MetricRow | undefined =>
    e.metrics.find((x) => x.model === m && x.feature_set === fs && x.horizon_min === h && x.subset === sub)
  const fmt = (v: number) => (metric === 'r2' ? v.toFixed(3) : formatPp(v))
  const best = (h: number) => {
    const vals = ROWS.map((r) => get(r.model, r.feature_set, h)?.[metric]).filter((v): v is number => v != null)
    return metric === 'r2' ? Math.max(...vals) : Math.min(...vals)
  }
  const cmp = (h: number, sub = subset) => e.comparisons.find((c) => c.model === 'hgb' && c.subset === sub && c.horizon_min === h)
  const testDays = e.comparisons[0]?.bootstrap.days
  const chartData = horizons.map((h) => ({
    h,
    persistence: get('persistence', 'none', h)?.[metric] ?? null,
    modelA: get('hgb', 'temporal', h)?.[metric] ?? null,
    modelB: get('hgb', 'spatial_temporal', h)?.[metric] ?? null,
  }))

  const steps = [
    {
      title: 'Dataset',
      body: d?.ingest ? `${formatInt(d.ingest.final_rows)} sensor records retained of ${formatInt(d.ingest.raw_rows)}; ${formatInt(d.ingest.devices)} sensors.` : e.config.dataset,
    },
    {
      title: 'Preprocessing',
      body: d?.occupancy
        ? `Occupancy on a ${d.occupancy.grid_step_minutes}-minute grid; a block needs ≥ ${d.occupancy.min_observed_bays} reporting bays.`
        : `Occupancy on a ${e.config.bucket_minutes}-minute grid.`,
    },
    {
      title: 'Neighbour detection',
      body: d?.geo
        ? `${formatInt(d.geo.zones_located)} of ${formatInt(d.geo.zones)} blocks located; neighbours within ${d.geo.neighbour_radius_m} m (median ${d.geo.neighbours_per_zone['50%']}).`
        : `Neighbours within ${e.config.neighbour_radius_m} m.`,
    },
    {
      title: 'Saturation events',
      body: `${formatInt(e.saturation_events.events)} events (≥ ${formatPercent(e.config.saturation_threshold)} after 30 min below) in ${formatInt(e.saturation_events.zones_with_events)} zones; median ${e.saturation_events.median_duration_min} min.`,
    },
    {
      title: 'Model A vs Model B',
      body: `${e.zones_in_experiment} blocks with enough data (${e.zones_with_neighbours} with neighbours). A: ${e.config.features.temporal.length} features, B: ${e.config.features.spatial_temporal.length}.`,
    },
    { title: 'Evaluation', body: `Test ${e.splits.test.range.join(' – ')}, ${formatInt(e.splits.test.samples)} samples; paired day-block bootstrap over ${testDays ?? '—'} days.` },
  ]

  return (
    <>
      <Section id="method" title="Methodology" lead={<>City of Melbourne on-street parking sensors, 2019. Figures below are read from the pipeline’s own reports and <span className="font-mono text-xs">results.json</span>.</>}>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="rounded-lg border border-ink-100 bg-white p-4 shadow-card">
              <span className="tabular text-2xs font-semibold text-ink-400">{String(i + 1).padStart(2, '0')}</span>
              <p className="mt-1 text-sm font-semibold text-ink-900">{s.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-600">{s.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-4 overflow-x-auto rounded-lg border border-ink-100 bg-white shadow-card">
          <table className="w-full min-w-[480px] text-sm">
            <caption className="sr-only">Data splits</caption>
            <thead className="bg-ink-50 text-left text-2xs tracking-wide text-ink-500 uppercase">
              <tr>
                <th className="px-4 py-2 font-medium">Split</th>
                <th className="px-4 py-2 font-medium">Period</th>
                <th className="px-4 py-2 text-right font-medium">Samples</th>
              </tr>
            </thead>
            <tbody className="tabular divide-y divide-ink-100 text-ink-700">
              {(['train', 'validation', 'test'] as const).map((k) => (
                <tr key={k}>
                  <td className="px-4 py-2 capitalize">{k}</td>
                  <td className="px-4 py-2">{e.splits[k].range.join(' – ')}</td>
                  <td className="px-4 py-2 text-right">{formatInt(e.splits[k].samples)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {registry && (
          <p className="mt-3 text-xs text-ink-500">
            Served model: <span className="font-mono">{registry.active}</span>
            {registry.active_selected_by ? ` (selected by ${registry.active_selected_by})` : ''}. Models are loaded from saved artefacts; the service never retrains on requests.
          </p>
        )}
      </Section>

      <Section
        id="results"
        title="Model comparison"
        lead={<>Measured once on the test period after model selection on validation. MAE and RMSE in percentage points of occupancy (lower is better); R² higher is better.</>}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented value={subset} onChange={setSubset} options={SUBSETS.map((s) => ({ value: s.key, label: s.label }))} label="Test subset" />
          <Segmented value={metric} onChange={(v) => setMetric(v as MetricKey)} options={[{ value: 'mae', label: 'MAE' }, { value: 'rmse', label: 'RMSE' }, { value: 'r2', label: 'R²' }]} label="Metric" />
        </div>
        <p className="mt-2 text-xs text-ink-500">{SUBSETS.find((s) => s.key === subset)?.help}</p>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.1fr]">
          <figure className="rounded-lg border border-ink-100 bg-white p-4 shadow-card">
            <figcaption className="text-sm font-semibold text-ink-900">{metric.toUpperCase()} by forecast horizon</figcaption>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-600" aria-label="Legend">
              {[
                { k: 'Model A · temporal', c: SERIES.modelA },
                { k: 'Model B · spatial-temporal', c: SERIES.modelB },
                { k: 'Persistence', c: SERIES.persistence, dash: true },
              ].map((s) => (
                <li key={s.k} className="flex items-center gap-1.5">
                  <svg width="18" height="8" aria-hidden>
                    <line x1="0" y1="4" x2="18" y2="4" stroke={s.c} strokeWidth="2" strokeDasharray={s.dash ? '4 3' : undefined} />
                  </svg>
                  {s.k}
                </li>
              ))}
            </ul>
            <div className="mt-2 h-60">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                  <CartesianGrid stroke={TOKENS.ink100} vertical={false} />
                  <XAxis dataKey="h" tickFormatter={(h: number) => `${h} min`} tick={{ fontSize: 11, fill: TOKENS.ink500 }} stroke={TOKENS.ink200} />
                  <YAxis
                    domain={['auto', 'auto']}
                    tickFormatter={(v: number) => (metric === 'r2' ? v.toFixed(2) : `${(v * 100).toFixed(1)}`)}
                    tick={{ fontSize: 11, fill: TOKENS.ink500 }}
                    stroke={TOKENS.ink200}
                    width={40}
                    label={{ value: metric === 'r2' ? 'R²' : 'pp', angle: -90, position: 'insideLeft', fontSize: 10, fill: TOKENS.ink500 }}
                  />
                  <Tooltip
                    labelFormatter={(h) => `${h} min ahead`}
                    formatter={(v, name) => [fmt(Number(v)), name === 'modelA' ? 'Model A' : name === 'modelB' ? 'Model B' : 'Persistence']}
                    contentStyle={{ fontSize: 12, borderRadius: 6, borderColor: TOKENS.ink100 }}
                  />
                  <Line dataKey="modelA" stroke={SERIES.modelA} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: SERIES.modelA }} isAnimationActive={false} />
                  <Line dataKey="modelB" stroke={SERIES.modelB} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: SERIES.modelB }} isAnimationActive={false} />
                  <Line dataKey="persistence" stroke={SERIES.persistence} strokeWidth={2} strokeDasharray="4 3" dot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: SERIES.persistence }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </figure>

          <div className="overflow-x-auto rounded-lg border border-ink-100 bg-white shadow-card">
            <table className="w-full min-w-[520px] text-sm">
              <caption className="sr-only">{metric.toUpperCase()} by model and forecast horizon</caption>
              <thead className="bg-ink-50 text-left text-2xs tracking-wide text-ink-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Model</th>
                  {horizons.map((h) => (
                    <th key={h} className="px-3 py-2.5 text-right font-medium">
                      {h} min
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {ROWS.map((r) => (
                  <tr key={r.label} className={cn(r.model === 'hgb' && 'bg-ink-25')}>
                    <td className={cn('px-4 py-2.5', r.model === 'hgb' ? 'font-semibold text-ink-900' : 'text-ink-700')}>{r.label}</td>
                    {horizons.map((h) => {
                      const v = get(r.model, r.feature_set, h)?.[metric]
                      return (
                        <td key={h} className={cn('tabular px-3 py-2.5 text-right text-ink-700', v === best(h) && 'font-semibold text-pressure-normal')}>
                          {v == null ? '—' : fmt(v)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-ink-100 px-4 py-2 text-xs text-ink-500">
              Best value per horizon in green. n = {get('hgb', 'spatial_temporal', 15)?.n.toLocaleString('en-AU') ?? '—'} samples at 15 min in this subset.
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-ink-100 bg-white p-5 shadow-card">
          <h3 className="text-sm font-semibold text-ink-900">Model B vs Model A — does neighbour information help?</h3>
          <table className="mt-3 w-full min-w-[560px] text-sm">
            <thead className="text-left text-2xs tracking-wide text-ink-500 uppercase">
              <tr>
                <th className="py-1 font-medium">Horizon</th>
                <th className="py-1 text-right font-medium">MAE A</th>
                <th className="py-1 text-right font-medium">MAE B</th>
                <th className="py-1 text-right font-medium">Reduction</th>
                <th className="py-1 text-right font-medium">95% CI of A − B</th>
                <th className="py-1 text-right font-medium">Samples</th>
              </tr>
            </thead>
            <tbody className="tabular text-ink-700">
              {horizons.map((h) => {
                const c = cmp(h)
                return c ? (
                  <tr key={h} className="border-t border-ink-100">
                    <td className="py-1.5">{h} min</td>
                    <td className="py-1.5 text-right">{formatPp(c.mae_temporal)}</td>
                    <td className="py-1.5 text-right">{formatPp(c.mae_spatial_temporal)}</td>
                    <td className="py-1.5 text-right font-semibold text-ink-900">{c.mae_reduction_pct.toFixed(2)}%</td>
                    <td className="py-1.5 text-right text-xs">
                      {(c.bootstrap.ci95[0] * 100).toFixed(3)} – {(c.bootstrap.ci95[1] * 100).toFixed(3)} pp
                    </td>
                    <td className="py-1.5 text-right text-xs">{formatInt(c.n)}</td>
                  </tr>
                ) : null
              })}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-ink-500">Paired day-block bootstrap over {testDays ?? '—'} test days. A confidence interval above zero means Model B’s MAE is lower.</p>
        </div>
      </Section>

      <Section id="findings" title="Findings" lead="Derived from the results above for the full test set — each statement is checked against the data when the page loads.">
        <Findings e={e} />
      </Section>

      <Section id="predicted-vs-actual" title="Predicted vs actual">
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <figure className="rounded-lg border border-ink-100 bg-white p-4 shadow-card">
            <img
              src={scatterFigure}
              alt="Scatter plots of predicted against actual occupancy at 15 minutes for Model A and Model B on a sample of test instants; points cluster along the diagonal with wide spread near 0% and 100%."
              className="w-full"
              loading="lazy"
            />
            <figcaption className="mt-2 text-xs text-ink-500">
              Research evaluation figure written by the training run (<span className="font-mono">ml/evaluation</span>): 15-minute forecasts on a random sample of test instants.
            </figcaption>
          </figure>
          <div className="rounded-lg border border-ink-100 bg-white p-5 shadow-card">
            <h3 className="text-sm font-semibold text-ink-900">Per zone and event</h3>
            <p className="mt-1 text-sm text-ink-600">
              Spillover Intelligence plots both models’ forecasts against the recorded occupancy for any zone and saturation event, at every horizon — computed on request by the model service
              from the replayed test data.
            </p>
            <Link to="/spillover" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
              Open Spillover Intelligence <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </Section>

      <Section id="limitations" title="Limitations">
        <ul className="grid gap-3 md:grid-cols-2">
          <Limitation title="Under-predicts sudden surges">
            Models predict the mean change, so fast jumps are smoothed. When the target zone is near saturation, Model B’s 15-minute R² is{' '}
            {get('hgb', 'spatial_temporal', 15, 'target_approaching_or_saturated')?.r2.toFixed(2) ?? '—'} (persistence {get('persistence', 'none', 15, 'target_approaching_or_saturated')?.r2.toFixed(2) ?? '—'}).
          </Limitation>
          <Limitation title="One city, one year">Melbourne CBD kerbside parking in 2019. Results may not transfer to other cities, off-street car parks or later years.</Limitation>
          <Limitation title="Association, not causation">Pressure propagation between zones is not the same as observing drivers move between them.</Limitation>
          <Limitation title="Replay, not live">The product replays the recorded test period; it does not show current parking availability.</Limitation>
          <Limitation title="External events not modelled">Events, weather, roadworks and holidays are not inputs; the test period includes the pre-Christmas season.</Limitation>
          <Limitation title="Design choices">
            Neighbours by straight-line distance ({e.config.neighbour_radius_m} m), not the road network. The radius and 30-minute event rule were fixed before evaluation.
          </Limitation>
        </ul>
        <p className="mt-4 text-xs text-ink-500">
          Full methodology: <span className="font-mono">RESEARCH.md</span>. Results generated {new Date(e.generated_at).toLocaleDateString('en-AU', { dateStyle: 'medium' })}.
        </p>
      </Section>
    </>
  )
}

function Findings({ e }: { e: Evaluation }) {
  const hs = e.config.horizons_minutes
  const get = (m: string, fs: string, h: number) => e.metrics.find((x) => x.model === m && x.feature_set === fs && x.horizon_min === h && x.subset === 'all')
  const cmps = hs.map((h) => e.comparisons.find((c) => c.model === 'hgb' && c.subset === 'all' && c.horizon_min === h)).filter((c) => c != null)
  const red = cmps.map((c) => c.mae_reduction_pct)
  const bLowerAll = cmps.length > 0 && cmps.every((c) => c.mae_spatial_temporal < c.mae_temporal)
  const grows = red.length > 1 && red.every((r, i) => i === 0 || r >= red[i - 1])
  const persistWins = hs.filter((h) => {
    const b = get('hgb', 'spatial_temporal', h)
    const p = get('persistence', 'none', h)
    return b && p && p.mae < b.mae
  })
  const rmseR2All = hs.every((h) => {
    const b = get('hgb', 'spatial_temporal', h)
    const p = get('persistence', 'none', h)
    return b && p && b.rmse < p.rmse && b.r2 > p.r2
  })
  const range = red.length ? `${Math.min(...red).toFixed(2)}–${Math.max(...red).toFixed(2)}%` : '—'

  const items: { ok: boolean; text: React.ReactNode }[] = [
    {
      ok: bLowerAll,
      text: bLowerAll
        ? 'Neighbour information (Model B) lowers MAE at every evaluated horizon.'
        : 'Neighbour information does not lower MAE at every evaluated horizon.',
    },
    { ok: true, text: Math.max(...red, 0) < 5 ? <>The improvement is small: an MAE reduction of {range} across horizons.</> : <>MAE reduction across horizons: {range}.</> },
    { ok: grows, text: grows ? 'The improvement grows with the forecast horizon.' : 'The improvement does not grow consistently with the horizon.' },
    {
      ok: persistWins.length === 0,
      text: persistWins.length
        ? `The persistence baseline has a lower MAE than Model B at ${persistWins.map((h) => `${h} min`).join(', ')}.`
        : 'Model B has a lower MAE than the persistence baseline at every horizon.',
    },
    {
      ok: rmseR2All,
      text: rmseR2All ? 'Model B has lower RMSE and higher R² than persistence at every horizon.' : 'Model B does not beat persistence on RMSE and R² at every horizon.',
    },
  ]
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3 rounded-lg border border-ink-100 bg-white px-4 py-3 text-sm text-ink-800 shadow-card">
          <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full', it.ok ? 'bg-pressure-normal-bg text-pressure-normal' : 'bg-warning-bg text-warning')} aria-hidden>
            {it.ok ? <Check className="size-3" /> : <XIcon className="size-3" />}
          </span>
          {it.text}
        </li>
      ))}
    </ul>
  )
}

function Limitation({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-lg border border-ink-100 bg-white p-5 shadow-card">
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{children}</p>
    </li>
  )
}

function Segmented({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full flex-wrap rounded-md border border-ink-200 bg-white p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('rounded px-3 py-1.5 text-xs font-medium', value === o.value ? 'bg-ink-900 text-white' : 'text-ink-600 hover:text-ink-900')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ChevronLeft, ChevronRight, FlaskConical, History, MapPin, Navigation, Route } from 'lucide-react'
import { AppShell } from '../components/layout/AppShell'
import { MapLegend, ZoneMap, type FlyTarget, type Highlight } from '../components/map/ZoneMap'
import { modelLabel, PredictedVsActualChart } from '../components/charts/PredictedVsActualChart'
import { ProvenanceBadge, PressureBadge } from '../components/ui/Badges'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, ErrorState, Skeleton } from '../components/ui/primitives'
import { ForecastStrip, OccupancyReadout, useReplayNow, zonePressure } from '../components/zones/ZoneParts'
import { api, errorMessage } from '../lib/api'
import { cn } from '../lib/cn'
import { directionsUrl, formatDateTime, formatDistance, formatPercent, formatShortDateTime, formatTime } from '../lib/format'
import { useMapZones, useReplay, useReplayControl, useThresholds } from '../lib/hooks'
import { PRESSURE_LABEL, pressureFromLevel, type Thresholds } from '../lib/pressure'
import type { EventList, PredictedVsActual, SaturationEvent, Spillover as SpilloverData, ZoneDetail } from '../lib/types'

const PVA_BEFORE_MIN = 60
const PVA_AFTER_MIN = 60

export default function Spillover() {
  const [params, setParams] = useSearchParams()
  const zoneId = params.get('zone')
  const eventId = params.get('event')
  const thresholds = useThresholds()
  const now = useReplayNow()
  const replay = useReplay()
  const control = useReplayControl()
  const { stats, zones } = useMapZones()
  const [fly, setFly] = useState<FlyTarget | null>(null)

  const event = useQuery({
    queryKey: ['event', eventId, now],
    queryFn: () => api<{ event: SaturationEvent }>(`/api/spillover/events/${eventId}`),
    enabled: !!eventId && !!now,
    placeholderData: (prev) => (prev?.event.id === eventId ? prev : undefined),
  })

  const spill = useQuery({
    queryKey: ['spillover', zoneId, now],
    queryFn: () => api<SpilloverData>('/api/spillover/predictions', { query: { facilityId: zoneId } }),
    enabled: !!zoneId && !!now,
    placeholderData: (prev) => (prev?.facilityId === zoneId ? prev : undefined),
  })

  const selectZone = (id: string) => {
    const next = new URLSearchParams(params)
    next.set('zone', id)
    if (event.data && event.data.event.facility.id !== id) next.delete('event')
    setParams(next, { replace: true })
  }

  /** Opens a real saturation event: seek the shared replay clock to its onset and select its zone. */
  const openEvent = (e: SaturationEvent) => {
    control.mutate({ at: e.startedAt, playing: false })
    setParams(new URLSearchParams({ zone: e.facility.id, event: e.id }))
    setFly({ lat: e.facility.latitude, lng: e.facility.longitude, zoom: 17, key: `event-${e.id}` })
  }

  const navigate = useMutation({
    mutationFn: (q: Record<string, string>) => api<{ event: SaturationEvent | null }>('/api/spillover/events/adjacent', { query: { withNeighbours: 'true', ...q } }),
    onSuccess: (r) => r.event && openEvent(r.event),
  })

  // Fly to the selected zone when it changes.
  useEffect(() => {
    if (!zoneId) return
    const z = zones.data?.items.find((x) => x.id === zoneId)
    if (z) setFly((f) => (f?.key === `event-${eventId}` ? f : { lat: z.latitude, lng: z.longitude, zoom: 17, key: `zone-${zoneId}` }))
  }, [zoneId, eventId, zones.data])

  const highlights = useMemo(() => {
    const m = new Map<string, Highlight>()
    const s = spill.data
    if (!s) return m
    for (const n of s.neighbours) m.set(n.id, 'neighbour')
    for (const a of s.alternatives) m.set(a.id, 'alternative')
    for (const w of s.warnings) m.set(w.facilityId, 'warning')
    return m
  }, [spill.data])

  const adjacentEmpty = navigate.isSuccess && navigate.data.event == null

  return (
    <AppShell>
      <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
        {/* Header + event navigation */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-2xs font-semibold tracking-[0.14em] text-data uppercase">Spillover Intelligence</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-900 md:text-3xl">Forecast pressure across neighbouring zones</h1>
            <p className="mt-1 max-w-2xl text-sm text-ink-600">
              When a zone saturates, the models estimate occupancy of its research neighbours at each forecast horizon. Warnings describe predicted parking-pressure spillover — not
              individual drivers.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => navigate.mutate({ direction: 'next' })} loading={navigate.isPending && navigate.variables?.direction === 'next' && !navigate.variables.eventId} className="bg-data hover:bg-data/90">
              <FlaskConical className="size-4" /> Research Demo
            </Button>
            <Button variant="secondary" disabled={navigate.isPending} onClick={() => navigate.mutate(eventId ? { direction: 'previous', eventId } : { direction: 'previous' })}>
              <ChevronLeft className="size-4" /> Previous event
            </Button>
            <Button variant="secondary" disabled={navigate.isPending} onClick={() => navigate.mutate(eventId ? { direction: 'next', eventId } : { direction: 'next' })}>
              Next event <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-ink-500">
          Research Demo opens the next real saturation event (with neighbouring zones) after the replay time. Events are detected in the recorded data with the research definition: saturated
          after at least 30 minutes below the threshold.
        </p>
        {adjacentEmpty && <p className="mt-2 text-sm text-ink-600">No further saturation event in that direction within the replay period.</p>}
        {navigate.isError && <p className="mt-2 text-sm text-pressure-saturated">{errorMessage(navigate.error)}</p>}

        {event.data && <EventBanner e={event.data.event} replayNow={now} />}

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          {/* Map */}
          <Card className="relative h-[420px] overflow-hidden md:h-[560px] xl:sticky xl:top-28 xl:h-[calc(100dvh-8.5rem)]">
            {stats.isError || zones.isError ? (
              <ErrorState message={errorMessage(stats.error ?? zones.error)} onRetry={() => (stats.refetch(), zones.refetch())} />
            ) : !stats.data?.bounds || !thresholds ? (
              <Skeleton className="h-full rounded-none" />
            ) : (
              <>
                <ZoneMap
                  zones={zones.data?.items ?? []}
                  bounds={stats.data.bounds}
                  thresholds={thresholds}
                  selectedId={zoneId}
                  onSelect={selectZone}
                  fly={fly}
                  highlights={zoneId ? highlights : undefined}
                  className="h-full w-full"
                />
                <div className="absolute bottom-6 left-3 z-[500] max-w-[calc(100%-1.5rem)] rounded-md border border-ink-100 bg-white/95 px-3 py-2 shadow-card">
                  <MapLegend />
                  {zoneId && (
                    <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-ink-600">
                      <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t-2 border-dashed border-ink-500" aria-hidden />Neighbour</li>
                      <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-warning" aria-hidden />Spillover warning</li>
                      <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-pressure-normal" aria-hidden />Alternative</li>
                    </ul>
                  )}
                </div>
              </>
            )}
          </Card>

          {/* Analysis */}
          <div className="min-w-0 space-y-5">
            {!zoneId ? (
              <Card>
                <EmptyState icon={<MapPin className="size-5" />} title="Select a zone or open a saturation event">
                  Click any sensor zone on the map, or use Research Demo to open a real saturation event from the recorded data.
                </EmptyState>
              </Card>
            ) : spill.isError ? (
              <Card>
                <ErrorState message={errorMessage(spill.error)} onRetry={() => spill.refetch()} />
              </Card>
            ) : !spill.data || !thresholds ? (
              <>
                <Skeleton className="h-64" />
                <Skeleton className="h-48" />
              </>
            ) : (
              <Analysis s={spill.data} thresholds={thresholds} onSelect={selectZone} />
            )}
          </div>
        </div>

        {zoneId && thresholds && (
          <PredictedVsActualSection
            zoneId={zoneId}
            anchor={event.data?.event.facility.id === zoneId ? { at: event.data.event.startedAt, label: 'Event onset' } : now ? { at: now, label: 'Replay time' } : null}
            saturation={thresholds.saturation}
            rangeEnd={replay.data?.range?.end ?? null}
          />
        )}

        <EventHistory zoneId={zoneId} activeEventId={eventId} onOpen={openEvent} />
      </div>
    </AppShell>
  )
}

function EventBanner({ e, replayNow }: { e: SaturationEvent; replayNow: string | null }) {
  const atOnset = replayNow != null && new Date(replayNow).getTime() === new Date(e.startedAt).getTime()
  return (
    <div className="animate-fade-in mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-pressure-saturated/30 bg-pressure-saturated-bg px-4 py-3 text-sm">
      <span className="inline-flex items-center gap-1.5 font-semibold text-pressure-saturated">
        <AlertTriangle className="size-4" /> Saturation event
      </span>
      <span className="font-medium text-ink-900">{e.facility.displayName}</span>
      <span className="tabular text-ink-700">Onset {formatDateTime(e.startedAt)}</span>
      <span className="tabular text-ink-700">Peak {formatPercent(e.peakOccupancy)}</span>
      <span className="tabular text-ink-700">{e.durationMinutes != null ? `Lasted ${e.durationMinutes} min` : 'Still saturated at end of data'}</span>
      <span className="text-ink-600">{e.zone.neighbourCount} research neighbours</span>
      {!atOnset && <span className="text-xs text-ink-500">Replay time has moved on from the onset.</span>}
    </div>
  )
}

function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-ink-900">{children}</h2>
      {aside}
    </div>
  )
}

function Analysis({ s, thresholds, onSelect }: { s: SpilloverData; thresholds: Thresholds; onSelect: (id: string) => void }) {
  const now = useReplayNow()
  const detail = useQuery({
    queryKey: ['zone', s.facilityId, now],
    queryFn: () => api<{ facility: ZoneDetail }>(`/api/parking/${s.facilityId}`),
    enabled: !!now,
    placeholderData: (prev) => (prev?.facility.id === s.facilityId ? prev : undefined),
  })
  const z = detail.data?.facility
  const a = s.origin.availability
  const pressure = zonePressure(a, s.origin.pressureLevel, thresholds)
  const ev = s.origin.activeSaturationEvent
  const predQ = { isPending: false, isError: false, data: s.origin.predictions } as Parameters<typeof ForecastStrip>[0]['q']

  return (
    <>
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-2xs font-medium tracking-wide text-ink-500 uppercase">Selected zone</p>
            <h2 className="mt-0.5 text-lg leading-snug font-semibold text-ink-900">{z?.displayName ?? '…'}</h2>
            <p className="mt-0.5 text-xs text-ink-500">{[z?.area, z?.zones[0]?.blockKey ? `Block ${z.zones[0].blockKey}` : null].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <PressureBadge pressure={pressure} />
            <ProvenanceBadge kind="replay" />
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto]">
          <OccupancyReadout a={a} pressure={pressure} size="lg" />
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-xs sm:text-right">
            <dt className="text-ink-500">Reading at</dt>
            <dd className="tabular text-ink-800">{formatShortDateTime(a.observedAt)}</dd>
            <dt className="text-ink-500">Threshold</dt>
            <dd className="tabular text-ink-800">{formatPercent(s.thresholds.saturation)}</dd>
            <dt className="text-ink-500">Saturation event</dt>
            <dd className="tabular text-ink-800">{ev ? `since ${formatTime(ev.startedAt)}` : 'None active'}</dd>
          </dl>
        </div>
        <div className="mt-5">
          <SectionTitle aside={<ProvenanceBadge kind="predicted" />}>Forecast</SectionTitle>
          <ForecastStrip q={predQ} thresholds={thresholds} />
        </div>
        {z && (
          <a href={directionsUrl(z.latitude, z.longitude)} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700">
            <Navigation className="size-3.5" /> Directions to this block
          </a>
        )}
      </Card>

      <Card className="p-5">
        <SectionTitle
          aside={
            <span className="text-xs text-ink-500">
              {s.neighbours.length} neighbours{s.neighbourRadiusMeters != null ? ` within ${s.neighbourRadiusMeters} m` : ''} · horizon {s.warningHorizonMinutes} min
            </span>
          }
        >
          Spillover analysis
        </SectionTitle>
        {!s.spilloverContext && (
          <p className="mb-3 rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-600">
            This zone is below high pressure at the replay time, so there is no spillover context. Neighbour forecasts are shown for reference.
          </p>
        )}
        {s.warnings.length > 0 ? (
          <ul className="mb-4 space-y-2">
            {s.warnings.map((w) => (
              <li key={w.facilityId} className="animate-fade-in flex gap-2.5 rounded-md border border-warning-border bg-warning-bg px-3 py-2.5 text-sm text-ink-800">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <span>
                  <span className="sr-only">Spillover warning: </span>
                  {w.message}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-ink-600">No neighbouring zone is predicted to rise into high pressure within {s.warningHorizonMinutes} minutes.</p>
        )}
        {s.neighbours.length === 0 ? (
          <p className="text-sm text-ink-500">This block has no research neighbours, so spillover cannot be analysed here.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-sm sm:min-w-[480px]">
              <caption className="sr-only">Neighbouring zones: current and predicted occupancy</caption>
              <thead className="text-left text-2xs tracking-wide text-ink-500 uppercase">
                <tr className="border-b border-ink-100">
                  <th className="px-5 py-2 font-medium">Neighbour</th>
                  <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">Distance</th>
                  <th className="px-2 py-2 text-right font-medium">Current</th>
                  <th className="px-5 py-2 text-right font-medium">+{s.warningHorizonMinutes} min</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {s.neighbours.map((n) => {
                  const warned = s.warnings.some((w) => w.facilityId === n.id)
                  const cur = pressureFromLevel(null, n.availability.occupancy, thresholds)
                  const pred = n.predicted ? pressureFromLevel(n.predicted.pressureLevel, n.predicted.predictedOccupancy, thresholds) : null
                  return (
                    <tr key={n.id} className={cn(warned && 'bg-warning-bg/60')}>
                      <td className="px-5 py-2">
                        <button type="button" onClick={() => onSelect(n.id)} className="text-left font-medium text-ink-900 hover:text-brand-600 hover:underline">
                          {n.displayName}
                        </button>
                        {warned && <span className="ml-2 text-2xs font-semibold text-warning uppercase">Affected</span>}
                      </td>
                      <td className="tabular hidden px-2 py-2 text-right text-ink-600 sm:table-cell">{formatDistance(n.distanceMeters)}</td>
                      <td className="tabular px-2 py-2 text-right text-ink-800" title={PRESSURE_LABEL[cur]}>
                        {formatPercent(n.availability.occupancy)}
                      </td>
                      <td className="tabular px-5 py-2 text-right font-medium text-predicted" title={pred ? PRESSURE_LABEL[pred] : undefined}>
                        {n.predicted ? formatPercent(n.predicted.predictedOccupancy) : <span className="text-xs font-normal text-ink-500">No forecast</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <SectionTitle aside={<span className="text-xs text-ink-500">ranked by predicted occupancy + 0.1 × km</span>}>
          <span className="inline-flex items-center gap-1.5">
            <Route className="size-4 text-pressure-normal" /> Alternative parking
          </span>
        </SectionTitle>
        {s.alternatives.length === 0 ? (
          <p className="text-sm text-ink-600">No neighbouring zone qualifies: every candidate is at or predicted to reach saturation, is under a spillover warning, or has no current reading.</p>
        ) : (
          <ol className="space-y-2">
            {s.alternatives.map((alt, i) => (
              <li key={alt.id} className="flex gap-3 rounded-md border border-ink-100 px-3 py-2.5">
                <span className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-pressure-normal-bg text-xs font-semibold text-pressure-normal">{i + 1}</span>
                <div className="min-w-0">
                  <button type="button" onClick={() => onSelect(alt.id)} className="text-left text-sm font-medium text-ink-900 hover:text-brand-600 hover:underline">
                    {alt.displayName}
                  </button>
                  <p className="mt-0.5 text-xs text-ink-600">{alt.reason}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-2xs text-ink-500">Zones under a spillover warning are never recommended.</p>
      </Card>
    </>
  )
}

function PredictedVsActualSection({ zoneId, anchor, saturation, rangeEnd }: { zoneId: string; anchor: { at: string; label: string } | null; saturation: number; rangeEnd: string | null }) {
  const [horizon, setHorizon] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)
  const from = anchor ? new Date(new Date(anchor.at).getTime() - PVA_BEFORE_MIN * 60_000).toISOString() : null
  const toMs = anchor ? new Date(anchor.at).getTime() + PVA_AFTER_MIN * 60_000 : 0
  const to = anchor ? new Date(rangeEnd ? Math.min(toMs, new Date(rangeEnd).getTime()) : toMs).toISOString() : null
  const q = useQuery({
    queryKey: ['pva', zoneId, from, to],
    queryFn: () => api<PredictedVsActual>('/api/analytics/predicted-vs-actual', { query: { facilityId: zoneId, from, to } }),
    enabled: !!from && !!to,
    staleTime: Infinity,
  })
  const r = q.data?.result
  const h = r?.horizons.find((x) => x.horizonMinutes === horizon) ?? r?.horizons.find((x) => x.horizonMinutes === 15) ?? r?.horizons[0]
  const missing = h ? h.points.filter((p) => p.actual == null).length : 0

  return (
    <section aria-labelledby="pva-title" className="mt-8">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="pva-title" className="text-base font-semibold text-ink-900">
              Predicted vs actual
            </h2>
            <p className="mt-0.5 text-xs text-ink-600">
              Both models’ forecasts for {r?.zoneName ?? 'this zone'}, {PVA_BEFORE_MIN} min before to {PVA_AFTER_MIN} min after the {anchor?.label.toLowerCase() ?? 'replay time'}, against the recorded
              occupancy at each target time.
            </p>
          </div>
          {r && (
            <div role="radiogroup" aria-label="Forecast horizon" className="inline-flex rounded-md border border-ink-200 bg-white p-0.5">
              {r.horizons.map((x) => (
                <button
                  key={x.horizonMinutes}
                  role="radio"
                  aria-checked={h?.horizonMinutes === x.horizonMinutes}
                  onClick={() => setHorizon(x.horizonMinutes)}
                  className={cn('rounded px-2.5 py-1 text-xs font-medium', h?.horizonMinutes === x.horizonMinutes ? 'bg-ink-900 text-white' : 'text-ink-600 hover:text-ink-900')}
                >
                  {x.horizonMinutes} min
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mt-4">
          {q.isPending ? (
            <Skeleton className="h-72" />
          ) : q.isError ? (
            <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
          ) : !r || !h ? (
            <p className="text-sm text-ink-600">{q.data?.message}</p>
          ) : (
            <>
              <PredictedVsActualChart points={h.points} models={r.models} saturation={saturation} marker={anchor} />
              <p className="mt-2 text-xs text-ink-500">
                {missing > 0 ? `${missing} target time${missing === 1 ? ' has' : 's have'} no recorded reading and ${missing === 1 ? 'is' : 'are'} left as gaps. ` : ''}
                Model B uses {r.neighboursUsed} neighbouring zone{r.neighboursUsed === 1 ? '' : 's'}. Research replay of the test period — not used for training.
              </p>
              <button type="button" onClick={() => setShowTable((v) => !v)} className="mt-2 text-xs font-medium text-brand-600 hover:text-brand-700" aria-expanded={showTable}>
                {showTable ? 'Hide' : 'Show'} data table
              </button>
              {showTable && (
                <div className="mt-2 max-h-72 overflow-auto rounded-md border border-ink-100">
                  <table className="w-full min-w-[520px] text-xs">
                    <thead className="sticky top-0 bg-ink-50 text-left text-ink-500">
                      <tr>
                        <th className="px-3 py-1.5 font-medium">Target</th>
                        <th className="px-3 py-1.5 text-right font-medium">Actual</th>
                        {r.models.map((m) => (
                          <th key={m.id} className="px-3 py-1.5 text-right font-medium">
                            {modelLabel(m.featureSet)}
                          </th>
                        ))}
                        <th className="px-3 py-1.5 text-right font-medium">Persistence</th>
                      </tr>
                    </thead>
                    <tbody className="tabular divide-y divide-ink-100">
                      {h.points.map((p) => (
                        <tr key={p.targetTime}>
                          <td className="px-3 py-1">{formatTime(p.targetTime)}</td>
                          <td className="px-3 py-1 text-right">{p.actual == null ? 'No reading' : formatPercent(p.actual)}</td>
                          {r.models.map((m) => (
                            <td key={m.id} className="px-3 py-1 text-right">
                              {formatPercent(p.predicted[m.id])}
                            </td>
                          ))}
                          <td className="px-3 py-1 text-right">{formatPercent(p.persistence)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </Card>
    </section>
  )
}

function EventHistory({ zoneId, activeEventId, onOpen }: { zoneId: string | null; activeEventId: string | null; onOpen: (e: SaturationEvent) => void }) {
  const [onlyZone, setOnlyZone] = useState(false)
  const [page, setPage] = useState(1)
  const now = useReplayNow()
  useEffect(() => setPage(1), [onlyZone, zoneId])
  const filterZone = onlyZone && zoneId ? zoneId : undefined
  const q = useQuery({
    queryKey: ['events', filterZone, page, now],
    queryFn: () => api<EventList>('/api/spillover/events', { query: { facilityId: filterZone, page, pageSize: 10 } }),
    enabled: !!now,
    placeholderData: (prev) => prev,
  })
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1

  return (
    <section aria-labelledby="events-title" className="mt-8">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="events-title" className="inline-flex items-center gap-2 text-base font-semibold text-ink-900">
              <History className="size-4 text-ink-500" /> Saturation Event History
            </h2>
            <p className="mt-0.5 text-xs text-ink-600">{q.data ? `${q.data.total.toLocaleString('en-AU')} events` : '…'} detected in the replayed test period, newest first.</p>
          </div>
          {zoneId && (
            <label className="inline-flex items-center gap-2 text-xs text-ink-700">
              <input type="checkbox" checked={onlyZone} onChange={(e) => setOnlyZone(e.target.checked)} className="size-4 rounded border-ink-300" />
              Only the selected zone
            </label>
          )}
        </div>
        {q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <Skeleton className="mt-4 h-60" />
        ) : q.data.items.length === 0 ? (
          <p className="mt-4 text-sm text-ink-600">No saturation event for this selection.</p>
        ) : (
          <div className="-mx-5 mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-2xs tracking-wide text-ink-500 uppercase">
                <tr className="border-b border-ink-100">
                  <th className="px-5 py-2 font-medium">Zone</th>
                  <th className="px-2 py-2 font-medium">Onset</th>
                  <th className="px-2 py-2 text-right font-medium">Peak</th>
                  <th className="px-2 py-2 text-right font-medium">Duration</th>
                  <th className="px-2 py-2 text-right font-medium">Neighbours</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {q.data.items.map((e) => (
                  <tr key={e.id} className={cn(e.id === activeEventId && 'bg-brand-50')}>
                    <td className="px-5 py-2">
                      <span className="font-medium text-ink-900">{e.facility.displayName}</span>
                      {e.activeAtReplayTime && <span className="ml-2 text-2xs font-semibold text-pressure-saturated uppercase">Active now</span>}
                    </td>
                    <td className="tabular px-2 py-2 text-ink-700">{formatShortDateTime(e.startedAt)}</td>
                    <td className="tabular px-2 py-2 text-right text-ink-700">{formatPercent(e.peakOccupancy)}</td>
                    <td className="tabular px-2 py-2 text-right text-ink-700">{e.durationMinutes != null ? `${e.durationMinutes} min` : 'Ongoing at end'}</td>
                    <td className="tabular px-2 py-2 text-right text-ink-700">{e.zone.neighbourCount}</td>
                    <td className="px-5 py-2 text-right">
                      <Button size="sm" variant="secondary" onClick={() => onOpen(e)}>
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {q.data && pages > 1 && (
          <div className="mt-3 flex items-center justify-end gap-2 text-xs text-ink-600">
            <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="size-3.5" /> Newer
            </Button>
            <span className="tabular">
              Page {page} of {pages.toLocaleString('en-AU')}
            </span>
            <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Older <ChevronRight className="size-3.5" />
            </Button>
          </div>
        )}
        <p className="mt-3 text-2xs text-ink-500">
          Opening an event moves the shared replay clock to its onset. See the <Link to="/research" className="underline">research page</Link> for how events are defined.
        </p>
      </Card>
    </section>
  )
}

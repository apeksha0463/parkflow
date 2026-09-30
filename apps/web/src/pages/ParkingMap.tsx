import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, Crosshair, LocateFixed, MapPinned, Navigation, X } from 'lucide-react'
import { AppShell } from '../components/layout/AppShell'
import { MapLegend, ZoneMap, type Bbox, type FlyTarget, type Highlight } from '../components/map/ZoneMap'
import { SearchBox } from '../components/search/SearchBox'
import { ProvenanceBadge, PressureBadge } from '../components/ui/Badges'
import { Button } from '../components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '../components/ui/primitives'
import { ForecastStrip, OccupancyReadout, useReplayNow, useZonePredictions, zonePressure, ZoneCard } from '../components/zones/ZoneParts'
import { api, errorMessage } from '../lib/api'
import { directionsUrl, formatDateTime, formatPercent } from '../lib/format'
import { useMapZones, useThresholds } from '../lib/hooks'
import type { Thresholds } from '../lib/pressure'
import type { SearchResult, ZoneDetail, ZoneList } from '../lib/types'

const PAGE = 12
const SEARCH_RADIUS_M = 600

type Scope = { kind: 'area'; bbox: Bbox } | { kind: 'near'; lat: number; lng: number; label: string }

export default function ParkingMap() {
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('zone')
  const thresholds = useThresholds()
  const now = useReplayNow()
  const { stats, zones } = useMapZones()

  const [scope, setScope] = useState<Scope | null>(null)
  const [viewBbox, setViewBbox] = useState<Bbox | null>(null)
  const [fly, setFly] = useState<FlyTarget | null>(null)
  const [pin, setPin] = useState<[number, number] | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const [locating, setLocating] = useState(false)
  const [locError, setLocError] = useState<string | null>(null)

  // The list follows the first map view until the user searches or asks for another area.
  useEffect(() => {
    if (!scope && viewBbox) setScope({ kind: 'area', bbox: viewBbox })
  }, [scope, viewBbox])
  useEffect(() => setLimit(PAGE), [scope])

  const list = useQuery({
    queryKey: ['zones', scope, now],
    queryFn: () =>
      api<ZoneList>('/api/parking', {
        query:
          scope!.kind === 'area'
            ? { bbox: scope!.bbox.join(','), sort: 'name', pageSize: 100 }
            : { lat: scope!.lat, lng: scope!.lng, radius: SEARCH_RADIUS_M, sort: 'distance', pageSize: 100 },
      }),
    enabled: !!scope && !!now,
    placeholderData: (prev) => prev,
  })

  const select = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('zone', id)
    else next.delete('zone')
    setParams(next, { replace: true })
    if (id) {
      const z = zones.data?.items.find((x) => x.id === id)
      if (z) setFly({ lat: z.latitude, lng: z.longitude, key: `zone-${id}` })
      requestAnimationFrame(() => document.getElementById(`zone-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
    }
  }

  const onSearch = (r: SearchResult) => {
    setPin([r.latitude, r.longitude])
    setFly({ lat: r.latitude, lng: r.longitude, zoom: 17, key: `search-${r.id}` })
    setScope({ kind: 'near', lat: r.latitude, lng: r.longitude, label: r.label })
    if (r.kind === 'zone') select(r.id.replace(/^zone:/, ''))
  }

  const locate = () => {
    if (!navigator.geolocation) return setLocError('Location is not available in this browser.')
    setLocating(true)
    setLocError(null)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false)
        onSearch({ id: `me-${Date.now()}`, label: 'My location', sublabel: null, latitude: p.coords.latitude, longitude: p.coords.longitude, kind: 'place', source: 'browser' })
      },
      () => {
        setLocating(false)
        setLocError('Could not get your location.')
      },
      { timeout: 8000 },
    )
  }

  const scopeBboxKey = scope?.kind === 'area' ? scope.bbox.join(',') : null
  const moved = viewBbox != null && viewBbox.join(',') !== scopeBboxKey

  const neighbours = useQuery({
    queryKey: ['neighbours', selectedId, now],
    queryFn: () => api<{ items: { id: string }[] }>(`/api/parking/${selectedId}/neighbours`),
    enabled: !!selectedId && !!now,
  })
  const highlights = useMemo(() => new Map<string, Highlight>((neighbours.data?.items ?? []).map((n) => [n.id, 'neighbour'])), [neighbours.data])

  // Zones with a reading first (highest occupancy first); zones without a reading at this time last.
  const items = useMemo(() => {
    const all = list.data?.items ?? []
    if (scope?.kind === 'near') return all
    return [...all].sort((a, b) => (b.availability.occupancy ?? -1) - (a.availability.occupancy ?? -1))
  }, [list.data, scope])

  return (
    <AppShell fill>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Panel */}
        <section aria-label="Sensor zones" className="order-2 flex min-h-0 flex-col border-ink-100 bg-ink-25 lg:order-1 lg:w-[420px] lg:shrink-0 lg:border-r">
          <div className="space-y-2 border-b border-ink-100 bg-white p-4">
            <h1 className="text-lg font-semibold text-ink-900">Parking Map</h1>
            <SearchBox onSelect={onSearch} />
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Button variant="ghost" size="sm" onClick={locate} loading={locating}>
                <LocateFixed className="size-3.5" /> My location
              </Button>
              {scope?.kind === 'near' && (
                <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-ink-700">
                  Within {SEARCH_RADIUS_M} m of {scope.label}
                  <button
                    type="button"
                    aria-label="Clear search area"
                    className="rounded-full p-0.5 hover:bg-ink-200"
                    onClick={() => {
                      setPin(null)
                      if (viewBbox) setScope({ kind: 'area', bbox: viewBbox })
                    }}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              )}
              {locError && <span className="text-pressure-saturated">{locError}</span>}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {selectedId && thresholds && <SelectedZone id={selectedId} thresholds={thresholds} onClose={() => select(null)} />}

            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-ink-900">{scope?.kind === 'near' ? 'Nearest sensor zones' : 'Sensor zones in view'}</h2>
              {list.data && <span className="tabular text-xs text-ink-500">{list.data.total} zones</span>}
            </div>
            {list.isError ? (
              <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
            ) : !list.data || !thresholds ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-40" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <EmptyState icon={<MapPinned className="size-5" />} title="No sensor zones here">
                {scope?.kind === 'near' ? `No monitored zone within ${SEARCH_RADIUS_M} m of this place.` : 'Move the map towards the monitored area and search this area.'}
              </EmptyState>
            ) : (
              <div className="space-y-3">
                {items.slice(0, limit).map((z) => (
                  <ZoneCard key={z.id} zone={z} thresholds={thresholds} selected={z.id === selectedId} onSelect={select} />
                ))}
                {items.length > limit && (
                  <Button variant="secondary" size="sm" className="w-full" onClick={() => setLimit((l) => l + PAGE)}>
                    Show more ({items.length - limit} more)
                  </Button>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Map */}
        <section aria-label="Map" className="relative order-1 h-[52vh] min-h-[320px] lg:order-2 lg:h-auto lg:flex-1">
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
                selectedId={selectedId}
                onSelect={select}
                onBoundsChange={setViewBbox}
                fly={fly}
                searchPin={pin}
                highlights={selectedId ? highlights : undefined}
                className="h-full w-full"
              />
              {moved && (
                <div className="pointer-events-none absolute inset-x-0 top-3 z-[500] flex justify-center">
                  <Button size="sm" className="pointer-events-auto shadow-pop" onClick={() => viewBbox && (setPin(null), setScope({ kind: 'area', bbox: viewBbox }))}>
                    <Crosshair className="size-3.5" /> Search this area
                  </Button>
                </div>
              )}
              <div className="absolute bottom-6 left-3 z-[500] rounded-md border border-ink-100 bg-white/95 px-3 py-2 shadow-card">
                <MapLegend />
                {selectedId && <p className="mt-1 text-2xs text-ink-500">Dashed links: research neighbours (≤ {stats.data.model.neighbourRadiusMeters ?? '—'} m)</p>}
              </div>
            </>
          )}
        </section>
      </div>
    </AppShell>
  )
}

function SelectedZone({ id, thresholds, onClose }: { id: string; thresholds: Thresholds; onClose: () => void }) {
  const now = useReplayNow()
  const detail = useQuery({
    queryKey: ['zone', id, now],
    queryFn: () => api<{ facility: ZoneDetail; at: string }>(`/api/parking/${id}`),
    enabled: !!now,
    placeholderData: (prev) => (prev?.facility.id === id ? prev : undefined),
  })
  const preds = useZonePredictions(id)

  if (detail.isError) return <ErrorState message={errorMessage(detail.error)} onRetry={() => detail.refetch()} />
  if (!detail.data) return <Skeleton className="mb-4 h-72" />
  const z = detail.data.facility
  const a = z.availability
  const pressure = zonePressure(a, z.pressureLevel, thresholds)
  const blockKey = z.zones[0]?.blockKey

  return (
    <article aria-label="Selected zone" className="animate-fade-in mb-5 rounded-lg border border-ink-900 bg-white p-4 shadow-pop">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xs font-medium tracking-wide text-ink-500 uppercase">Selected zone</p>
          <h2 className="mt-0.5 text-base leading-snug font-semibold text-ink-900">{z.displayName}</h2>
          <p className="mt-0.5 text-xs text-ink-500">{[z.area, blockKey ? `Block ${blockKey}` : null].filter(Boolean).join(' · ')}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close zone details" className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
          <X className="size-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <PressureBadge pressure={pressure} />
        <ProvenanceBadge kind="replay" />
      </div>
      <div className="mt-3">
        <OccupancyReadout a={a} pressure={pressure} size="lg" />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-ink-500">Reading at</dt>
        <dd className="tabular text-right text-ink-800">{formatDateTime(a.observedAt)}</dd>
        <dt className="text-ink-500">Saturation threshold</dt>
        <dd className="tabular text-right text-ink-800">{formatPercent(thresholds.saturation)}</dd>
        <dt className="text-ink-500">Sensors on block</dt>
        <dd className="tabular text-right text-ink-800">{z.capacity ?? '—'}</dd>
      </dl>

      <div className="mt-4">
        <p className="mb-1.5 text-2xs font-medium tracking-wide text-ink-500 uppercase">Forecast</p>
        <ForecastStrip q={preds} thresholds={thresholds} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link to={`/spillover?zone=${z.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-ink-900 px-3 text-sm font-medium text-white hover:bg-ink-800">
          Spillover intelligence <ArrowRight className="size-3.5" />
        </Link>
        <a
          href={directionsUrl(z.latitude, z.longitude)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-ink-200 bg-white px-3 text-sm font-medium text-ink-800 hover:bg-ink-50"
        >
          <Navigation className="size-3.5" /> Directions
        </a>
      </div>
    </article>
  )
}

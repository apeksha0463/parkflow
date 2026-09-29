import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Info, List, LocateFixed, Map as MapIcon, MapPin, Navigation, RefreshCw, SearchX, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../auth/AuthContext'
import { AppHeader } from '../components/layout/AppHeader'
import { MapView, type Bbox } from '../components/map/MapView'
import { FacilityCard } from '../components/parking/FacilityCard'
import { PredictionLine, SpilloverPanel } from '../components/parking/Prediction'
import { DEFAULT_FILTERS, FilterBar, filterQuery, type FilterState, type SortKey } from '../components/parking/Filters'
import { SearchBox } from '../components/search/SearchBox'
import { Button } from '../components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '../components/ui/primitives'
import { api, errorMessage } from '../lib/api'
import { cn } from '../lib/cn'
import { directionsUrl } from '../lib/format'
import { useThresholds } from '../lib/hooks'
import type { StatusThresholds } from '../lib/status'
import type { Facility, FacilityDetail, FacilityList, MapMarker, ParkingType, SearchResult } from '../lib/types'

const PAGE_SIZE = 20

function readFilters(p: URLSearchParams): FilterState {
  return {
    types: (p.get('types')?.split(',').filter(Boolean) as ParkingType[]) ?? [],
    openNow: p.get('open') === '1',
    ev: p.get('ev') === '1',
    free: p.get('free') === '1',
    hasAvailability: p.get('avail') === '1',
    radius: Number(p.get('r')) || DEFAULT_FILTERS.radius,
    sort: (p.get('sort') as SortKey) || DEFAULT_FILTERS.sort,
  }
}

function writeFilters(p: URLSearchParams, f: FilterState) {
  const set = (k: string, v: string | null) => (v ? p.set(k, v) : p.delete(k))
  set('types', f.types.join(','))
  set('open', f.openNow ? '1' : null)
  set('ev', f.ev ? '1' : null)
  set('free', f.free ? '1' : null)
  set('avail', f.hasAvailability ? '1' : null)
  set('r', f.radius !== DEFAULT_FILTERS.radius ? String(f.radius) : null)
  set('sort', f.sort !== DEFAULT_FILTERS.sort ? f.sort : null)
}

/** Parses "w,s,e,n" from the URL (area search). */
function readBbox(v: string | null): Bbox | null {
  const b = v?.split(',').map(Number)
  return b && b.length === 4 && b.every(Number.isFinite) && b[0] < b[2] && b[1] < b[3] ? (b as Bbox) : null
}

/** True when the visible map has moved away from what the list currently shows (by > 25% of the view). */
export function viewMovedAway(view: Bbox, listCenter: [number, number] | null): boolean {
  if (!listCenter) return true
  const [w, s, e, n] = view
  const dx = Math.abs((w + e) / 2 - listCenter[1]) / (e - w)
  const dy = Math.abs((s + n) / 2 - listCenter[0]) / (n - s)
  return dx > 0.25 || dy > 0.25
}

/** Rounds a bbox outward so tiny pans reuse the cached marker query. */
const roundBbox = (b: Bbox): Bbox => [Math.floor(b[0] * 50) / 50, Math.floor(b[1] * 50) / 50, Math.ceil(b[2] * 50) / 50, Math.ceil(b[3] * 50) / 50]

export default function Explore() {
  const [params, setParams] = useSearchParams()
  const { user } = useAuth()
  const thresholds = useThresholds()
  const filters = useMemo(() => readFilters(params), [params])
  const lat = params.get('lat') ? Number(params.get('lat')) : null
  const lng = params.get('lng') ? Number(params.get('lng')) : null
  const label = params.get('label') ?? ''
  const areaBbox = readBbox(params.get('bbox'))
  const areaCenter: [number, number] | null = areaBbox ? [(areaBbox[1] + areaBbox[3]) / 2, (areaBbox[0] + areaBbox[2]) / 2] : null
  const pointDestination: [number, number] | null = lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng) ? [lat, lng] : null
  // The list is centred on the searched point, or on the map area the user chose with "Search this area".
  const destination = areaCenter ?? pointDestination
  const selectedId = params.get('sel')
  const [bbox, setBbox] = useState<Bbox | null>(null)
  const [viewZoom, setViewZoom] = useState(12)
  const [focus, setFocus] = useState<{ center: [number, number]; key: string } | null>(null)
  const [locating, setLocating] = useState(false)
  // The floating preview opens on an explicit click (marker or result), not on hover.
  const [previewOpen, setPreviewOpen] = useState(false)
  const focusSeq = useRef(0)
  const [mobileView, setMobileView] = useState<'map' | 'list'>('list')
  const listRef = useRef<HTMLDivElement>(null)

  const update = useCallback(
    (fn: (p: URLSearchParams) => void, replace = true) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          fn(next)
          return next
        },
        { replace },
      )
    },
    [setParams],
  )

  const goTo = (latitude: number, longitude: number, text: string) => {
    setFocus(null)
    update((p) => {
      p.set('lat', latitude.toFixed(6))
      p.set('lng', longitude.toFixed(6))
      p.set('label', text)
      p.delete('bbox')
      p.delete('sel')
    }, false)
  }

  const onSelectDestination = (r: SearchResult) => {
    goTo(r.latitude, r.longitude, r.label)
    setMobileView('list')
    if (user) {
      api('/api/search/recent', { method: 'POST', body: { query: r.label, latitude: r.latitude, longitude: r.longitude } }).catch(() => undefined)
    }
  }

  const clearDestination = () =>
    update((p) => {
      p.delete('lat')
      p.delete('lng')
      p.delete('label')
      p.delete('bbox')
      p.delete('sel')
    }, false)

  /** List parking inside the visible map, without moving the map. */
  const searchThisArea = () => {
    if (!bbox) return
    setFocus(null)
    update((p) => {
      p.set('bbox', bbox.map((v) => v.toFixed(5)).join(','))
      p.set('label', 'this map area')
      p.delete('lat')
      p.delete('lng')
      p.delete('sel')
    }, false)
  }

  const useMyLocation = () => {
    if (!('geolocation' in navigator)) {
      toast.error('Location is not available in this browser. Search for a destination instead.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        goTo(pos.coords.latitude, pos.coords.longitude, 'Your location')
      },
      (err) => {
        setLocating(false)
        toast.error(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied. Search for a destination instead.'
            : 'Could not get your location. Search for a destination instead.',
        )
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    )
  }

  const focusFacility = (f: Facility) => {
    focusSeq.current += 1
    setFocus({ center: [f.latitude, f.longitude], key: `sel:${f.id}:${focusSeq.current}` })
    setPreviewOpen(true)
    select(f.id)
  }

  const select = useCallback((id: string | null) => update((p) => (id ? p.set('sel', id) : p.delete('sel'))), [update])

  const markers = useQuery({
    queryKey: ['markers', bbox && roundBbox(bbox), filterQuery(filters)],
    queryFn: ({ signal }) => api<{ items: MapMarker[]; truncated: boolean }>('/api/parking/map', { query: { bbox: roundBbox(bbox!).join(','), ...filterQuery(filters) }, signal }),
    enabled: !!bbox,
    placeholderData: keepPreviousData,
  })

  const list = useInfiniteQuery({
    queryKey: ['parking', destination, areaBbox, filters],
    queryFn: ({ pageParam, signal }) =>
      api<FacilityList>('/api/parking', {
        query: {
          lat: destination![0],
          lng: destination![1],
          // Area search: everything inside the chosen bounds (radius at its maximum so the box decides).
          ...(areaBbox ? { bbox: areaBbox.join(','), radius: 10_000 } : { radius: filters.radius }),
          sort: filters.sort,
          page: pageParam,
          pageSize: PAGE_SIZE,
          ...filterQuery(filters),
        },
        signal,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    enabled: !!destination,
  })

  const facilities = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data])
  const total = list.data?.pages[0]?.total ?? 0
  const withCurrentData = facilities.filter((f) => f.availability.state === 'LIVE' || f.availability.state === 'SIMULATED').length

  // Keep the selected card visible when a marker is clicked (not when hovering cards).
  const selectedFromMap = useRef(false)
  useEffect(() => {
    if (!selectedId || !selectedFromMap.current) return
    selectedFromMap.current = false
    listRef.current?.querySelector(`[data-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  const selectedFacility = facilities.find((f) => f.id === selectedId)
  const zoom = pointDestination ? (filters.radius <= 1000 ? 15 : filters.radius <= 2000 ? 14 : 13) : 12
  // Where the map should fly: a focused list item, else the searched point. Area search never moves the map.
  const view = focus
    ? { center: focus.center, zoom: Math.max(viewZoom, 16), key: focus.key }
    : areaBbox
      ? { center: undefined, zoom: viewZoom, key: 'area' }
      : { center: pointDestination ?? undefined, zoom, key: pointDestination ? `${pointDestination[0]},${pointDestination[1]}` : 'city' }
  const showSearchArea = !!bbox && viewZoom >= 13 && viewMovedAway(bbox, destination)

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader />
      <div className="relative flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside
          className={cn(
            'flex w-full flex-col border-r border-ink-100 bg-ink-25 md:w-[420px] md:shrink-0 lg:w-[440px]',
            mobileView === 'map' && 'hidden md:flex',
          )}
          aria-label="Search and results"
        >
          <div className="space-y-3 border-b border-ink-100 bg-white p-4">
            {/* key resets the input when the destination changes via URL (back/forward) */}
            <SearchBox key={label} onSelect={onSelectDestination} initialValue={label} />
            <FilterBar value={filters} onChange={(f) => update((p) => writeFilters(p, f))} hasDestination={!!destination} />
          </div>

          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
            {!destination ? (
              <div className="p-4">
                <EmptyState icon={<MapPin className="size-5" />} title="Where are you heading?">
                  Search an area, street or landmark in Bengaluru to see parking around it. The map shows every mapped facility in view.
                </EmptyState>
                <DataNote />
              </div>
            ) : list.isError ? (
              <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
            ) : list.isPending ? (
              <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading parking">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-28 w-full" />
                ))}
              </div>
            ) : facilities.length === 0 ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title="No parking found here"
                action={
                  <div className="flex gap-2">
                    {filters.radius < 5000 && (
                      <Button variant="secondary" size="sm" onClick={() => update((p) => writeFilters(p, { ...filters, radius: 5000 }))}>
                        Widen to 5 km
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => update((p) => writeFilters(p, { ...DEFAULT_FILTERS, radius: filters.radius }))}>
                      Clear filters
                    </Button>
                  </div>
                }
              >
                No mapped facilities match these filters within {filters.radius < 1000 ? `${filters.radius} m` : `${filters.radius / 1000} km`} of {label || 'this location'}. Parking coverage in the
                directory is incomplete.
              </EmptyState>
            ) : (
              <div className="p-4">
                <div className="mb-3 flex items-baseline justify-between gap-2">
                  <p className="text-sm text-ink-600">
                    <span className="tabular font-semibold text-ink-900">{total}</span> {total === 1 ? 'facility' : 'facilities'} near{' '}
                    <span className="font-medium text-ink-900">{label || 'destination'}</span>
                  </p>
                  <button onClick={clearDestination} className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-800">
                    <X className="size-3" /> Clear
                  </button>
                </div>
                {withCurrentData === 0 && (
                  <p className="mb-3 flex gap-2 rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-600">
                    <Info className="mt-px size-3.5 shrink-0" />
                    None of these facilities has a current availability source. Locations and details come from the parking directory.
                  </p>
                )}
                <ul className="space-y-2.5">
                  {facilities.map((f) => (
                    <li key={f.id} data-id={f.id}>
                      <FacilityCard
                        facility={f}
                        selected={f.id === selectedId}
                        onSelect={(id) => id !== selectedId && select(id)}
                        onFocus={focusFacility}
                        thresholds={thresholds}
                      />
                    </li>
                  ))}
                </ul>
                {list.hasNextPage && (
                  <Button variant="secondary" className="mt-4 w-full" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
                    Show more ({total - facilities.length} remaining)
                  </Button>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* Map */}
        <section className={cn('relative min-w-0 flex-1', mobileView === 'list' && 'hidden md:block')} aria-label="Parking map">
          <MapView
            className="h-full w-full"
            markers={markers.data?.items ?? []}
            selectedId={selectedId}
            onMarkerClick={(id) => {
              selectedFromMap.current = true
              setPreviewOpen(true)
              select(id)
            }}
            onBoundsChange={(b, z) => {
              setBbox(b)
              setViewZoom(z)
            }}
            center={view.center}
            zoom={view.zoom}
            flyKey={view.key}
            destination={pointDestination}
            radiusMeters={pointDestination && !areaBbox ? filters.radius : null}
            thresholds={thresholds}
          />
          {showSearchArea && (
            <div className="absolute top-3 left-1/2 z-[1000] -translate-x-1/2">
              <Button size="sm" className="rounded-full shadow-pop" onClick={searchThisArea}>
                <RefreshCw className="size-3.5" /> Search this area
              </Button>
            </div>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="absolute bottom-24 left-3 z-[1000] rounded-full shadow-pop md:bottom-5"
            onClick={useMyLocation}
            loading={locating}
            aria-label="Use my location"
          >
            <LocateFixed className="size-4" /> <span className="hidden sm:inline">Use my location</span>
          </Button>
          <MapLegend count={markers.data?.items.length} loading={markers.isFetching} error={markers.isError} />
          {selectedId && (previewOpen || !selectedFacility) && (
            <SelectedPreview
              id={selectedId}
              inList={selectedFacility}
              onClose={() => {
                setPreviewOpen(false)
                select(null)
              }}
              thresholds={thresholds}
            />
          )}
        </section>

        {/* Mobile view toggle */}
        <div className="absolute bottom-5 left-1/2 z-[1000] -translate-x-1/2 md:hidden">
          <Button className="rounded-full shadow-pop" onClick={() => setMobileView((v) => (v === 'map' ? 'list' : 'map'))}>
            {mobileView === 'map' ? (
              <>
                <List className="size-4" /> List{destination ? ` (${total})` : ''}
              </>
            ) : (
              <>
                <MapIcon className="size-4" /> Map
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Floating card for a marker selected on the map (loads details if it isn't in the result list). */
function SelectedPreview({ id, inList, onClose, thresholds }: { id: string; inList?: Facility; onClose: () => void; thresholds: StatusThresholds }) {
  const detail = useQuery({
    queryKey: ['facility', id],
    queryFn: () => api<{ facility: FacilityDetail }>(`/api/parking/${id}`),
    enabled: !inList,
  })
  const facility = inList ?? detail.data?.facility
  return (
    <div className="absolute inset-x-3 bottom-20 z-[1000] md:bottom-5 md:left-5 md:right-auto md:w-[380px]">
      <div className="relative rounded-lg shadow-pop">
        {facility ? (
          <FacilityCard
            facility={facility}
            selected
            thresholds={thresholds}
            footer={
              <div className="space-y-2.5">
                <PredictionLine facility={facility} />
                <SpilloverPanel facility={facility} compact />
                <div className="flex gap-2">
                  <Link
                    to={`/parking/${facility.id}`}
                    className="inline-flex h-8 items-center rounded-md bg-brand-600 px-3 text-xs font-semibold text-white hover:bg-brand-700"
                  >
                    View details
                  </Link>
                  <a
                    href={directionsUrl(facility.latitude, facility.longitude)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-ink-200 bg-white px-3 text-xs font-semibold text-ink-700 hover:bg-ink-50"
                  >
                    <Navigation className="size-3.5" /> Directions
                  </a>
                </div>
              </div>
            }
          />
        ) : detail.isError ? (
          <div className="rounded-lg bg-white p-4 text-sm text-status-full">{errorMessage(detail.error)}</div>
        ) : (
          <Skeleton className="h-28 w-full bg-white" />
        )}
        <button onClick={onClose} aria-label="Close preview" className="absolute -top-2.5 -right-2.5 z-10 grid size-7 place-items-center rounded-full border border-ink-100 bg-white text-ink-500 shadow-card hover:text-ink-800">
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

function MapLegend({ count, loading, error }: { count?: number; loading: boolean; error: boolean }) {
  return (
    <div className="pointer-events-none absolute top-3 right-3 z-[1000] max-w-[220px] rounded-lg border border-ink-100 bg-white/95 p-3 text-xs shadow-card backdrop-blur">
      <p className="mb-2 font-semibold text-ink-800">
        {error ? 'Map data unavailable' : loading && count == null ? 'Loading…' : `${count ?? 0} facilities in view`}
      </p>
      <ul className="space-y-1.5 text-ink-600">
        <li className="flex items-center gap-2">
          <span className="size-3 rounded-full border-2 border-ink-500 bg-white" /> Availability unknown
        </li>
        <li className="flex items-center gap-2">
          <span className="size-3 rounded-full bg-status-available" /> Available
        </li>
        <li className="flex items-center gap-2">
          <span className="size-3 rounded-full bg-status-moderate" /> Moderate
        </li>
        <li className="flex items-center gap-2">
          <span className="size-3 rounded-full bg-status-nearly-full" /> Nearly full
        </li>
        <li className="flex items-center gap-2">
          <span className="size-3 rounded-full bg-status-full" /> Full
        </li>
        <li className="flex items-center gap-2">
          <span className="size-3 rounded-full border-2 border-dashed border-ink-500 bg-white" /> Demo (simulation)
        </li>
      </ul>
    </div>
  )
}

function DataNote() {
  return (
    <div className="mt-2 rounded-lg border border-ink-100 bg-white p-4 text-xs leading-relaxed text-ink-600">
      <p className="mb-1 font-semibold text-ink-800">About this data</p>
      Parking locations come from OpenStreetMap. Current availability is shown only where a real source exists; otherwise we say it’s unavailable rather than guess. Demo facilities
      that replay historical data are marked <span className="font-medium text-status-simulated">Simulated</span>.
    </div>
  )
}

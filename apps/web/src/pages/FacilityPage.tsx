import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, BatteryCharging, Clock, Database, ExternalLink, Info, LineChart, MapPin, Navigation, Sparkles } from 'lucide-react'
import { AppFooter, AppHeader } from '../components/layout/AppHeader'
import { MapView } from '../components/map/MapView'
import { AvailabilityPanel } from '../components/parking/Availability'
import { FacilityCard } from '../components/parking/FacilityCard'
import { TypeIcon } from '../components/parking/meta'
import { ProvenanceBadge } from '../components/ui/Badges'
import { buttonClass } from '../components/ui/Button'
import { Card, EmptyState, ErrorState, Skeleton } from '../components/ui/primitives'
import { api, ApiError, errorMessage } from '../lib/api'
import { formatDate, formatDistance, VEHICLE_LABEL } from '../lib/format'
import { useThresholds } from '../lib/hooks'
import type { Facility, FacilityDetail } from '../lib/types'

export default function FacilityPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const thresholds = useThresholds()
  const q = useQuery({ queryKey: ['facility', id], queryFn: () => api<{ facility: FacilityDetail }>(`/api/parking/${id}`) })
  const neighbours = useQuery({
    queryKey: ['facility', id, 'neighbours'],
    queryFn: () => api<{ radiusMeters: number; method: string; items: Facility[] }>(`/api/parking/${id}/neighbours`, { query: { limit: 6 } }),
    enabled: q.isSuccess,
  })

  if (q.isPending) {
    return (
      <Shell>
        <Skeleton className="h-8 w-72" />
        <Skeleton className="mt-3 h-4 w-48" />
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </Shell>
    )
  }
  if (q.isError) {
    const missing = q.error instanceof ApiError && q.error.status === 404
    return (
      <Shell>
        <Card>
          {missing ? (
            <EmptyState
              icon={<MapPin className="size-5" />}
              title="Parking facility not found"
              action={
                <Link to="/explore" className={buttonClass('secondary', 'sm')}>
                  Explore parking
                </Link>
              }
            >
              It may have been removed from the directory.
            </EmptyState>
          ) : (
            <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
          )}
        </Card>
      </Shell>
    )
  }

  const f = q.data.facility
  const directions = `https://www.openstreetmap.org/directions?to=${f.latitude}%2C${f.longitude}#map=17/${f.latitude}/${f.longitude}`

  return (
    <Shell>
      <button onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/explore'))} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-800">
        <ArrowLeft className="size-4" /> Back
      </button>

      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
            <TypeIcon type={f.type} className="size-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{f.displayName}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-500">
              <span className="font-medium text-ink-700">{f.typeLabel}</span>
              {f.area && <span>· {f.area}</span>}
              {f.openNow === true && <span className="text-status-available">· Open now</span>}
              {f.openNow === false && <span className="text-status-full">· Closed now</span>}
              {f.isDemo && <ProvenanceBadge kind="simulated" />}
            </p>
            {f.nameIsDerived && (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-ink-400">
                <Info className="size-3" /> The source has no name for this facility; this label is derived from its type and area.
              </p>
            )}
          </div>
        </div>
        <a href={directions} target="_blank" rel="noreferrer" className={buttonClass('primary', 'md', 'shrink-0')}>
          <Navigation className="size-4" /> Directions
        </a>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <AvailabilityPanel availability={f.availability} thresholds={thresholds} />
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                <Sparkles className="size-4 text-status-predicted" /> Predicted occupancy
              </h2>
              <ProvenanceBadge kind="predicted" />
            </div>
            <div className="mt-3 rounded-md border border-dashed border-ink-200 bg-ink-25 px-4 py-5 text-center">
              <p className="text-sm font-medium text-ink-700">Prediction unavailable — insufficient historical data.</p>
              <p className="mt-1 text-xs text-ink-500">Short-term forecasts need a recent occupancy history for this facility. None is recorded.</p>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
              <LineChart className="size-4 text-ink-400" /> Historical occupancy
            </h2>
            <p className="mt-3 text-sm text-ink-500">No historical occupancy has been recorded for this facility.</p>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-ink-900">Facility details</h2>
            <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Detail label="Parking type" value={f.typeLabel} />
              <Detail label="Capacity" value={f.capacity != null ? `${f.capacity} spaces` : null} />
              <Detail label="Pricing" value={f.pricingText} />
              <Detail label="Operating hours" value={f.operatingHours} mono />
              <Detail label="Vehicle types" value={f.vehicleTypes.length ? f.vehicleTypes.map((v) => VEHICLE_LABEL[v]).join(', ') : null} />
              <Detail
                label="EV charging"
                value={
                  f.evCharging == null ? null : f.evCharging ? (
                    <span className="inline-flex items-center gap-1 text-status-available">
                      <BatteryCharging className="size-4" /> Available
                    </span>
                  ) : (
                    'Not available'
                  )
                }
              />
              <Detail label="Address" value={f.address} />
              <Detail label="Coordinates" value={`${f.latitude.toFixed(5)}, ${f.longitude.toFixed(5)}`} mono />
            </dl>
            {f.zones.length > 1 && (
              <div className="mt-5 border-t border-ink-100 pt-4">
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-500 uppercase">Zones</h3>
                <ul className="divide-y divide-ink-100 text-sm">
                  {f.zones.map((z) => (
                    <li key={z.id} className="flex justify-between py-2">
                      <span className="text-ink-800">{z.name}</span>
                      <span className="text-ink-500">{z.capacity != null ? `${z.capacity} spaces` : 'Capacity unknown'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </div>

        {/* Side column */}
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <MapView
              className="h-56 w-full"
              markers={[{ id: f.id, latitude: f.latitude, longitude: f.longitude, type: f.type, isDemo: f.isDemo, availabilityState: f.availability.state, occupancy: f.availability.occupancy }]}
              selectedId={f.id}
              center={[f.latitude, f.longitude]}
              zoom={16}
              flyKey={f.id}
              thresholds={thresholds}
            />
          </Card>

          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
              <Database className="size-4 text-ink-400" /> Data source
            </h2>
            <dl className="mt-3 space-y-2.5 text-sm">
              <SourceRow label="Directory" value={f.source.name} />
              <SourceRow label="Source type" value={f.source.sourceType.replace(/_/g, ' ').toLowerCase()} />
              {f.source.license && <SourceRow label="Licence" value={f.source.license} />}
              <SourceRow label="Last verified" value={formatDate(f.source.lastVerifiedAt)} />
              <SourceRow label="Availability" value={f.availabilityMode === 'NONE' ? 'No source connected' : f.availabilityMode === 'SIMULATION' ? 'Simulation (historical replay)' : 'Live feed'} />
            </dl>
            {f.source.recordUrl && (
              <a href={f.source.recordUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
                View source record <ExternalLink className="size-3" />
              </a>
            )}
          </Card>

          <Card className="p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-ink-900">Nearby alternatives</h2>
              {neighbours.data && <span className="text-xs text-ink-500">within {formatDistance(neighbours.data.radiusMeters)}</span>}
            </div>
            <div className="mt-3">
              {neighbours.isPending ? (
                <div className="space-y-2">
                  <Skeleton className="h-20" />
                  <Skeleton className="h-20" />
                </div>
              ) : neighbours.isError ? (
                <p className="text-sm text-status-full">{errorMessage(neighbours.error)}</p>
              ) : neighbours.data.items.length === 0 ? (
                <p className="text-sm text-ink-500">No other mapped parking within {formatDistance(neighbours.data.radiusMeters)}.</p>
              ) : (
                <ul className="space-y-2">
                  {neighbours.data.items.map((n) => (
                    <li key={n.id}>
                      <FacilityCard facility={n} thresholds={thresholds} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="mt-3 flex items-center gap-1 text-2xs text-ink-400">
              <Clock className="size-3" /> Ranked by straight-line distance. Recommendations that use availability and predictions will appear once data is available.
            </p>
          </Card>
        </div>
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      <AppFooter />
    </div>
  )
}

function Detail({ label, value, mono }: { label: string; value: React.ReactNode | null; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className={mono && value ? 'mt-0.5 font-mono text-sm text-ink-800' : 'mt-0.5 text-sm text-ink-800'}>{value ?? <span className="text-ink-400">Unknown</span>}</dd>
    </div>
  )
}

function SourceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-right font-medium text-ink-800 first-letter:uppercase">{value}</dd>
    </div>
  )
}

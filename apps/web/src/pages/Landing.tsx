import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Database, Eye, MapPinned, Radar, Search, ShieldCheck, TrendingUp } from 'lucide-react'
import { AppFooter, AppHeader } from '../components/layout/AppHeader'
import { MapView } from '../components/map/MapView'
import { TypeIcon } from '../components/parking/meta'
import { SearchBox } from '../components/search/SearchBox'
import { ProvenanceBadge, StatusBadge } from '../components/ui/Badges'
import { buttonClass } from '../components/ui/Button'
import { Skeleton } from '../components/ui/primitives'
import { api } from '../lib/api'
import { formatDate } from '../lib/format'
import type { MapMarker, PublicStats, SearchResult } from '../lib/types'

const QUICK_AREAS = ['Koramangala', 'Indiranagar', 'Whitefield', 'MG Road', 'HSR Layout', 'Jayanagar', 'Malleshwaram', 'Hebbal']
const CITY_BBOX = '77.43,12.83,77.80,13.15'

export default function Landing() {
  const navigate = useNavigate()
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api<PublicStats>('/api/stats'), staleTime: 10 * 60_000 })
  const markers = useQuery({
    queryKey: ['markers', 'city-preview'],
    queryFn: () => api<{ items: MapMarker[] }>('/api/parking/map', { query: { bbox: CITY_BBOX } }),
    staleTime: 10 * 60_000,
  })

  const goTo = (r: SearchResult) => navigate(`/explore?${new URLSearchParams({ lat: r.latitude.toFixed(6), lng: r.longitude.toFixed(6), label: r.label })}`)

  const quickArea = async (name: string) => {
    try {
      const { results } = await api<{ results: SearchResult[] }>('/api/search/geocode', { query: { q: name, mode: 'full' } })
      if (results[0]) goTo(results[0])
      else navigate('/explore')
    } catch {
      navigate('/explore')
    }
  }

  const osm = stats.data?.sources.find((s) => s.name === 'OpenStreetMap')

  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <AppHeader variant="transparent" />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-ink-100 bg-ink-25">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:py-20 lg:grid-cols-[1.05fr_1fr] lg:items-center">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1 text-xs font-medium text-ink-600">
              <MapPinned className="size-3.5 text-brand-600" /> Bengaluru parking intelligence
            </p>
            <h1 className="mt-5 text-4xl leading-[1.1] font-semibold tracking-tight text-ink-900 sm:text-5xl">Know where to park before you arrive.</h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-600">
              Discover parking across Bengaluru and understand where parking pressure is likely to increase next.
            </p>
            <SearchBox onSelect={goTo} size="lg" className="mt-8 max-w-xl" placeholder="Where are you going? e.g. Koramangala, MG Road" />
            <div className="mt-4 flex max-w-xl flex-wrap gap-2">
              {QUICK_AREAS.map((a) => (
                <button key={a} onClick={() => quickArea(a)} className="rounded-full border border-ink-200 bg-white px-3 py-1 text-xs font-medium text-ink-600 transition-colors hover:border-brand-500 hover:text-brand-700">
                  {a}
                </button>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-pop">
              <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2.5">
                <p className="text-xs font-medium text-ink-700">Mapped parking · Bengaluru</p>
                <p className="tabular text-xs text-ink-500">{markers.data ? `${markers.data.items.length.toLocaleString('en-IN')} facilities` : 'Loading…'}</p>
              </div>
              <MapView className="h-[340px] w-full sm:h-[400px]" markers={markers.data?.items ?? []} zoom={11} interactive={false} />
            </div>
            <p className="mt-2 text-right text-2xs text-ink-400">Real facility locations from OpenStreetMap. Not an illustration.</p>
          </div>
        </div>
      </section>

      {/* Coverage strip — every figure is computed live from the database */}
      <section className="border-b border-ink-100">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-px bg-ink-100 md:grid-cols-4">
          <Figure label="Parking facilities mapped" value={stats.data?.facilities} />
          <Figure label="Bengaluru localities searchable" value={stats.data?.localities} />
          <Figure label="Facilities with a live availability feed" value={stats.data?.liveAvailabilityFacilities} note="Shown only where a real source exists" />
          <Figure label="Directory last verified" text={osm ? formatDate(osm.lastVerifiedAt) : undefined} note="OpenStreetMap snapshot" />
        </div>
      </section>

      {/* Now vs next */}
      <section className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 md:py-24">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight text-ink-900">Two questions, answered honestly.</h2>
          <p className="mt-3 text-ink-600">Most parking apps stop at “where is parking free now?”. ParkFlow also asks where pressure is likely to build next, and labels every number with where it came from.</p>
        </div>
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-ink-100 bg-white p-6 shadow-card">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
              <Eye className="size-4 text-brand-600" /> Where is parking available now?
            </div>
            <p className="mt-2 text-sm text-ink-600">Nearby facilities with type, distance, hours and pricing where known, plus current occupancy when a real feed exists. We never invent availability.</p>
            <div className="mt-5 space-y-2">
              <ExampleRow name="Facility with a live feed" right={<StatusBadge status="moderate" />} detail="18 spaces · 72% occupied · Updated 2 min ago" />
              <ExampleRow name="Directory-only facility" right={<span className="text-xs text-ink-500">Unavailable</span>} detail="Availability currently unavailable." />
              <ExampleRow name="Old reading" right={<span className="text-xs text-ink-500">Stale</span>} detail="Last reported 1 h ago — may be out of date" />
            </div>
            <p className="mt-3 text-2xs text-ink-400">How each availability state is displayed. Example rows, not real facilities.</p>
          </div>

          <div className="rounded-xl border border-ink-100 bg-white p-6 shadow-card">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
              <Radar className="size-4 text-status-predicted" /> Where is pressure likely to increase next?
            </div>
            <p className="mt-2 text-sm text-ink-600">
              When a zone approaches saturation, a model trained on historical occupancy estimates short-term occupancy in neighbouring zones, and suggests alternatives with lower predicted pressure.
            </p>
            <div className="mt-5 rounded-lg border border-status-predicted/20 bg-status-predicted-bg/50 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-ink-800">Spillover warning</p>
                <ProvenanceBadge kind="predicted" />
              </div>
              <div className="mt-3 space-y-2 text-sm">
                <PredRow name="Zone A" now="95%" next="—" status="Saturated" />
                <PredRow name="Zone B" now="60%" next="82%" status="Likely increase" />
                <PredRow name="Zone C" now="40%" next="55%" status="Lower pressure" />
              </div>
            </div>
            <p className="mt-3 text-2xs text-ink-400">Illustrative example of the interface, not live data. Forecasts are estimates, never guarantees.</p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-ink-100 bg-ink-25">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-20">
          <h2 className="text-3xl font-semibold tracking-tight text-ink-900">How it works</h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            <Step n={1} icon={<Search className="size-5" />} title="Search your destination">
              Any Bengaluru area, street or landmark. The map moves there and lists parking within your chosen radius.
            </Step>
            <Step n={2} icon={<MapPinned className="size-5" />} title="Compare real options">
              Type, distance, hours, pricing, EV charging, and current availability where a source exists, each with its freshness.
            </Step>
            <Step n={3} icon={<TrendingUp className="size-5" />} title="See what’s coming">
              Near saturation events, forecasts for neighbouring zones highlight where pressure is likely to rise, and which alternatives look better.
            </Step>
          </ol>
        </div>
      </section>

      {/* Coverage by type + transparency */}
      <section className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-2">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-ink-900">Every kind of parking</h2>
          <p className="mt-2 text-sm text-ink-600">Mapped facilities by type, from the current directory.</p>
          <div className="mt-6 space-y-2.5">
            {stats.isPending
              ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-6" />)
              : stats.data?.byType.slice(0, 9).map((t) => (
                  <div key={t.type} className="grid grid-cols-[160px_1fr_48px] items-center gap-3 text-sm">
                    <span className="flex items-center gap-2 text-ink-700">
                      <TypeIcon type={t.type} className="size-4 text-ink-400" /> {t.label}
                    </span>
                    <span className="h-2 overflow-hidden rounded-full bg-ink-100">
                      <span className="block h-full rounded-full bg-brand-500" style={{ width: `${(t.count / stats.data.byType[0].count) * 100}%` }} />
                    </span>
                    <span className="tabular text-right text-ink-500">{t.count}</span>
                  </div>
                ))}
          </div>
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-ink-900">Transparent by design</h2>
          <p className="mt-2 text-sm text-ink-600">Every figure carries its provenance, so you always know what you are looking at.</p>
          <ul className="mt-6 space-y-4">
            <Transparency badge={<ProvenanceBadge kind="observed" />} title="Observed">
              Reported by a real source, with the time of the reading. Old readings are marked stale, never shown as live.
            </Transparency>
            <Transparency badge={<ProvenanceBadge kind="predicted" />} title="Predicted">
              Model estimates for the next few minutes. Described as likely or estimated, never certain.
            </Transparency>
            <Transparency badge={<ProvenanceBadge kind="simulated" />} title="Simulated">
              Demo facilities replaying historical data, clearly marked and kept out of research results.
            </Transparency>
            <Transparency badge={<Database className="size-4 text-ink-400" />} title="Source-attributed">
              Each facility links to its source record and licence, with the date it was last verified.
            </Transparency>
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 pb-16 sm:px-6 md:pb-24">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 rounded-2xl bg-ink-900 px-8 py-10 text-white md:flex-row md:items-center">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Plan your next trip across Bengaluru.</h2>
            <p className="mt-2 flex items-center gap-2 text-sm text-ink-300">
              <ShieldCheck className="size-4" /> No invented availability. No guaranteed-parking claims.
            </p>
          </div>
          <Link to="/explore" className={buttonClass('secondary', 'lg', 'border-transparent')}>
            Explore the map <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      <AppFooter />
    </div>
  )
}

function Figure({ label, value, text, note }: { label: string; value?: number; text?: string; note?: string }) {
  const display = text ?? (value != null ? value.toLocaleString('en-IN') : undefined)
  return (
    <div className="bg-white px-6 py-6">
      {display != null ? <p className="tabular text-2xl font-semibold text-ink-900">{display}</p> : <Skeleton className="h-8 w-20" />}
      <p className="mt-1 text-sm text-ink-600">{label}</p>
      {note && <p className="mt-0.5 text-2xs text-ink-400">{note}</p>}
    </div>
  )
}

function ExampleRow({ name, detail, right }: { name: string; detail: string; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-ink-100 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-800">{name}</p>
        <p className="truncate text-xs text-ink-500">{detail}</p>
      </div>
      {right}
    </div>
  )
}

function PredRow({ name, now, next, status }: { name: string; now: string; next: string; status: string }) {
  return (
    <div className="grid grid-cols-[1fr_56px_72px_110px] items-center gap-2">
      <span className="font-medium text-ink-800">{name}</span>
      <span className="tabular text-ink-600">{now}</span>
      <span className="tabular font-medium text-status-predicted">{next !== '—' ? `→ ${next}` : '—'}</span>
      <span className="text-right text-xs text-ink-500">{status}</span>
    </div>
  )
}

function Step({ n, icon, title, children }: { n: number; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-xl border border-ink-100 bg-white p-6 shadow-card">
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-lg bg-brand-50 text-brand-600">{icon}</span>
        <span className="text-xs font-semibold text-ink-400">STEP {n}</span>
      </div>
      <h3 className="mt-4 font-semibold text-ink-900">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{children}</p>
    </li>
  )
}

function Transparency({ badge, title, children }: { badge: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <div className="w-24 shrink-0 pt-0.5">{badge}</div>
      <div>
        <p className="text-sm font-semibold text-ink-900">{title}</p>
        <p className="mt-0.5 text-sm text-ink-600">{children}</p>
      </div>
    </li>
  )
}

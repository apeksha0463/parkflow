import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { formatPercent } from '../../lib/format'
import { PRESSURE_HEX, PRESSURE_LABEL, pressureFromLevel, type Thresholds } from '../../lib/pressure'
import { TOKENS } from '../../lib/tokens'
import type { MapZone } from '../../lib/types'

export type Bbox = [number, number, number, number]
export type Bounds = { south: number; west: number; north: number; east: number }
export type Highlight = 'neighbour' | 'warning' | 'alternative'

export interface FlyTarget {
  lat: number
  lng: number
  zoom?: number
  key: string | number
}

const HIGHLIGHT_COLOR: Record<Highlight, string> = {
  neighbour: TOKENS.ink500,
  warning: TOKENS.warning,
  alternative: '#16a34a',
}

function ViewController({ fly, bounds }: { fly?: FlyTarget | null; bounds: Bounds }) {
  const map = useMap()
  const last = useRef<string | number | undefined>(undefined)
  useEffect(() => {
    if (!fly || fly.key === last.current) return
    last.current = fly.key
    // flyTo throws on a hidden (0×0) map, e.g. a collapsed mobile panel; jump there instead.
    const { x, y } = map.getSize()
    const zoom = fly.zoom ?? Math.max(map.getZoom(), 16)
    if (x && y) map.flyTo([fly.lat, fly.lng], zoom, { duration: 0.7 })
    else map.setView([fly.lat, fly.lng], zoom, { animate: false })
  }, [map, fly])
  // Leaflet only tracks window resizes; re-measure when the container is shown or resized.
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(map.getContainer())
    return () => ro.disconnect()
  }, [map])
  useEffect(() => {
    map.setMaxBounds(L.latLngBounds([bounds.south, bounds.west], [bounds.north, bounds.east]).pad(1.5))
  }, [map, bounds])
  return null
}

function BoundsReporter({ onChange }: { onChange: (b: Bbox) => void }) {
  const map = useMapEvents({ moveend: () => report() })
  const report = () => {
    const b = map.getBounds()
    onChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
  }
  useEffect(() => {
    report()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

interface Props {
  zones: MapZone[]
  /** Extent of the monitored zones (from the API); the initial view fits it. */
  bounds: Bounds
  thresholds: Thresholds
  selectedId?: string | null
  onSelect?: (id: string) => void
  onBoundsChange?: (b: Bbox) => void
  fly?: FlyTarget | null
  searchPin?: [number, number] | null
  /** Zones related to the selected one (neighbours, warned zones, alternatives), drawn with a link. */
  highlights?: Map<string, Highlight>
  className?: string
}

export function ZoneMap({ zones, bounds, thresholds, selectedId, onSelect, onBoundsChange, fly, searchPin, highlights, className }: Props) {
  const pin = useMemo(() => L.divIcon({ className: 'pf-search-pin', iconSize: [16, 16], iconAnchor: [8, 8], html: '<div class="pf-search-pin-dot"></div>' }), [])
  const selected = selectedId ? zones.find((z) => z.id === selectedId) : undefined
  const byId = useMemo(() => new Map(zones.map((z) => [z.id, z])), [zones])

  return (
    <MapContainer
      bounds={[
        [bounds.south, bounds.west],
        [bounds.north, bounds.east],
      ]}
      boundsOptions={{ padding: [24, 24] }}
      minZoom={12}
      maxBoundsViscosity={0.8}
      className={className}
      attributionControl
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · sensors: City of Melbourne'
        maxZoom={19}
      />
      <ViewController fly={fly} bounds={bounds} />
      {onBoundsChange && <BoundsReporter onChange={onBoundsChange} />}

      {selected &&
        highlights &&
        [...highlights].map(([id, kind]) => {
          const z = byId.get(id)
          return z ? (
            <Polyline
              key={`link-${id}`}
              positions={[
                [selected.latitude, selected.longitude],
                [z.latitude, z.longitude],
              ]}
              pathOptions={{ color: HIGHLIGHT_COLOR[kind], weight: kind === 'neighbour' ? 1.5 : 2.5, dashArray: kind === 'neighbour' ? '4 4' : undefined, opacity: 0.9 }}
              interactive={false}
            />
          ) : null
        })}

      {zones.map((z) => {
        const isSel = z.id === selectedId
        const hl = highlights?.get(z.id)
        const pressure = pressureFromLevel(z.pressureLevel, z.occupancy, thresholds)
        return (
          <CircleMarker
            key={z.id}
            center={[z.latitude, z.longitude]}
            radius={isSel ? 11 : hl ? 9 : 7}
            pathOptions={{
              color: isSel ? TOKENS.ink900 : hl ? HIGHLIGHT_COLOR[hl] : '#ffffff',
              weight: isSel ? 3 : hl ? 2.5 : 1.5,
              fillColor: PRESSURE_HEX[pressure],
              fillOpacity: pressure === 'unknown' ? 0.5 : 0.92,
            }}
            eventHandlers={onSelect ? { click: () => onSelect(z.id) } : undefined}
            bubblingMouseEvents={false}
          >
            <Tooltip className="pf-tooltip" direction="top" offset={[0, -6]}>
              <span className="block font-medium">{z.displayName}</span>
              <span className="text-ink-500">
                {z.occupancy != null ? `${formatPercent(z.occupancy)} occupied · ` : ''}
                {PRESSURE_LABEL[pressure]}
              </span>
            </Tooltip>
          </CircleMarker>
        )
      })}
      {searchPin && <Marker position={searchPin} icon={pin} interactive={false} keyboard={false} />}
    </MapContainer>
  )
}

export function MapLegend({ className }: { className?: string }) {
  const items = (['normal', 'moderate', 'high', 'saturated', 'unknown'] as const).map((p) => ({ p, label: PRESSURE_LABEL[p] }))
  return (
    <div className={className} aria-label="Map legend">
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-ink-600">
        {items.map((i) => (
          <li key={i.p} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full ring-1 ring-white" style={{ background: PRESSURE_HEX[i.p] }} aria-hidden />
            {i.label}
          </li>
        ))}
      </ul>
    </div>
  )
}

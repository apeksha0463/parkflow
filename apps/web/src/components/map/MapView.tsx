import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import 'leaflet.markercluster'
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import 'leaflet/dist/leaflet.css'
import { statusFromOccupancy, type StatusThresholds } from '../../lib/status'
import { TOKENS } from '../../lib/tokens'
import type { AvailabilityState, MapMarker } from '../../lib/types'

export const BENGALURU_CENTER: [number, number] = [12.9716, 77.5946]
export const BENGALURU_BOUNDS: L.LatLngBoundsExpression = [
  [12.7, 77.3],
  [13.3, 77.95],
]

export type Bbox = [number, number, number, number]

const STATUS_FILL: Record<string, string> = {
  available: TOKENS.available,
  moderate: TOKENS.moderate,
  nearly_full: TOKENS.nearlyFull,
  full: TOKENS.full,
}

function markerKey(state: AvailabilityState, status: string, selected: boolean, demo: boolean) {
  return `${state}|${status}|${selected}|${demo}`
}

const iconCache = new Map<string, L.DivIcon>()

/** Neutral hollow pin when availability is unknown; status-filled when current data exists. */
function markerIcon(state: AvailabilityState, occupancy: number | null, selected: boolean, demo: boolean, thresholds?: StatusThresholds) {
  const current = state === 'LIVE' || state === 'SIMULATED'
  const status = current ? statusFromOccupancy(occupancy, { thresholds }) : 'unknown'
  const key = markerKey(state, status, selected, demo)
  let icon = iconCache.get(key)
  if (!icon) {
    const size = selected ? 30 : 22
    const fill = current ? STATUS_FILL[status] ?? TOKENS.ink400 : '#fff'
    const stroke = selected ? TOKENS.brand600 : current ? '#fff' : TOKENS.ink500
    const glyph = current ? '#fff' : TOKENS.ink600
    icon = L.divIcon({
      className: 'pf-marker',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="${fill}" stroke="${stroke}" stroke-width="${selected ? 3 : 2}" ${demo ? 'stroke-dasharray="3 2"' : ''}/>
        <text x="12" y="16" text-anchor="middle" font-size="11" font-weight="700" font-family="Inter Variable, sans-serif" fill="${glyph}">P</text>
      </svg>`,
    })
    iconCache.set(key, icon)
  }
  return icon
}

function clusterIcon(cluster: L.MarkerCluster) {
  const n = cluster.getChildCount()
  const size = n < 10 ? 32 : n < 100 ? 38 : 44
  return L.divIcon({
    className: 'pf-cluster',
    iconSize: [size, size],
    html: `<div style="width:${size}px;height:${size}px" class="pf-cluster-inner">${n}</div>`,
  })
}

function ViewController({ center, zoom, flyKey }: { center?: [number, number]; zoom?: number; flyKey?: string | number }) {
  const map = useMap()
  const last = useRef<string | number | undefined>(undefined)
  useEffect(() => {
    if (!center || flyKey === last.current) return
    last.current = flyKey
    // flyTo throws on a hidden (0×0) map, e.g. the mobile list view; jump there instead.
    const { x, y } = map.getSize()
    if (x && y) map.flyTo(center, zoom ?? map.getZoom(), { duration: 0.8 })
    else map.setView(center, zoom ?? map.getZoom(), { animate: false })
  }, [map, center, zoom, flyKey])
  // Leaflet only tracks window resizes; re-measure when the container is shown or resized.
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(map.getContainer())
    return () => ro.disconnect()
  }, [map])
  return null
}

function BoundsReporter({ onChange }: { onChange: (b: Bbox, zoom: number) => void }) {
  const map = useMapEvents({
    moveend: () => report(),
  })
  const report = () => {
    const b = map.getBounds()
    onChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], map.getZoom())
  }
  useEffect(() => {
    report()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

interface Props {
  markers: MapMarker[]
  selectedId?: string | null
  onMarkerClick?: (id: string) => void
  onBoundsChange?: (b: Bbox, zoom: number) => void
  center?: [number, number]
  zoom?: number
  flyKey?: string | number
  radiusMeters?: number | null
  destination?: [number, number] | null
  thresholds?: StatusThresholds
  interactive?: boolean
  className?: string
}

export function MapView({
  markers,
  selectedId,
  onMarkerClick,
  onBoundsChange,
  center,
  zoom = 12,
  flyKey,
  radiusMeters,
  destination,
  thresholds,
  interactive = true,
  className,
}: Props) {
  const destIcon = useMemo(
    () =>
      L.divIcon({
        className: 'pf-destination',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
        html: '<div class="pf-destination-dot"></div>',
      }),
    [],
  )
  const selected = selectedId ? markers.find((m) => m.id === selectedId) : undefined
  const renderMarker = (m: MapMarker, isSelected: boolean) => (
    <Marker
      key={m.id}
      position={[m.latitude, m.longitude]}
      icon={markerIcon(m.availabilityState, m.occupancy, isSelected, m.isDemo, thresholds)}
      zIndexOffset={isSelected ? 1000 : 0}
      eventHandlers={onMarkerClick ? { click: () => onMarkerClick(m.id) } : undefined}
      title={m.isDemo ? 'Demo facility (simulation)' : 'Parking facility'}
    />
  )

  return (
    <MapContainer
      center={center ?? BENGALURU_CENTER}
      zoom={zoom}
      minZoom={10}
      maxBounds={BENGALURU_BOUNDS}
      maxBoundsViscosity={0.8}
      scrollWheelZoom={interactive}
      dragging={interactive}
      zoomControl={interactive}
      doubleClickZoom={interactive}
      className={className}
      attributionControl
    >
      <TileLayer
        // Standard OpenStreetMap tiles (CARTO basemaps now return an "API key required" placeholder without a key).
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
      />
      <ViewController center={center} zoom={zoom} flyKey={flyKey} />
      {onBoundsChange && <BoundsReporter onChange={onBoundsChange} />}
      {destination && radiusMeters && (
        <Circle center={destination} radius={radiusMeters} pathOptions={{ color: TOKENS.brand500, weight: 1, fillOpacity: 0.04, dashArray: '4 4' }} />
      )}
      {destination && <Marker position={destination} icon={destIcon} interactive={false} keyboard={false} />}
      <MarkerClusterGroup chunkedLoading showCoverageOnHover={false} maxClusterRadius={48} iconCreateFunction={clusterIcon}>
        {markers.map((m) => m.id !== selectedId && renderMarker(m, false))}
      </MarkerClusterGroup>
      {/* The selected marker sits outside the cluster group so it is never hidden inside a cluster. */}
      {selected && renderMarker(selected, true)}
    </MapContainer>
  )
}

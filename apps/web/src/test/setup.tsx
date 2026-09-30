import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup, configure } from '@testing-library/react'

// Lazily loaded pages (map + chart libraries) take several seconds to compile on the first test of a file.
configure({ asyncUtilTimeout: 20_000 })

// Leaflet needs a real layout engine; tests render a lightweight stand-in that exposes what the page asks the
// map to do (zones, selection, fly target, highlights) and lets tests click zones.
vi.mock('../components/map/ZoneMap', () => ({
  MapLegend: () => <div>legend</div>,
  ZoneMap: (props: {
    zones: { id: string; displayName: string }[]
    selectedId?: string | null
    fly?: { key: string | number } | null
    highlights?: Map<string, string>
    onSelect?: (id: string) => void
    onBoundsChange?: (b: [number, number, number, number]) => void
  }) => (
    <div
      data-testid="map"
      data-selected={props.selectedId ?? ''}
      data-fly={props.fly?.key ?? ''}
      data-highlights={props.highlights ? [...props.highlights].map(([k, v]) => `${k}:${v}`).join(',') : ''}
    >
      {props.zones.length} zones on map
      <button type="button" onClick={() => props.onBoundsChange?.([144.9, -37.83, 145.0, -37.79])}>
        report bounds
      </button>
      {props.zones.map((z) => (
        <button key={z.id} type="button" onClick={() => props.onSelect?.(z.id)}>
          map zone {z.displayName}
        </button>
      ))}
    </div>
  ),
}))

// jsdom has no layout, so scrollIntoView (used to reveal the selected card) is a no-op here.
Element.prototype.scrollIntoView = () => {}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

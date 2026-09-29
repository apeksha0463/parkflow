import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// Leaflet needs a real layout engine; tests render a lightweight stand-in that exposes what the page
// asks the map to do (centre, zoom, markers) and lets tests fire marker clicks and viewport changes.
vi.mock('../components/map/MapView', () => ({
  BENGALURU_CENTER: [12.97, 77.59],
  MapView: (props: {
    markers: { id: string }[]
    center?: [number, number]
    zoom?: number
    flyKey?: string
    onMarkerClick?: (id: string) => void
    onBoundsChange?: (b: [number, number, number, number], zoom: number) => void
  }) => {
    ;(globalThis as { __mapProps?: unknown }).__mapProps = props
    return (
      <div data-testid="map" data-center={props.center ? props.center.join(',') : ''} data-zoom={props.zoom} data-fly={props.flyKey}>
        {props.markers.length} markers
        {props.markers.map((m) => (
          <button key={m.id} type="button" onClick={() => props.onMarkerClick?.(m.id)}>
            marker {m.id}
          </button>
        ))}
      </div>
    )
  },
}))

// jsdom has no layout, so scrollIntoView (used to reveal the selected card) is a no-op here.
Element.prototype.scrollIntoView = () => {}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// Leaflet needs a real layout engine; tests render a lightweight stand-in instead.
vi.mock('../components/map/MapView', () => ({
  BENGALURU_CENTER: [12.97, 77.59],
  MapView: ({ markers }: { markers: unknown[] }) => <div data-testid="map">{markers.length} markers</div>,
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

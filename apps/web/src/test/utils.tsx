import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import type { Availability, MapZone, OverviewStats, ReplayClock, Zone } from '../lib/types'

type Handler = (url: URL, init?: RequestInit) => { status?: number; body?: unknown } | undefined

/** Routes fetch calls to handlers; unmatched requests return 404 JSON. Common endpoints get test fixtures. Returns the spy. */
export function mockApi(handler: Handler) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    const res = handler(url, init) ?? defaults(url)
    if (!res) return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), { status: 404 })
    return new Response(res.status === 204 ? null : JSON.stringify(res.body ?? {}), { status: res.status ?? 200 })
  })
}

function defaults(url: URL): { status?: number; body?: unknown } | undefined {
  if (url.pathname === '/api/auth/me') return { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'Please sign in' } } }
  if (url.pathname === '/api/replay') return { body: CLOCK }
  if (url.pathname === '/api/config') return { body: { saturationThreshold: 0.9, approachingThreshold: 0.8, staleAfterMinutes: 30 } }
  if (url.pathname === '/api/stats') return { body: STATS }
  if (url.pathname === '/api/parking/map') return { body: { at: CLOCK.now, items: [] } }
  return undefined
}

export function renderApp(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

// ---------------------------------------------------------------- test fixtures (never used in production code)

export const CLOCK: ReplayClock = {
  mode: 'HISTORICAL_REPLAY',
  now: '2019-11-05T00:05:00.000Z',
  playing: false,
  speed: 1,
  stepMinutes: 5,
  range: { start: '2019-10-31T13:00:00Z', end: '2019-12-31T12:55:00Z', timezone: 'Australia/Melbourne', dataset: 'test-dataset' },
}

export const STATS: OverviewStats = {
  zones: 321,
  zonesWithNeighbours: 300,
  neighbourRelations: 1000,
  saturationEvents: 4567,
  bounds: { south: -37.83, west: 144.93, north: -37.8, east: 144.99 },
  replay: { mode: 'HISTORICAL_REPLAY', range: CLOCK.range },
  model: { status: 'available', active: 'st-test', featureSet: 'spatial_temporal', horizonsMinutes: [5, 15, 30], neighbourRadiusMeters: 250, saturationThreshold: 0.9, models: [{ id: 'a-test', featureSet: 'temporal' }, { id: 'st-test', featureSet: 'spatial_temporal' }] },
  sources: [{ name: 'Test sensor source', sourceType: 'HISTORICAL_DATA', license: 'CC BY', url: null, description: null }],
}

export function availability(occ: number | null, capacity = 12): Availability {
  if (occ == null) return { state: 'UNAVAILABLE', message: 'No reading at this time.', occupied: null, available: null, capacity: null, occupancy: null, observedAt: null, ageMinutes: null, sourceType: null }
  const occupied = Math.round(occ * capacity)
  return { state: 'REPLAY', message: 'Historical replay — recorded sensor data.', occupied, available: capacity - occupied, capacity, occupancy: occupied / capacity, observedAt: CLOCK.now, ageMinutes: 0, sourceType: 'HISTORICAL_DATA' }
}

export function zone(id: string, occ: number | null, overrides: Partial<Zone> = {}): Zone {
  return {
    id,
    name: `Test Street ${id}`,
    externalId: `test:${id}`,
    displayName: `Test Street ${id}`,
    nameIsDerived: false,
    type: 'ON_STREET',
    typeLabel: 'On-street',
    address: null,
    area: 'Test Area',
    latitude: -37.81,
    longitude: 144.96,
    distanceMeters: null,
    capacity: 12,
    availabilityMode: 'REPLAY',
    pressureLevel: occ == null ? null : occ >= 0.9 ? 'SATURATED' : occ >= 0.8 ? 'APPROACHING_SATURATION' : 'NORMAL',
    availability: availability(occ),
    source: { name: 'Test sensor source', sourceType: 'HISTORICAL_DATA', url: null, license: null, recordUrl: null, lastVerifiedAt: null },
    ...overrides,
  }
}

export const mapZone = (z: Zone): MapZone => ({
  id: z.id,
  displayName: z.displayName,
  latitude: z.latitude,
  longitude: z.longitude,
  availabilityState: z.availability.state,
  occupancy: z.availability.occupancy,
  available: z.availability.available,
  capacity: z.availability.capacity,
  pressureLevel: z.pressureLevel,
})

export const predictions = (values: [number, number][]) => ({
  status: 'AVAILABLE',
  message: null,
  provenance: 'PREDICTED',
  model: { id: 'st-test', featureSet: 'spatial_temporal', trainingDataset: 'test-dataset', trainedAt: 'x' },
  zones: [{ zoneId: 'z', zoneName: 'z', basedOn: CLOCK.now, currentOccupancy: 0.5, currentState: 'NORMAL', neighboursUsed: 3, predictions: values.map(([h, p]) => ({ horizonMinutes: h, predictedOccupancy: p, pressureLevel: p >= 0.9 ? 'SATURATED' : p >= 0.8 ? 'APPROACHING_SATURATION' : 'NORMAL' })) }],
})

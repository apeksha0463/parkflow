import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Toaster } from 'sonner'
import App from '../App'
import { facility, mockApi, renderApp } from '../test/utils'
import type { FacilityPredictions, Spillover } from '../lib/types'
import { viewMovedAway } from './Explore'

type MapProps = { onBoundsChange?: (b: [number, number, number, number], zoom: number) => void }
const mapProps = () => (globalThis as { __mapProps?: MapProps }).__mapProps!
const mapEl = () => screen.getByTestId('map')
/** The map section, which holds the floating preview (list cards show predictions too). */
const mapRegion = () => within(screen.getByRole('region', { name: 'Parking map' }))

const KORAMANGALA = { id: 'locality:1', label: 'Koramangala', sublabel: 'Suburb, Bengaluru', latitude: 12.9352, longitude: 77.6245, kind: 'locality', source: 'OSM' }
const SIM = facility({ id: 'sim1', name: 'Simulation demo 1', displayName: 'Simulation demo 1', latitude: 12.936, longitude: 77.625, availabilityMode: 'SIMULATION', isDemo: true })
const NONE = facility({ id: 'osm1', name: 'Forum Parking', displayName: 'Forum Parking', latitude: 12.934, longitude: 77.611 })

const predictions = (overrides: Partial<FacilityPredictions> = {}): FacilityPredictions => ({
  status: 'AVAILABLE',
  message: null,
  provenance: 'PREDICTED',
  model: { id: 'spatial_temporal-hgb-v1', featureSet: 'spatial_temporal', trainingDataset: 'melbourne-on-street-sensors-2019', trainedAt: '2026-09-29T00:00:00Z' },
  zones: [{ zoneId: 'z', zoneName: 'Main', basedOn: '2026-09-29T10:00:00Z', currentOccupancy: 0.61, currentState: 'NORMAL', neighboursUsed: 3, isSimulated: true,
    predictions: [{ horizonMinutes: 5, predictedOccupancy: 0.66, pressureLevel: 'NORMAL' }, { horizonMinutes: 15, predictedOccupancy: 0.82, pressureLevel: 'APPROACHING_SATURATION' }] }],
  ...overrides,
})

const spillover = (context: boolean): Spillover => ({
  facilityId: 'sim1',
  thresholds: { saturation: 0.9, approaching: 0.8 },
  neighbourRadiusMeters: 800,
  origin: { availability: SIM.availability, pressureLevel: context ? 'SATURATED' : 'NORMAL', activeSaturationEvent: null },
  spilloverContext: context,
  warnings: context ? [{ facilityId: 'sim2', displayName: 'Simulation demo 2', currentOccupancy: 0.7, predictedOccupancy: 0.86, horizonMinutes: 15, message: 'Parking pressure is likely to increase around Simulation demo 2: predicted occupancy 86% in 15 min (currently 70%).' }] : [],
  alternatives: [],
  neighbours: [],
})

function setup(opts: { preds?: FacilityPredictions; context?: boolean } = {}) {
  const calls: URL[] = []
  const spy = mockApi((u) => {
    calls.push(u)
    if (u.pathname === '/api/parking/map') return { body: { items: [{ id: 'sim1', latitude: SIM.latitude, longitude: SIM.longitude, type: 'PUBLIC', isDemo: true, availabilityState: 'SIMULATED', occupancy: 0.61 }], truncated: false } }
    if (u.pathname === '/api/search/geocode') return { body: { geocoder: 'not_used', results: [KORAMANGALA] } }
    if (u.pathname === '/api/parking') return { body: { items: [NONE, SIM], page: 1, pageSize: 20, total: 2, origin: null, radiusMeters: 2000, sort: 'distance' } }
    if (u.pathname === '/api/parking/sim1/predictions') return { body: opts.preds ?? predictions() }
    if (u.pathname === '/api/spillover/predictions') return { body: spillover(opts.context ?? false) }
    if (u.pathname === '/api/parking/sim1') return { body: { facility: { ...SIM, zones: [] } } }
  })
  return { calls, spy, parkingCalls: () => calls.filter((c) => c.pathname === '/api/parking') }
}

async function searchKoramangala() {
  const user = userEvent.setup()
  renderApp(
    <>
      <App />
      <Toaster />
    </>,
    { route: '/explore' },
  )
  await user.type(await screen.findByRole('combobox', { name: /search destination/i }), 'kora')
  await user.click(await screen.findByRole('option', { name: /koramangala/i }))
  await screen.findByRole('button', { name: 'Show Forum Parking on the map' })
  // the real map reports its viewport after moving; the stand-in needs it done explicitly
  act(() => mapProps().onBoundsChange!([77.605, 12.925, 77.645, 12.945], 14))
  return user
}

describe('map + search', () => {
  it('geocoded search moves the map to the place, zooms in and loads nearby parking', async () => {
    const { parkingCalls } = setup()
    await searchKoramangala()
    expect(mapEl()).toHaveAttribute('data-center', '12.9352,77.6245')
    expect(mapEl()).toHaveAttribute('data-zoom', '14') // 2 km default radius
    const q = parkingCalls()[0].searchParams
    expect([q.get('lat'), q.get('lng'), q.get('radius')]).toEqual(['12.9352', '77.6245', '2000'])
  })

  it('renders markers from the viewport query; a marker click opens a preview with prediction, details and directions', async () => {
    setup()
    const user = await searchKoramangala()
    await waitFor(() => expect(mapEl()).toHaveTextContent('1 markers'))
    await user.click(within(mapEl()).getByRole('button', { name: 'marker sim1' }))
    expect(await mapRegion().findByText(/predicted occupancy/i)).toHaveTextContent('Predicted occupancy 82% in 15 min')
    expect(mapRegion().getAllByText('Simulation · Research').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'View details' })).toHaveAttribute('href', '/parking/sim1')
    const dirs = screen.getAllByRole('link', { name: /directions/i }).map((a) => a.getAttribute('href'))
    expect(dirs).toContain(`https://www.openstreetmap.org/directions?to=${SIM.latitude}%2C${SIM.longitude}#map=17/${SIM.latitude}/${SIM.longitude}`)
  })

  it('clicking a result flies the map to that facility and highlights it', async () => {
    setup()
    const user = await searchKoramangala()
    await user.click(screen.getByRole('button', { name: 'Show Forum Parking on the map' }))
    expect(mapEl()).toHaveAttribute('data-center', `${NONE.latitude},${NONE.longitude}`)
    expect(Number(mapEl().getAttribute('data-zoom'))).toBeGreaterThanOrEqual(16)
    expect(screen.getByRole('button', { name: 'Show Forum Parking on the map' }).closest('article')!.className).toContain('border-brand-500')
  })

  it('"Search this area" appears after moving the map and queries the visible bounds without moving the map', async () => {
    const { parkingCalls } = setup()
    const user = await searchKoramangala()
    expect(screen.queryByRole('button', { name: /search this area/i })).not.toBeInTheDocument()
    act(() => mapProps().onBoundsChange!([77.70, 12.95, 77.74, 12.98], 14)) // user panned towards Whitefield side
    await user.click(await screen.findByRole('button', { name: /search this area/i }))
    await waitFor(() => expect(parkingCalls().some((c) => c.searchParams.get('bbox') === '77.7,12.95,77.74,12.98')).toBe(true))
    expect(mapEl()).toHaveAttribute('data-fly', 'area')
    expect(mapEl()).toHaveAttribute('data-center', '')
    expect(screen.getByText('this map area')).toBeInTheDocument()
  })

  it('"Use my location" centres on the granted position', async () => {
    const { parkingCalls } = setup()
    const getCurrentPosition = vi.fn((ok: PositionCallback) => ok({ coords: { latitude: 12.97, longitude: 77.64 } } as GeolocationPosition))
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } })
    const user = await searchKoramangala()
    await user.click(screen.getByRole('button', { name: /use my location/i }))
    await waitFor(() => expect(mapEl()).toHaveAttribute('data-center', '12.97,77.64'))
    expect(parkingCalls().at(-1)!.searchParams.get('lat')).toBe('12.97')
    expect(screen.getByText('Your location')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('a denied location permission shows a message and keeps the current search', async () => {
    setup()
    const getCurrentPosition = vi.fn((_ok: PositionCallback, err: PositionErrorCallback) => err({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError))
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } })
    const user = await searchKoramangala()
    await user.click(screen.getByRole('button', { name: /use my location/i }))
    expect(await screen.findByText(/location permission denied/i)).toBeInTheDocument()
    expect(mapEl()).toHaveAttribute('data-center', '12.9352,77.6245')
    expect(screen.getByRole('button', { name: 'Show Forum Parking on the map' })).toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})

describe('prediction + spillover states', () => {
  it('never requests predictions for facilities without an occupancy source', async () => {
    const { calls } = setup()
    const user = await searchKoramangala()
    await user.click(screen.getByRole('button', { name: 'Show Forum Parking on the map' }))
    // Forum Parking is in the list, so the preview isn't shown on desktop; check via the detail-free states instead
    expect(calls.some((c) => c.pathname === '/api/parking/osm1/predictions')).toBe(false)
  })

  it('shows "temporarily unavailable" when the ML service is down', async () => {
    setup({ preds: { status: 'SERVICE_UNAVAILABLE', message: 'Prediction temporarily unavailable.', provenance: 'PREDICTED', model: null, zones: [] } })
    const user = await searchKoramangala()
    await user.click(await within(mapEl()).findByRole('button', { name: 'marker sim1' }))
    expect(await mapRegion().findByText('Prediction temporarily unavailable.')).toBeInTheDocument()
  })

  it('shows the spillover warning only when the facility is at or near saturation', async () => {
    setup({ context: true })
    const user = await searchKoramangala()
    await user.click(await within(mapEl()).findByRole('button', { name: 'marker sim1' }))
    expect(await screen.findByText(/parking pressure is likely to increase in nearby zones/i)).toBeInTheDocument()
    expect(screen.getByText(/around Simulation demo 2: predicted occupancy 86% in 15 min/)).toBeInTheDocument()
  })

  it('shows no spillover warning in normal conditions', async () => {
    setup({ context: false })
    const user = await searchKoramangala()
    await user.click(await within(mapEl()).findByRole('button', { name: 'marker sim1' }))
    await mapRegion().findByText(/predicted occupancy/i)
    expect(screen.queryByText(/parking pressure is likely to increase/i)).not.toBeInTheDocument()
  })
})

describe('parking cards: source of every status', () => {
  it('labels availability and prediction sources; directory-only and live facilities never request predictions', async () => {
    const LIVE = facility({ id: 'live1', name: 'City Lot', displayName: 'City Lot', availabilityMode: 'LIVE', capacity: 100, evCharging: true, openNow: true,
      availability: { state: 'LIVE', message: 'x', occupied: 73, available: 27, capacity: 100, occupancy: 0.73, observedAt: null, ageMinutes: 2, sourceType: 'LIVE_SENSOR' } })
    const calls: URL[] = []
    mockApi((u) => {
      calls.push(u)
      if (u.pathname === '/api/parking/map') return { body: { items: [], truncated: false } }
      if (u.pathname === '/api/parking') return { body: { items: [NONE, LIVE, SIM], page: 1, pageSize: 20, total: 3, origin: null, radiusMeters: 2000, sort: 'distance' } }
      if (u.pathname === '/api/parking/sim1/predictions') return { body: predictions() }
    })
    renderApp(<App />, { route: '/explore?lat=12.9352&lng=77.6245&label=Koramangala' })
    const card = async (name: string) => within((await screen.findByRole('button', { name: `Show ${name} on the map` })).closest('article')!)

    const none = await card('Forum Parking')
    expect(none.getAllByText('Unavailable')).toHaveLength(2)
    expect(none.getByText('Availability currently unavailable.')).toBeInTheDocument()
    expect(none.getByText('Prediction unavailable — insufficient historical data.')).toBeInTheDocument()

    const live = await card('City Lot')
    expect(live.getByText('Live')).toBeInTheDocument()
    expect(live.getByText(/27/).closest('span')).toHaveTextContent('27 spaces available')
    expect(live.getByText(/73% occupied/)).toBeInTheDocument()
    expect(live.getByText(/Updated 2 min ago/)).toBeInTheDocument()
    expect(live.getByText('100 spaces', { exact: false })).toBeInTheDocument()
    expect(live.getByText(/EV charging/)).toBeInTheDocument()
    expect(live.getByText('Prediction unavailable — no model has been trained for this area yet.')).toBeInTheDocument()

    const sim = await card('Simulation demo 1')
    expect(sim.getByText('Simulation · Research')).toBeInTheDocument() // prediction row (fixture has no availability data)
    expect(await sim.findByText(/predicted occupancy/i)).toHaveTextContent('Predicted occupancy 82% in 15 min')

    const predictionCalls = calls.filter((c) => c.pathname.endsWith('/predictions')).map((c) => c.pathname)
    expect(predictionCalls.every((p) => p === '/api/parking/sim1/predictions')).toBe(true)
  })
})

describe('viewMovedAway', () => {
  it('is false for small pans and true beyond a quarter of the view', () => {
    const view: [number, number, number, number] = [77.60, 12.92, 77.64, 12.96]
    expect(viewMovedAway(view, [12.94, 77.62])).toBe(false)
    expect(viewMovedAway(view, [12.94, 77.605])).toBe(true)
    expect(viewMovedAway(view, null)).toBe(true)
  })
})

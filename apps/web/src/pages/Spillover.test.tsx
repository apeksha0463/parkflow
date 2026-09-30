import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { availability, CLOCK, mapZone, mockApi, predictions, renderApp, zone } from '../test/utils'
import type { SaturationEvent, Spillover } from '../lib/types'

// Test fixtures only — production UI values always come from the API.
const O = zone('o', 11 / 12)
const W = zone('w', 0.75)
const ALT = zone('alt', 0.4)

const EVENT: SaturationEvent = {
  id: 'e1',
  startedAt: CLOCK.now,
  endedAt: '2019-11-05T00:35:00.000Z',
  durationMinutes: 30,
  peakOccupancy: 1,
  threshold: 0.9,
  activeAtReplayTime: true,
  zone: { id: 'zo', name: O.displayName, neighbourCount: 2 },
  facility: { id: 'o', displayName: O.displayName, area: 'Test Area', latitude: -37.81, longitude: 144.96, capacity: 12 },
}

const cand = (z: typeof W, predicted: number, d: number) => ({
  id: z.id, displayName: z.displayName, latitude: z.latitude, longitude: z.longitude, distanceMeters: d, availability: z.availability,
  predicted: { horizonMinutes: 15, predictedOccupancy: predicted, pressureLevel: null }, predictionStatus: 'AVAILABLE' as const,
})

const SPILL: Spillover = {
  facilityId: 'o',
  at: CLOCK.now,
  thresholds: { saturation: 0.9, approaching: 0.8 },
  neighbourRadiusMeters: 250,
  warningHorizonMinutes: 15,
  origin: {
    availability: availability(11 / 12),
    pressureLevel: 'SATURATED',
    activeSaturationEvent: { id: 'e1', zoneId: 'zo', startedAt: CLOCK.now, endedAt: null, peakOccupancy: 1, threshold: 0.9 },
    predictions: predictions([[5, 0.9], [15, 0.87], [30, 0.85]]) as Spillover['origin']['predictions'],
  },
  spilloverContext: true,
  warnings: [{ facilityId: 'w', displayName: W.displayName, distanceMeters: 120, currentOccupancy: 0.75, predictedOccupancy: 0.83, horizonMinutes: 15, message: 'Parking pressure is predicted to increase around Test Street w: predicted occupancy 83% in 15 min (currently 75%).' }],
  alternatives: [{ ...cand(ALT, 0.42, 180), score: 0.438, reason: 'Suggested because it has 7 spaces currently available, predicted occupancy 42% in 15 min, 0.2 km away.' }],
  neighbours: [cand(W, 0.83, 120), cand(ALT, 0.42, 180)],
}

function setup() {
  const posts: unknown[] = []
  const adjacent: URL[] = []
  mockApi((u, init) => {
    if (u.pathname === '/api/replay' && init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)))
      return { body: CLOCK }
    }
    if (u.pathname === '/api/parking/map') return { body: { at: CLOCK.now, items: [O, W, ALT].map(mapZone) } }
    if (u.pathname === '/api/spillover/events/adjacent') {
      adjacent.push(u)
      return { body: { event: EVENT } }
    }
    if (u.pathname === '/api/spillover/events/e1') return { body: { event: EVENT } }
    if (u.pathname === '/api/spillover/events') return { body: { total: 1, page: 1, pageSize: 10, replayTime: CLOCK.now, items: [EVENT] } }
    if (u.pathname === '/api/spillover/predictions') return { body: SPILL }
    if (u.pathname === '/api/parking/o') return { body: { at: CLOCK.now, facility: { ...O, zones: [{ id: 'zo', name: 'x', kind: 'SEGMENT', capacity: 12, blockKey: '9:8-7' }] } } }
    if (u.pathname === '/api/analytics/predicted-vs-actual')
      return {
        body: {
          status: 'AVAILABLE',
          message: null,
          result: {
            zoneName: O.displayName,
            zoneId: 'zo',
            neighboursUsed: 2,
            models: [
              { id: 'a-test', featureSet: 'temporal', active: false },
              { id: 'st-test', featureSet: 'spatial_temporal', active: true },
            ],
            horizons: [
              {
                horizonMinutes: 15,
                points: [
                  { predictionTime: CLOCK.now, targetTime: '2019-11-05T00:20:00.000Z', actual: 0.8333, persistence: 0.9167, predicted: { 'a-test': 0.88, 'st-test': 0.87 } },
                  { predictionTime: '2019-11-05T00:10:00.000Z', targetTime: '2019-11-05T00:25:00.000Z', actual: null, persistence: 0.9167, predicted: { 'a-test': 0.86, 'st-test': 0.85 } },
                ],
              },
            ],
          },
        },
      }
  })
  return { posts, adjacent }
}

describe('spillover intelligence', () => {
  it('asks to select a zone or open an event when nothing is selected', async () => {
    setup()
    renderApp(<App />, { route: '/spillover' })
    expect(await screen.findByText(/select a zone or open a saturation event/i)).toBeInTheDocument()
  })

  it('Research Demo opens a real event from the API, seeks the replay and shows the API’s spillover analysis', async () => {
    const user = userEvent.setup()
    const { posts, adjacent } = setup()
    renderApp(<App />, { route: '/spillover' })
    await user.click(await screen.findByRole('button', { name: /research demo/i }))

    expect(adjacent[0].searchParams.get('direction')).toBe('next')
    expect(adjacent[0].searchParams.get('withNeighbours')).toBe('true')
    expect(posts).toEqual([{ at: EVENT.startedAt, playing: false }])

    expect(await screen.findByText('Test Area · Block 9:8-7')).toBeInTheDocument()
    expect(await screen.findByText('Saturation event', { selector: 'span' })).toBeInTheDocument()
    // warning text exactly as the backend generated it
    expect(screen.getByText(SPILL.warnings[0].message)).toBeInTheDocument()
    // alternatives in API order with the API's reason; the warned zone is not among them
    const alts = screen.getByText(SPILL.alternatives[0].reason).closest('ol')!
    expect(within(alts).queryByText('Test Street w')).toBeNull()
    expect(screen.getByTestId('map')).toHaveAttribute('data-highlights', 'w:warning,alt:alternative')
    // forecast of the origin from the prediction API
    expect(screen.getByText('87%')).toBeInTheDocument()
  })

  it('shows predicted vs actual from the API, and says when an actual is missing', async () => {
    const user = userEvent.setup()
    setup()
    renderApp(<App />, { route: '/spillover?zone=o&event=e1' })
    expect(await screen.findByRole('heading', { name: 'Predicted vs actual' })).toBeInTheDocument()
    expect(await screen.findByText(/1 target time has no recorded reading/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /show data table/i }))
    expect(screen.getByText('No reading', { selector: 'td' })).toBeInTheDocument()
    expect(screen.getAllByText('83%', { selector: 'td' }).length).toBeGreaterThan(0)
  })

  it('lists saturation events from the API and opens one', async () => {
    const user = userEvent.setup()
    const { posts } = setup()
    renderApp(<App />, { route: '/spillover' })
    const section = (await screen.findByRole('heading', { name: /saturation event history/i })).closest('section')!
    expect(await within(section).findByText('Test Street o')).toBeInTheDocument()
    await user.click(within(section).getByRole('button', { name: 'Open' }))
    expect(posts).toEqual([{ at: EVENT.startedAt, playing: false }])
  })
})

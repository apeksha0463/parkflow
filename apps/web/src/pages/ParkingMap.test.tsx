import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { CLOCK, mapZone, mockApi, predictions, renderApp, zone } from '../test/utils'

const A = zone('a', 11 / 12)
const B = zone('b', 0.5)
const C = zone('c', null)

function setup(extra?: (u: URL) => { body?: unknown; status?: number } | undefined) {
  const listCalls: URL[] = []
  const spy = mockApi((u) => {
    const x = extra?.(u)
    if (x) return x
    if (u.pathname === '/api/parking/map') return { body: { at: CLOCK.now, items: [A, B, C].map(mapZone) } }
    if (u.pathname === '/api/parking') {
      listCalls.push(u)
      return { body: { items: [C, B, A], page: 1, pageSize: 100, total: 3, origin: null, radiusMeters: null, at: CLOCK.now } }
    }
    if (u.pathname === '/api/parking/a/predictions') return { body: predictions([[5, 0.93], [15, 0.88], [30, 0.84]]) }
    if (u.pathname === '/api/parking/b/predictions') return { body: predictions([[5, 0.51], [15, 0.55], [30, 0.6]]) }
    if (u.pathname === '/api/parking/a') return { body: { at: CLOCK.now, facility: { ...A, zones: [{ id: 'za', name: 'x', kind: 'SEGMENT', capacity: 12, blockKey: '1:2-3' }] } } }
    if (u.pathname === '/api/parking/a/neighbours') return { body: { at: CLOCK.now, method: 'x', items: [B] } }
  })
  return { listCalls, spy }
}

describe('parking map', () => {
  it('lists zones in the map view with replayed occupancy and API forecasts, readings first', async () => {
    const user = userEvent.setup()
    const { listCalls } = setup()
    renderApp(<App />, { route: '/map' })
    await user.click(await screen.findByRole('button', { name: 'report bounds' }))
    const cardA = (await screen.findByRole('button', { name: 'Show Test Street a on the map' })).closest('article')!
    expect(listCalls[0].searchParams.get('bbox')).toBe('144.9,-37.83,145,-37.79')
    expect(within(cardA).getByText('92%')).toBeInTheDocument()
    expect(within(cardA).getByText('11 / 12 reporting spaces')).toBeInTheDocument()
    expect(within(cardA).getByText('Saturated')).toBeInTheDocument()
    expect(await within(cardA).findByText('93%')).toBeInTheDocument() // +5 min forecast from the API
    expect(within(cardA).getByText('+30 min')).toBeInTheDocument()
    // a zone without a reading is one compact row, not a large unavailable card, and gets no forecast request
    expect(screen.getByText('No sensor reading at this replay time')).toBeInTheDocument()
    const articles = screen.getAllByRole('article')
    expect(articles[0]).toBe(cardA)
    expect(within(articles[2]).queryByText(/forecast/i)).toBeNull()
  })

  it('selecting a zone on the map shows its details, forecast and research neighbours', async () => {
    const user = userEvent.setup()
    setup()
    renderApp(<App />, { route: '/map' })
    await user.click(await screen.findByRole('button', { name: 'map zone Test Street a' }))
    const panel = await screen.findByRole('article', { name: 'Selected zone' })
    expect(within(panel).getByText('Test Area · Block 1:2-3')).toBeInTheDocument()
    expect(within(panel).getByText('90%')).toBeInTheDocument() // saturation threshold from /api/config
    expect(await within(panel).findByText('88%')).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: /spillover intelligence/i })).toHaveAttribute('href', '/spillover?zone=a')
    expect(within(panel).getByRole('link', { name: /directions/i }).getAttribute('href')).toContain('to=-37.81%2C144.96')
    expect(await screen.findByTestId('map')).toHaveAttribute('data-highlights', 'b:neighbour')
  })

  it('searches a place and lists the nearest zones around it', async () => {
    const user = userEvent.setup()
    const { listCalls } = setup((u) => {
      if (u.pathname === '/api/search/geocode' && u.searchParams.get('mode') === 'full')
        return { body: { geocoder: 'ok', results: [{ id: 'nominatim:1', label: 'Some Place', sublabel: 'Melbourne', latitude: -37.815, longitude: 144.97, kind: 'place', source: 'OSM' }] } }
      if (u.pathname === '/api/search/geocode') return { body: { geocoder: 'not_used', results: [] } }
    })
    renderApp(<App />, { route: '/map' })
    await user.type(await screen.findByRole('combobox', { name: /search location/i }), 'some place{Enter}')
    await user.click(await screen.findByRole('option', { name: /some place/i }))
    expect(await screen.findByText(/within 600 m of some place/i)).toBeInTheDocument()
    const near = listCalls.find((u) => u.searchParams.get('lat'))!
    expect(near.searchParams.get('lat')).toBe('-37.815')
    expect(near.searchParams.get('sort')).toBe('distance')
    expect(screen.getByTestId('map').getAttribute('data-fly')).toBe('search-nominatim:1')
  })
})

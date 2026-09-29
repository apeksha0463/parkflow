import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
import { facility, mockApi, renderApp } from './test/utils'

const stats = {
  facilities: 1173,
  localities: 1121,
  liveAvailabilityFacilities: 0,
  demoFacilities: 0,
  byType: [{ type: 'OFF_STREET', label: 'Off-street', count: 448 }],
  sources: [{ name: 'OpenStreetMap', sourceType: 'VERIFIED_DIRECTORY', license: 'ODbL', url: null, lastVerifiedAt: '2026-06-01T08:52:28Z' }],
}

describe('routing', () => {
  it('renders the landing page with figures from the API', async () => {
    mockApi((u) => {
      if (u.pathname === '/api/stats') return { body: stats }
      if (u.pathname === '/api/parking/map') return { body: { items: [], truncated: false } }
    })
    renderApp(<App />)
    expect(await screen.findByRole('heading', { name: /know where to park before you arrive/i })).toBeInTheDocument()
    expect(await screen.findByText('1,173')).toBeInTheDocument()
    expect(screen.getByText('1,121')).toBeInTheDocument()
    // Illustrative content must be labelled as such.
    expect(screen.getByText(/illustrative example of the interface, not live data/i)).toBeInTheDocument()
  })

  it('renders 404 for unknown routes', async () => {
    mockApi(() => undefined)
    renderApp(<App />, { route: '/does-not-exist' })
    expect(await screen.findByRole('heading', { name: /page not found/i })).toBeInTheDocument()
  })
})

describe('explore flow', () => {
  it('prompts for a destination, then lists nearby parking after a search', async () => {
    const user = userEvent.setup()
    const parkingCalls: URL[] = []
    mockApi((u) => {
      if (u.pathname === '/api/parking/map') return { body: { items: [], truncated: false } }
      if (u.pathname === '/api/search/geocode')
        return { body: { geocoder: 'not_used', results: [{ id: 'locality:1', label: 'Koramangala', sublabel: 'Suburb, Bengaluru', latitude: 12.9352, longitude: 77.6245, kind: 'locality', source: 'OSM' }] } }
      if (u.pathname === '/api/parking') {
        parkingCalls.push(u)
        return { body: { items: [facility()], page: 1, pageSize: 20, total: 1, origin: { lat: 12.9352, lng: 77.6245 }, radiusMeters: 2000, sort: 'distance' } }
      }
    })
    renderApp(<App />, { route: '/explore' })
    expect(await screen.findByText(/where are you heading/i)).toBeInTheDocument()

    await user.type(screen.getByRole('combobox', { name: /search destination/i }), 'kora')
    await user.click(await screen.findByRole('option', { name: /koramangala/i }))

    // In the explore list a card focuses the map; details and directions are explicit links.
    expect(await screen.findByRole('button', { name: 'Show Forum Parking on the map' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Details' })).toHaveAttribute('href', '/parking/f1')
    expect(screen.getByRole('link', { name: /directions/i }).getAttribute('href')).toContain('to=12.93%2C77.61')
    expect(parkingCalls[0].searchParams.get('lat')).toBe('12.9352')
    expect(parkingCalls[0].searchParams.get('radius')).toBe('2000')
    expect(screen.getByText('Availability currently unavailable.')).toBeInTheDocument()
    expect(screen.getByText(/none of these facilities has a current availability source/i)).toBeInTheDocument()
  })

  it('shows an empty state with recovery actions when nothing is found', async () => {
    mockApi((u) => {
      if (u.pathname === '/api/parking/map') return { body: { items: [], truncated: false } }
      if (u.pathname === '/api/parking') return { body: { items: [], page: 1, pageSize: 20, total: 0, origin: null, radiusMeters: 2000, sort: 'distance' } }
    })
    renderApp(<App />, { route: '/explore?lat=12.9&lng=77.6&label=Somewhere' })
    expect(await screen.findByText(/no parking found here/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /widen to 5 km/i })).toBeInTheDocument()
  })

  it('shows a retryable error when the API is unreachable', async () => {
    const spy = mockApi(() => undefined)
    spy.mockRejectedValue(new TypeError('Failed to fetch'))
    renderApp(<App />, { route: '/explore?lat=12.9&lng=77.6&label=Somewhere' })
    expect(await screen.findByText(/can’t reach parkflow right now/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
})

describe('facility page', () => {
  it('shows honest unavailable states, source attribution and neighbours', async () => {
    mockApi((u) => {
      if (u.pathname === '/api/parking/f1') return { body: { facility: { ...facility({ name: null, displayName: 'Mall parking near Koramangala', nameIsDerived: true }), zones: [] } } }
      if (u.pathname === '/api/parking/f1/neighbours') return { body: { radiusMeters: 800, method: 'x', items: [facility({ id: 'f2', displayName: 'Nearby Lot', name: 'Nearby Lot' })] } }
    })
    renderApp(<App />, { route: '/parking/f1' })
    // first render of this lazily loaded route (includes the chart library) can take over a second in CI
    expect(await screen.findByRole('heading', { name: 'Mall parking near Koramangala' }, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByText(/this label is derived/i)).toBeInTheDocument()
    expect(screen.getByText('Prediction unavailable — insufficient historical data.')).toBeInTheDocument()
    expect(screen.getAllByText('Availability currently unavailable.').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /view source record/i })).toHaveAttribute('href', 'https://www.openstreetmap.org/way/1')
    expect(await screen.findByRole('link', { name: 'Nearby Lot' })).toBeInTheDocument()
  })

  it('shows not-found state for unknown facilities', async () => {
    mockApi(() => undefined)
    renderApp(<App />, { route: '/parking/nope' })
    expect(await screen.findByText(/parking facility not found/i)).toBeInTheDocument()
  })
})

describe('auth', () => {
  it('shows server errors on failed login', async () => {
    const user = userEvent.setup()
    mockApi((u) => {
      if (u.pathname === '/api/auth/login') return { status: 401, body: { error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect email or password.' } } }
    })
    renderApp(<App />, { route: '/login' })
    await user.type(await screen.findByLabelText('Email'), 'a@b.co')
    await user.type(screen.getByLabelText('Password'), 'wrong-pass')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.')
  })

  it('validates registration fields before submitting', async () => {
    const user = userEvent.setup()
    const spy = mockApi(() => undefined)
    renderApp(<App />, { route: '/register' })
    await user.click(await screen.findByRole('button', { name: 'Create account' }))
    expect(screen.getByText('Enter your name')).toBeInTheDocument()
    expect(screen.getByText('Use at least 8 characters')).toBeInTheDocument()
    expect(spy.mock.calls.some(([u]) => String(u).includes('/register'))).toBe(false)
  })
})

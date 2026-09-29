import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { AuthProvider } from '../auth/AuthContext'
import type { Facility } from '../lib/types'

type Handler = (url: URL, init?: RequestInit) => { status?: number; body?: unknown } | undefined

/** Routes fetch calls to handlers; unmatched requests return 404 JSON. Returns the spy. */
export function mockApi(handler: Handler) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    const res = handler(url, init) ?? (url.pathname === '/api/auth/me' ? { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'Please sign in' } } } : undefined)
    if (!res) return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), { status: 404 })
    return new Response(res.status === 204 ? null : JSON.stringify(res.body ?? {}), { status: res.status ?? 200 })
  })
}

export function renderApp(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>{ui}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

export function facility(overrides: Partial<Facility> = {}): Facility {
  return {
    id: 'f1',
    name: 'Forum Parking',
    displayName: 'Forum Parking',
    nameIsDerived: false,
    type: 'MALL',
    typeLabel: 'Mall',
    address: null,
    area: 'Koramangala',
    locality: null,
    latitude: 12.93,
    longitude: 77.61,
    distanceMeters: 420,
    capacity: null,
    vehicleTypes: [],
    evCharging: null,
    pricingText: null,
    isFree: null,
    operatingHours: null,
    openNow: null,
    availabilityMode: 'NONE',
    isDemo: false,
    bookingEnabled: false,
    availability: {
      state: 'UNAVAILABLE',
      message: 'Availability currently unavailable.',
      occupied: null,
      available: null,
      capacity: null,
      occupancy: null,
      observedAt: null,
      ageMinutes: null,
      sourceType: null,
    },
    source: { name: 'OpenStreetMap', sourceType: 'VERIFIED_DIRECTORY', url: null, license: 'ODbL', recordUrl: 'https://www.openstreetmap.org/way/1', lastVerifiedAt: '2026-06-01T00:00:00Z' },
    ...overrides,
  }
}

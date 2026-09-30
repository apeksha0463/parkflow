import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
import { CLOCK, mapZone, mockApi, renderApp, zone } from './test/utils'

describe('overview', () => {
  it('shows figures from the API and the replay context, never live', async () => {
    mockApi((u) => {
      if (u.pathname === '/api/parking/map') return { body: { at: CLOCK.now, items: [zone('a', 0.95), zone('b', 0.5), zone('c', null)].map(mapZone) } }
    })
    renderApp(<App />)
    expect(await screen.findByRole('heading', { name: /forecast parking-pressure spillover before neighbouring zones become saturated/i })).toBeInTheDocument()
    expect(await screen.findByText('321')).toBeInTheDocument()
    expect(screen.getByText('4,567')).toBeInTheDocument()
    expect(screen.getByText('250 m')).toBeInTheDocument()
    expect(screen.getByText('5 · 15 · 30')).toBeInTheDocument()
    // replay bar: recorded 2019 time in Melbourne time, labelled as historical replay
    expect(await screen.findByText(/Tue, 5 Nov 2019, 11:05/)).toBeInTheDocument()
    expect(screen.getAllByText(/historical replay/i).length).toBeGreaterThan(0)
    expect(screen.queryByText(/\blive availability\b/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Parking Map' })).toHaveAttribute('href', '/map')
  })

  it('controls the shared replay clock', async () => {
    const user = userEvent.setup()
    const posts: unknown[] = []
    mockApi((u, init) => {
      if (u.pathname === '/api/replay' && init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)))
        return { body: { ...CLOCK, playing: true } }
      }
    })
    renderApp(<App />)
    await user.click(await screen.findByRole('button', { name: 'Play replay' }))
    expect(posts).toEqual([{ playing: true }])
    expect(await screen.findByRole('button', { name: 'Pause replay' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Forward 1 hour' }))
    expect(posts[1]).toEqual({ at: '2019-11-05T01:05:00.000Z' })
  })

  it('has a working mobile menu', async () => {
    const user = userEvent.setup()
    mockApi(() => undefined)
    renderApp(<App />)
    await user.click(await screen.findByRole('button', { name: 'Open menu' }))
    const nav = document.getElementById('mobile-nav')!
    expect(within(nav).getByRole('link', { name: 'Spillover Intelligence' })).toHaveAttribute('href', '/spillover')
    await user.click(within(nav).getByRole('link', { name: 'Research & Models' }))
    expect(document.getElementById('mobile-nav')).toBeNull()
  })

  it('renders 404 for unknown routes', async () => {
    mockApi(() => undefined)
    renderApp(<App />, { route: '/does-not-exist' })
    expect(await screen.findByRole('heading', { name: /page not found/i })).toBeInTheDocument()
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

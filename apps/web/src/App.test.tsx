import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from './App'

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )

describe('routing', () => {
  it('renders the home page', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: /know where to park/i })).toBeInTheDocument()
  })
  it('renders 404 for unknown routes', () => {
    renderAt('/does-not-exist')
    expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument()
  })
})

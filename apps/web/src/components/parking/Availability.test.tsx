import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Availability } from '../../lib/types'
import { AvailabilityInline, AvailabilityPanel } from './Availability'

const base: Availability = {
  state: 'UNAVAILABLE',
  message: 'Availability currently unavailable.',
  occupied: null,
  available: null,
  capacity: null,
  occupancy: null,
  observedAt: null,
  ageMinutes: null,
  sourceType: null,
}

describe('availability display', () => {
  it('shows simulated data with numbers, freshness and a simulation label', () => {
    render(<AvailabilityPanel availability={{ ...base, state: 'SIMULATED', message: 'x', occupied: 92, available: 8, capacity: 100, occupancy: 0.92, ageMinutes: 3 }} />)
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('92%')).toBeInTheDocument()
    expect(screen.getByText('Nearly full')).toBeInTheDocument()
    expect(screen.getByText(/updated 3 min ago/i)).toBeInTheDocument()
    expect(screen.getByText(/not live sensor data/i)).toBeInTheDocument()
  })

  it('never shows stale readings as current numbers', () => {
    render(<AvailabilityPanel availability={{ ...base, state: 'STALE', message: 'x', occupied: 50, available: 50, capacity: 100, occupancy: 0.5, ageMinutes: 95 }} />)
    expect(screen.getByText(/out of date/i)).toBeInTheDocument()
    expect(screen.queryByText('50%')).not.toBeInTheDocument()
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
  })

  it('states plainly when availability is unavailable', () => {
    render(<AvailabilityInline availability={base} />)
    expect(screen.getByText('Availability currently unavailable.')).toBeInTheDocument()
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
  })
})

import { describe, expect, it } from 'vitest'
import { statusFromOccupancy } from './status'

describe('statusFromOccupancy', () => {
  it('maps occupancy bands', () => {
    expect(statusFromOccupancy(0.2)).toBe('available')
    expect(statusFromOccupancy(0.6)).toBe('moderate')
    expect(statusFromOccupancy(0.9)).toBe('nearly_full')
    expect(statusFromOccupancy(1)).toBe('full')
  })
  it('never guesses when data is missing or stale', () => {
    expect(statusFromOccupancy(null)).toBe('unknown')
    expect(statusFromOccupancy(undefined)).toBe('unknown')
    expect(statusFromOccupancy(0.3, { stale: true })).toBe('unknown')
  })
  it('respects a configured saturation threshold', () => {
    expect(statusFromOccupancy(0.86, { thresholds: { moderate: 0.6, saturation: 0.85 } })).toBe('nearly_full')
  })
})

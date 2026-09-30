import { describe, expect, it } from 'vitest'
import { formatPercent, formatPp, fromLocalInput, toLocalInput } from './format'

describe('format', () => {
  it('shows unknown as a dash, never 0%', () => {
    expect(formatPercent(null)).toBe('—')
    expect(formatPercent(0.925)).toBe('93%')
    expect(formatPp(0.0543)).toBe('5.43 pp')
  })

  it('round-trips Melbourne wall time (AEDT in November)', () => {
    expect(toLocalInput('2019-11-05T00:05:00.000Z')).toBe('2019-11-05T11:05')
    expect(fromLocalInput('2019-11-05T11:05')).toBe('2019-11-05T00:05:00.000Z')
  })
})

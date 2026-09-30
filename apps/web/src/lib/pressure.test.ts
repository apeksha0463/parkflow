import { describe, expect, it } from 'vitest'
import { pressureFromLevel, pressureOf } from './pressure'

const t = { moderate: 0.6, approaching: 0.8, saturation: 0.9 }

describe('pressure bands', () => {
  it('maps occupancy to bands at the configured thresholds', () => {
    expect(pressureOf(0.3, t)).toBe('normal')
    expect(pressureOf(0.6, t)).toBe('moderate')
    expect(pressureOf(0.8, t)).toBe('high')
    expect(pressureOf(0.9, t)).toBe('saturated')
    expect(pressureOf(1, t)).toBe('saturated')
  })

  it('never guesses a band without a reading', () => {
    expect(pressureOf(null, t)).toBe('unknown')
    expect(pressureOf(Number.NaN, t)).toBe('unknown')
  })

  it('follows the server level when one is given', () => {
    expect(pressureFromLevel('SATURATED', 0.5, t)).toBe('saturated')
    expect(pressureFromLevel('APPROACHING_SATURATION', null, t)).toBe('high')
    expect(pressureFromLevel('NORMAL', 0.7, t)).toBe('moderate')
    expect(pressureFromLevel(null, null, t)).toBe('unknown')
  })
})

/**
 * Parking-pressure bands shown in the UI.
 * The saturation and high-pressure thresholds come from the server (/api/config) so colours match the
 * server's saturation logic; "moderate" is a display band only (it has no role in the research).
 * "unknown" is used whenever there is no current reading — values are never guessed.
 */
import type { PressureLevel } from './types'

export type Pressure = 'normal' | 'moderate' | 'high' | 'saturated' | 'unknown'

export interface Thresholds {
  moderate: number
  approaching: number
  saturation: number
}

/** Display-only lower band edge for "moderate". */
export const MODERATE_DISPLAY_BAND = 0.6

export function pressureOf(occupancy: number | null | undefined, t: Thresholds): Pressure {
  if (occupancy == null || Number.isNaN(occupancy)) return 'unknown'
  if (occupancy >= t.saturation) return 'saturated'
  if (occupancy >= t.approaching) return 'high'
  if (occupancy >= t.moderate) return 'moderate'
  return 'normal'
}

/** Server pressure level (NORMAL / APPROACHING / SATURATED) as a UI band; NORMAL is refined by occupancy. */
export function pressureFromLevel(level: PressureLevel | null, occupancy: number | null, t: Thresholds): Pressure {
  if (level === 'SATURATED') return 'saturated'
  if (level === 'APPROACHING_SATURATION') return 'high'
  if (level === 'NORMAL') return occupancy != null && occupancy >= t.moderate ? 'moderate' : 'normal'
  return pressureOf(occupancy, t)
}

export const PRESSURE_LABEL: Record<Pressure, string> = {
  normal: 'Normal',
  moderate: 'Moderate',
  high: 'High pressure',
  saturated: 'Saturated',
  unknown: 'No reading',
}

/** Hex values for places that cannot use CSS variables (Leaflet paths, chart libraries). Mirrors index.css. */
export const PRESSURE_HEX: Record<Pressure, string> = {
  normal: '#16a34a',
  moderate: '#ca8a04',
  high: '#ea580c',
  saturated: '#dc2626',
  unknown: '#94a3b8',
}

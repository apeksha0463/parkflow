/**
 * Semantic parking status derived from observed occupancy.
 * Thresholds mirror the server's configurable saturation threshold (default 0.9).
 * "unknown" is used whenever we do not have trustworthy data — we never guess.
 */
export type ParkingStatus = 'available' | 'moderate' | 'nearly_full' | 'full' | 'unknown'

export interface StatusThresholds {
  moderate: number
  saturation: number
}

export const DEFAULT_THRESHOLDS: StatusThresholds = { moderate: 0.6, saturation: 0.9 }

export function statusFromOccupancy(
  occupancy: number | null | undefined,
  opts: { stale?: boolean; thresholds?: StatusThresholds } = {},
): ParkingStatus {
  const t = opts.thresholds ?? DEFAULT_THRESHOLDS
  if (occupancy == null || Number.isNaN(occupancy) || opts.stale) return 'unknown'
  if (occupancy >= 1) return 'full'
  if (occupancy >= t.saturation) return 'nearly_full'
  if (occupancy >= t.moderate) return 'moderate'
  return 'available'
}

export const STATUS_LABEL: Record<ParkingStatus, string> = {
  available: 'Available',
  moderate: 'Moderate',
  nearly_full: 'Nearly full',
  full: 'Full',
  unknown: 'Unavailable',
}

import type { Availability, Facility } from './types'

/**
 * Where a displayed availability or prediction value comes from. Every value on a card carries one of these.
 * LIVE: real sensor/feed · API: third-party public API · HISTORICAL: past data only, not current
 * SIMULATION: research replay (Melbourne 2019 dataset) on labelled demo zones · UNAVAILABLE: no source.
 */
export type SourceKind = 'LIVE' | 'API' | 'HISTORICAL' | 'SIMULATION' | 'UNAVAILABLE'

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  LIVE: 'Live',
  API: 'API',
  HISTORICAL: 'Historical',
  SIMULATION: 'Simulation · Research',
  UNAVAILABLE: 'Unavailable',
}

export function availabilityKind(a: Availability): SourceKind {
  switch (a.state) {
    case 'SIMULATED':
      return 'SIMULATION'
    case 'LIVE':
      return a.sourceType === 'PUBLIC_API' ? 'API' : 'LIVE'
    case 'STALE':
    case 'HISTORICAL_ONLY':
      return 'HISTORICAL'
    default:
      return 'UNAVAILABLE'
  }
}

/** The only trained model is the research model; it is applied to simulation zones only. */
export const predictionKind = (f: Pick<Facility, 'availabilityMode'>): SourceKind => (f.availabilityMode === 'SIMULATION' ? 'SIMULATION' : 'UNAVAILABLE')

export const NO_HISTORY_MESSAGE = 'Prediction unavailable — insufficient historical data.'
export const NO_MODEL_MESSAGE = 'Prediction unavailable — no model has been trained for this area yet.'

/** Why a facility has no prediction (no request is made): no occupancy history, or no model for real facilities. */
export const predictionUnavailableReason = (f: Pick<Facility, 'availabilityMode'>) => (f.availabilityMode === 'NONE' ? NO_HISTORY_MESSAGE : NO_MODEL_MESSAGE)

const SOURCE_TYPE_TEXT: Record<string, string> = {
  LIVE_SENSOR: 'live sensors',
  PUBLIC_API: 'public API',
  PARKING_OPERATOR: 'operator feed',
  HISTORICAL_DATA: 'historical records',
  SIMULATION: 'research data replay',
}

/** Human description of an availability source type, or null when unknown. */
export const sourceTypeText = (t: string | null) => (t ? SOURCE_TYPE_TEXT[t] ?? null : null)

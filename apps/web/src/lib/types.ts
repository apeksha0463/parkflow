/** API response shapes (apps/api). Every value here comes from the API; the UI never fills in gaps. */

export type AvailabilityState = 'LIVE' | 'REPLAY' | 'STALE' | 'HISTORICAL_ONLY' | 'UNAVAILABLE'
export type PressureLevel = 'NORMAL' | 'APPROACHING_SATURATION' | 'SATURATED'
export type PredictionStatus = 'AVAILABLE' | 'INSUFFICIENT_DATA' | 'NO_MODEL' | 'STALE' | 'SERVICE_UNAVAILABLE'

export interface Availability {
  state: AvailabilityState
  message: string
  occupied: number | null
  available: number | null
  capacity: number | null
  occupancy: number | null
  observedAt: string | null
  ageMinutes: number | null
  sourceType: string | null
}

/** A monitored sensor zone (a City of Melbourne street block). */
export interface Zone {
  id: string
  name: string | null
  externalId: string | null
  displayName: string
  nameIsDerived: boolean
  type: string
  typeLabel: string
  address: string | null
  area: string | null
  latitude: number
  longitude: number
  distanceMeters: number | null
  capacity: number | null
  availabilityMode: 'NONE' | 'LIVE' | 'REPLAY'
  pressureLevel: PressureLevel | null
  availability: Availability
  source: { name: string; sourceType: string; url: string | null; license: string | null; recordUrl: string | null; lastVerifiedAt: string | null }
}

export interface ZoneDetail extends Zone {
  zones: { id: string; name: string; kind: string; capacity: number | null; blockKey: string | null }[]
}

export interface ZoneList {
  items: Zone[]
  page: number
  pageSize: number
  total: number
  origin: { lat: number; lng: number } | null
  radiusMeters: number | null
  at: string
}

export interface MapZone {
  id: string
  displayName: string
  latitude: number
  longitude: number
  availabilityState: AvailabilityState
  occupancy: number | null
  available: number | null
  capacity: number | null
  pressureLevel: PressureLevel | null
}

export interface SearchResult {
  id: string
  label: string
  sublabel: string | null
  latitude: number
  longitude: number
  kind: 'zone' | 'place'
  source: string
}

export interface User {
  id: string
  email: string
  name: string
  role: 'USER' | 'ADMIN'
  createdAt: string
}

export interface ReplayRange {
  start: string
  end: string
  timezone: string
  dataset: string
}

export interface ReplayClock {
  mode: 'HISTORICAL_REPLAY' | 'NOT_CONFIGURED'
  now: string
  playing: boolean
  speed: number
  stepMinutes: number
  range: ReplayRange | null
}

export interface OverviewStats {
  zones: number
  zonesWithNeighbours: number
  neighbourRelations: number
  saturationEvents: number
  bounds: { south: number; west: number; north: number; east: number } | null
  replay: { mode: ReplayClock['mode']; range: ReplayRange | null }
  model: {
    status: 'available' | 'unavailable'
    active: string | null
    featureSet: string | null
    horizonsMinutes: number[] | null
    neighbourRadiusMeters: number | null
    saturationThreshold: number | null
    models: { id: string; featureSet: string }[]
  }
  sources: { name: string; sourceType: string; license: string | null; url: string | null; description: string | null }[]
}

export interface PublicConfig {
  saturationThreshold: number
  approachingThreshold: number
  staleAfterMinutes: number
}

export interface HorizonPrediction {
  horizonMinutes: number
  targetTime?: string
  predictedOccupancy: number
  pressureLevel: PressureLevel | null
}

export interface ZonePredictions {
  status: PredictionStatus
  message: string | null
  provenance: 'PREDICTED'
  model: { id: string; featureSet: string; trainingDataset: string; trainedAt: string } | null
  zones: {
    zoneId: string
    zoneName: string
    basedOn: string
    currentOccupancy: number
    currentState: PressureLevel | null
    neighboursUsed: number
    predictions: HorizonPrediction[]
  }[]
}

export interface SaturationEventRef {
  id: string
  zoneId: string
  startedAt: string
  endedAt: string | null
  peakOccupancy: number
  threshold: number
}

export interface SaturationEvent {
  id: string
  startedAt: string
  endedAt: string | null
  durationMinutes: number | null
  peakOccupancy: number
  threshold: number
  activeAtReplayTime: boolean
  zone: { id: string; name: string; neighbourCount: number }
  facility: { id: string; displayName: string; area: string | null; latitude: number; longitude: number; capacity: number | null }
}

export interface EventList {
  total: number
  page: number
  pageSize: number
  replayTime: string
  items: SaturationEvent[]
}

export interface SpilloverCandidate {
  id: string
  displayName: string
  latitude: number
  longitude: number
  distanceMeters: number
  availability: Availability
  predicted: HorizonPrediction | null
  predictionStatus: PredictionStatus
}

export interface SpilloverWarning {
  facilityId: string
  displayName: string
  distanceMeters: number
  currentOccupancy: number
  predictedOccupancy: number
  horizonMinutes: number
  message: string
}

export interface Spillover {
  facilityId: string
  at: string
  thresholds: { saturation: number; approaching: number }
  neighbourRadiusMeters: number | null
  warningHorizonMinutes: number
  origin: {
    availability: Availability
    pressureLevel: PressureLevel | null
    activeSaturationEvent: SaturationEventRef | null
    predictions: ZonePredictions | null
  }
  spilloverContext: boolean
  warnings: SpilloverWarning[]
  alternatives: (SpilloverCandidate & { score: number; reason: string })[]
  neighbours: SpilloverCandidate[]
}

export interface PvaPoint {
  predictionTime: string
  targetTime: string
  actual: number | null
  persistence: number | null
  predicted: Record<string, number | null>
}

export interface PredictedVsActual {
  status: 'AVAILABLE' | 'NO_MODEL' | 'SERVICE_UNAVAILABLE'
  message: string | null
  result: {
    zoneName: string
    zoneId: string
    neighboursUsed: number
    models: { id: string; featureSet: string; active: boolean }[]
    horizons: { horizonMinutes: number; points: PvaPoint[] }[]
  } | null
}

// ---------------------------------------------------------------- research (results.json, unmodified)

export interface MetricRow {
  horizon_min: number
  feature_set: string
  model: string
  subset: string
  n: number
  mae: number
  rmse: number
  r2: number
}

export interface Evaluation {
  generated_at: string
  config: {
    dataset: string
    bucket_minutes: number
    horizons_minutes: number[]
    saturation_threshold: number
    approaching_margin?: number
    neighbour_radius_m: number
    experiment_hours: [number, number]
    features: { temporal: string[]; spatial_temporal: string[] }
  }
  splits: Record<'train' | 'validation' | 'test', { range: [string, string]; samples: number }>
  zones_in_experiment: number
  zones_with_neighbours: number
  saturation_events: { events: number; zones_with_events: number; median_duration_min: number }
  metrics: MetricRow[]
  comparisons: {
    horizon_min: number
    model: string
    subset: string
    n: number
    mae_temporal: number
    mae_spatial_temporal: number
    mae_reduction_pct: number
    bootstrap: { days: number; mae_diff_mean: number; ci95: [number, number] }
  }[]
}

export interface DatasetReports {
  dataset: string
  ingest: { raw_rows: number; final_rows: number; devices: number; zones: number; first_start: string; last_end: string } | null
  occupancy: { grid_step_minutes: number; zones_with_any_valid: number; valid_fraction: number; min_observed_bays: number } | null
  geo: { zones: number; zones_located: number; neighbour_radius_m: number; neighbour_pairs: number; neighbours_per_zone: { '50%': number } } | null
}

export interface ModelPerformance {
  mlService: 'up' | 'unavailable'
  registry: { active: string; active_selected_by?: string; models: { id: string; feature_set: string; algorithm: string; trained_at: string }[] } | null
  offline: Evaluation | null
  dataset: DatasetReports | null
}

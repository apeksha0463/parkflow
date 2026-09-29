export type ParkingType =
  | 'PUBLIC'
  | 'ON_STREET'
  | 'OFF_STREET'
  | 'MULTI_LEVEL'
  | 'UNDERGROUND'
  | 'MALL'
  | 'HOSPITAL'
  | 'HOTEL'
  | 'METRO'
  | 'RAILWAY'
  | 'EDUCATIONAL'
  | 'COMMERCIAL'
  | 'PRIVATE_PUBLIC_ACCESS'
  | 'RESIDENTIAL'
  | 'EV_CHARGING'
  | 'UNKNOWN'

export type VehicleType = 'CAR' | 'TWO_WHEELER' | 'BICYCLE' | 'BUS' | 'TRUCK'

export type AvailabilityState = 'LIVE' | 'SIMULATED' | 'STALE' | 'HISTORICAL_ONLY' | 'UNAVAILABLE'

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

export interface Facility {
  id: string
  name: string | null
  displayName: string
  nameIsDerived: boolean
  type: ParkingType
  typeLabel: string
  address: string | null
  area: string | null
  locality: { id: string; name: string } | null
  latitude: number
  longitude: number
  distanceMeters: number | null
  capacity: number | null
  vehicleTypes: VehicleType[]
  evCharging: boolean | null
  pricingText: string | null
  isFree: boolean | null
  operatingHours: string | null
  openNow: boolean | null
  availabilityMode: 'NONE' | 'LIVE' | 'SIMULATION'
  isDemo: boolean
  bookingEnabled: boolean
  availability: Availability
  source: {
    name: string
    sourceType: string
    url: string | null
    license: string | null
    recordUrl: string | null
    lastVerifiedAt: string | null
  }
}

export interface FacilityDetail extends Facility {
  zones: { id: string; name: string; kind: string; levelNumber: number | null; capacity: number | null; saturationState: string }[]
}

export interface Paginated<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}

export interface FacilityList extends Paginated<Facility> {
  origin: { lat: number; lng: number } | null
  radiusMeters: number | null
  sort: string
}

export interface MapMarker {
  id: string
  latitude: number
  longitude: number
  type: ParkingType
  isDemo: boolean
  availabilityState: AvailabilityState
  occupancy: number | null
}

export interface SearchResult {
  id: string
  label: string
  sublabel: string | null
  latitude: number
  longitude: number
  kind: 'locality' | 'place'
  source: string
}

export interface User {
  id: string
  email: string
  name: string
  role: 'USER' | 'ADMIN'
  createdAt: string
}

export interface PublicStats {
  facilities: number
  localities: number
  liveAvailabilityFacilities: number
  demoFacilities: number
  byType: { type: ParkingType; label: string; count: number }[]
  sources: { name: string; sourceType: string; license: string | null; url: string | null; lastVerifiedAt: string | null }[]
}

export interface PublicConfig {
  saturationThreshold: number
  approachingThreshold: number
  staleAfterMinutes: number
}

export type PredictionStatus = 'AVAILABLE' | 'INSUFFICIENT_DATA' | 'NO_MODEL' | 'STALE' | 'SERVICE_UNAVAILABLE'
export type PressureLevel = 'NORMAL' | 'APPROACHING_SATURATION' | 'SATURATED'

export interface HorizonPrediction {
  horizonMinutes: number
  targetTime?: string
  predictedOccupancy: number
  pressureLevel: PressureLevel | null
}

export interface FacilityPredictions {
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
    isSimulated: boolean
    predictions: HorizonPrediction[]
  }[]
}

export interface SpilloverCandidate {
  id: string
  displayName: string
  type: ParkingType
  latitude: number
  longitude: number
  distanceMeters: number
  openNow: boolean | null
  availability: Availability
  predicted: HorizonPrediction | null
  predictionStatus: PredictionStatus
}

export interface Spillover {
  facilityId: string
  thresholds: { saturation: number; approaching: number }
  neighbourRadiusMeters: number
  origin: {
    availability: Availability
    pressureLevel: PressureLevel | null
    activeSaturationEvent: { id: string; startedAt: string; peakOccupancy: number; threshold: number; isSimulated: boolean } | null
  }
  spilloverContext: boolean
  warnings: { facilityId: string; displayName: string; currentOccupancy: number; predictedOccupancy: number; horizonMinutes: number; message: string }[]
  alternatives: (SpilloverCandidate & { score: number; reason: string })[]
  neighbours: SpilloverCandidate[]
}

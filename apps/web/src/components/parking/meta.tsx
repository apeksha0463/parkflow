import {
  BatteryCharging,
  Building,
  Building2,
  CarFront,
  GraduationCap,
  Home,
  Hospital,
  Hotel,
  Layers,
  MapPin,
  ParkingSquare,
  ShoppingBag,
  SquareParking,
  TrainFront,
  TramFront,
  Warehouse,
  type LucideIcon,
} from 'lucide-react'
import type { ParkingType } from '../../lib/types'

export const TYPE_ICON: Record<ParkingType, LucideIcon> = {
  PUBLIC: ParkingSquare,
  ON_STREET: CarFront,
  OFF_STREET: SquareParking,
  MULTI_LEVEL: Layers,
  UNDERGROUND: Warehouse,
  MALL: ShoppingBag,
  HOSPITAL: Hospital,
  HOTEL: Hotel,
  METRO: TramFront,
  RAILWAY: TrainFront,
  EDUCATIONAL: GraduationCap,
  COMMERCIAL: Building2,
  PRIVATE_PUBLIC_ACCESS: Building,
  RESIDENTIAL: Home,
  EV_CHARGING: BatteryCharging,
  UNKNOWN: MapPin,
}

export const TYPE_LABEL: Record<ParkingType, string> = {
  PUBLIC: 'Public',
  ON_STREET: 'On-street',
  OFF_STREET: 'Off-street',
  MULTI_LEVEL: 'Multi-level',
  UNDERGROUND: 'Underground',
  MALL: 'Mall',
  HOSPITAL: 'Hospital',
  HOTEL: 'Hotel',
  METRO: 'Metro',
  RAILWAY: 'Railway',
  EDUCATIONAL: 'Campus',
  COMMERCIAL: 'Commercial',
  PRIVATE_PUBLIC_ACCESS: 'Private (public access)',
  RESIDENTIAL: 'Residential',
  EV_CHARGING: 'EV charging',
  UNKNOWN: 'Unclassified',
}

/** Types offered as filters, in display order. */
export const FILTER_TYPES: ParkingType[] = [
  'PUBLIC',
  'OFF_STREET',
  'ON_STREET',
  'MULTI_LEVEL',
  'UNDERGROUND',
  'METRO',
  'MALL',
  'COMMERCIAL',
  'HOSPITAL',
  'EDUCATIONAL',
  'EV_CHARGING',
  'RESIDENTIAL',
  'UNKNOWN',
]

export function TypeIcon({ type, className }: { type: ParkingType; className?: string }) {
  const Icon = TYPE_ICON[type]
  return <Icon className={className} aria-hidden />
}

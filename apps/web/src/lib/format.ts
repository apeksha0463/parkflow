export function formatDistance(m: number | null | undefined): string {
  if (m == null) return ''
  if (m < 1000) return `${Math.round(m / 10) * 10} m`
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`
}

export function formatPercent(fraction: number | null | undefined): string {
  if (fraction == null) return '—'
  return `${Math.round(fraction * 100)}%`
}

export function formatAge(minutes: number | null | undefined): string {
  if (minutes == null) return ''
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const h = Math.round(minutes / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Unknown'
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}

export const VEHICLE_LABEL: Record<string, string> = {
  CAR: 'Car',
  TWO_WHEELER: 'Two-wheeler',
  BICYCLE: 'Bicycle',
  BUS: 'Bus',
  TRUCK: 'Truck',
}

/** OpenStreetMap routing to the facility's recorded coordinates (the user picks their start point there). */
export function directionsUrl(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/directions?to=${lat}%2C${lng}#map=17/${lat}/${lng}`
}

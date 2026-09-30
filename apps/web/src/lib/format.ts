/** Formatting helpers. Times of the replayed data are shown in the data's own timezone (Melbourne). */
export const DATA_TZ = 'Australia/Melbourne'
const LOCALE = 'en-AU'

export function formatDistance(m: number | null | undefined): string {
  if (m == null) return ''
  if (m < 1000) return `${Math.round(m / 10) * 10} m`
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`
}

export function formatPercent(fraction: number | null | undefined): string {
  if (fraction == null || Number.isNaN(fraction)) return '—'
  return `${Math.round(fraction * 100)}%`
}

/** Percentage points, for errors on occupancy fractions (e.g. MAE 0.0543 -> "5.43 pp"). */
export const formatPp = (x: number, digits = 2) => `${(x * 100).toFixed(digits)} pp`

export const formatInt = (n: number) => n.toLocaleString(LOCALE)

const dtf = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(LOCALE, { timeZone: DATA_TZ, ...o })
const fDateTime = dtf({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const fTime = dtf({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const fDate = dtf({ day: 'numeric', month: 'short', year: 'numeric' })
const fShort = dtf({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export const formatDateTime = (iso: string | null | undefined) => (iso ? fDateTime.format(new Date(iso)) : '—')
export const formatShortDateTime = (iso: string | null | undefined) => (iso ? fShort.format(new Date(iso)) : '—')
export const formatTime = (iso: string | null | undefined) => (iso ? fTime.format(new Date(iso)) : '—')
export const formatDate = (iso: string | null | undefined) => (iso ? fDate.format(new Date(iso)) : '—')

/** Short timezone name at an instant (AEDT / AEST). */
export function tzName(iso: string): string {
  return dtf({ timeZoneName: 'short' }).formatToParts(new Date(iso)).find((p) => p.type === 'timeZoneName')?.value ?? DATA_TZ
}

/** "YYYY-MM-DDTHH:mm" in the data timezone, for <input type="datetime-local">. */
export function toLocalInput(iso: string): string {
  const p = Object.fromEntries(dtf({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

/** Inverse of toLocalInput: a data-timezone wall time to an ISO instant (offset resolved at that instant). */
export function fromLocalInput(local: string): string {
  const guess = new Date(`${local}:00Z`)
  // offset of the data timezone at (approximately) that instant, in minutes
  const asLocal = new Date(`${toLocalInput(guess.toISOString())}:00Z`)
  const offset = asLocal.getTime() - guess.getTime()
  return new Date(guess.getTime() - offset).toISOString()
}

/** OpenStreetMap routing to the zone's recorded coordinates (the user picks their start point there). */
export function directionsUrl(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/directions?to=${lat}%2C${lng}#map=18/${lat}/${lng}`
}

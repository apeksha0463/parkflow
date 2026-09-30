/**
 * Location search for the Melbourne map.
 *  - suggest: our own sensor zones (street descriptions from the City of Melbourne data). Used while typing.
 *  - full:    zones + Nominatim geocoding bounded to Greater Melbourne. Used on explicit submit only,
 *             because Nominatim's usage policy forbids autocomplete. Throttled to 1 req/s and cached.
 */
import { config } from '../config.js';
import { prisma } from '../lib/db.js';

/** Search bounds for the geocoder: Greater Melbourne (west, south, east, north). */
export const MELBOURNE_VIEWBOX = { west: 144.55, south: -38.2, east: 145.45, north: -37.55 };

export interface SearchResult {
  id: string;
  label: string;
  sublabel: string | null;
  latitude: number;
  longitude: number;
  kind: 'zone' | 'place';
  source: string;
}

/** Sensor zones whose street description or area matches the query. */
export async function searchZones(q: string, limit = 6): Promise<SearchResult[]> {
  const needle = q.trim().toLowerCase();
  const rows = await prisma.$queryRaw<{ id: string; name: string; area: string | null; latitude: number; longitude: number }[]>`
    SELECT f.id, f.name, f.area, f.latitude, f.longitude
      FROM "ParkingFacility" f
     WHERE f.name IS NOT NULL AND (lower(f.name) LIKE ${'%' + needle + '%'} OR lower(coalesce(f.area, '')) LIKE ${needle + '%'})
     ORDER BY (lower(f.name) LIKE ${needle + '%'}) DESC, f.name
     LIMIT ${limit}`;
  return rows.map((r) => ({
    id: `zone:${r.id}`,
    label: r.name,
    sublabel: r.area ? `Sensor zone · ${r.area}` : 'Sensor zone',
    latitude: r.latitude,
    longitude: r.longitude,
    kind: 'zone',
    source: 'City of Melbourne parking sensors',
  }));
}

// ---------------------------------------------------------------------------
// Nominatim client (throttled + cached, per https://operations.osmfoundation.org/policies/nominatim/)
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const MIN_INTERVAL_MS = 1100;
const cache = new Map<string, { at: number; results: SearchResult[] }>();
let queue: Promise<unknown> = Promise.resolve();
let lastCall = 0;

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastCall + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

interface NominatimItem {
  place_id: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  category?: string;
  type?: string;
}

export class GeocoderUnavailableError extends Error {}

export async function searchNominatim(q: string, fetchImpl: typeof fetch = fetch): Promise<SearchResult[]> {
  const key = q.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.results;

  const params = new URLSearchParams({
    q: key,
    format: 'jsonv2',
    countrycodes: 'au',
    viewbox: `${MELBOURNE_VIEWBOX.west},${MELBOURNE_VIEWBOX.north},${MELBOURNE_VIEWBOX.east},${MELBOURNE_VIEWBOX.south}`,
    bounded: '1',
    limit: '10',
  });
  const items = await throttled(async () => {
    try {
      const res = await fetchImpl(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: { 'User-Agent': config.GEOCODER_USER_AGENT, 'Accept-Language': 'en' },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as NominatimItem[];
    } catch (err) {
      throw new GeocoderUnavailableError((err as Error).message);
    }
  });

  const results: SearchResult[] = items.map((it) => {
    const [first, ...rest] = it.display_name.split(', ');
    return {
      id: `nominatim:${it.place_id}`,
      label: it.name || first,
      sublabel: rest.slice(0, 3).join(', ') || null,
      latitude: Number(it.lat),
      longitude: Number(it.lon),
      kind: 'place',
      source: 'OpenStreetMap Nominatim',
    };
  });
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), results });
  return results;
}

/** Centre of the monitored sensor zones (from the data), or null when there are none. */
export async function zoneCentre(): Promise<{ lat: number; lng: number } | null> {
  const r = await prisma.parkingFacility.aggregate({ _avg: { latitude: true, longitude: true } });
  return r._avg.latitude != null && r._avg.longitude != null ? { lat: r._avg.latitude, lng: r._avg.longitude } : null;
}

/**
 * Orders geocoder results by distance to a point (stable for ties). Street names repeat across Greater Melbourne,
 * so the instance nearest the monitored zones is the most useful match.
 */
export function byDistanceTo<T extends { latitude: number; longitude: number }>(items: T[], p: { lat: number; lng: number } | null): T[] {
  if (!p) return items;
  return items
    .map((it, i) => ({ it, i, d: distanceMeters(p.lat, p.lng, it.latitude, it.longitude) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.it);
}

/** Haversine distance in metres (used for de-duplicating results and in tests). */
export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function mergeResults(zones: SearchResult[], places: SearchResult[], limit = 8): SearchResult[] {
  const out = [...zones];
  for (const p of places) {
    const dup = out.some((o) => o.label.toLowerCase() === p.label.toLowerCase() && distanceMeters(o.latitude, o.longitude, p.latitude, p.longitude) < 1500);
    if (!dup) out.push(p);
  }
  return out.slice(0, limit);
}

export function clearGeocodeCache() {
  cache.clear();
}

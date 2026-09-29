/**
 * Destination search.
 *  - suggest: our own Locality table (OSM place names), fast trigram match. Used while typing.
 *  - full:    localities + Nominatim geocoding bounded to Bengaluru. Used on explicit submit only,
 *             because Nominatim's usage policy forbids autocomplete. Throttled to 1 req/s and cached.
 */
import { config } from '../config.js';
import { prisma } from '../lib/db.js';

export const BENGALURU_VIEWBOX = { west: 77.43, south: 12.83, east: 77.8, north: 13.15 };

export interface SearchResult {
  id: string;
  label: string;
  sublabel: string | null;
  latitude: number;
  longitude: number;
  kind: 'locality' | 'place';
  source: string;
}

export async function searchLocalities(q: string, limit = 6): Promise<SearchResult[]> {
  const needle = q.trim().toLowerCase();
  const rows = await prisma.$queryRaw<{ id: string; name: string; placeType: string; latitude: number; longitude: number }[]>`
    SELECT id, name, "placeType", latitude, longitude
      FROM "Locality"
     WHERE lower(name) LIKE ${needle + '%'} OR lower(name) LIKE ${'% ' + needle + '%'} OR lower(name) % ${needle}
     ORDER BY (lower(name) = ${needle}) DESC,
              (lower(name) LIKE ${needle + '%'}) DESC,
              CASE "placeType" WHEN 'suburb' THEN 0 WHEN 'quarter' THEN 1 ELSE 2 END,
              similarity(lower(name), ${needle}) DESC,
              name
     LIMIT ${limit}`;
  return rows.map((r) => ({
    id: `locality:${r.id}`,
    label: r.name,
    sublabel: `${r.placeType[0].toUpperCase()}${r.placeType.slice(1)}, Bengaluru`,
    latitude: r.latitude,
    longitude: r.longitude,
    kind: 'locality',
    source: 'OpenStreetMap localities',
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
    countrycodes: 'in',
    viewbox: `${BENGALURU_VIEWBOX.west},${BENGALURU_VIEWBOX.north},${BENGALURU_VIEWBOX.east},${BENGALURU_VIEWBOX.south}`,
    bounded: '1',
    limit: '6',
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

/** Haversine distance in metres (used for de-duplicating results and in tests). */
export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function mergeResults(localities: SearchResult[], places: SearchResult[], limit = 8): SearchResult[] {
  const out = [...localities];
  for (const p of places) {
    const dup = out.some((o) => o.label.toLowerCase() === p.label.toLowerCase() && distanceMeters(o.latitude, o.longitude, p.latitude, p.longitude) < 1500);
    if (!dup) out.push(p);
  }
  return out.slice(0, limit);
}

export function clearGeocodeCache() {
  cache.clear();
}

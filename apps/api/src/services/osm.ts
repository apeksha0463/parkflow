/**
 * Maps OpenStreetMap elements (Overpass `out center tags`) to ParkFlow records.
 *
 * Rules: only values present in OSM tags are used. Missing tags become null/unknown.
 * The parking *type* is inferred from documented OSM tags (parking=*, park_ride, amenity)
 * and, where those are absent, from explicit keywords in the facility's own name/operator
 * (e.g. "... Mall", "... Hospital"). This inference is documented in DATASET.md.
 */
import type { ParkingType, VehicleType } from '../generated/prisma/client.js';

export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface MappedFacility {
  externalId: string;
  name: string | null;
  type: ParkingType;
  address: string | null;
  latitude: number;
  longitude: number;
  capacity: number | null;
  vehicleTypes: VehicleType[];
  evCharging: boolean | null;
  pricingText: string | null;
  isFree: boolean | null;
  operatingHours: string | null;
  sourceUrl: string;
}

export interface MappedLocality {
  externalId: string;
  name: string;
  placeType: string;
  latitude: number;
  longitude: number;
}

const EXCLUDED_ACCESS = new Set(['private', 'no', 'permit', 'delivery']);
const PLACE_TYPES = new Set(['suburb', 'neighbourhood', 'quarter']);

const coords = (el: OsmElement) =>
  el.lat != null && el.lon != null ? { lat: el.lat, lon: el.lon } : el.center ?? null;

export const externalIdOf = (el: OsmElement) => `osm:${el.type}/${el.id}`;
export const osmUrlOf = (el: OsmElement) => `https://www.openstreetmap.org/${el.type}/${el.id}`;

/** Parses a non-negative integer tag; returns null for "yes", ranges, or garbage. */
export function parseCount(value: string | undefined): number | null {
  if (value == null) return null;
  const v = value.trim();
  return /^\d{1,6}$/.test(v) ? Number(v) : null;
}

const KEYWORDS: [RegExp, ParkingType][] = [
  [/\b(metro|bmrcl|namma metro)\b/i, 'METRO'],
  [/\b(railway|rail station|junction|halt|ksr|yesvantpur jn|cantonment station)\b/i, 'RAILWAY'],
  [/\b(mall|forum|phoenix|orion|nexus|mantri square)\b/i, 'MALL'],
  [/\b(hospital|clinic|medical|healthcare|nimhans|manipal)\b/i, 'HOSPITAL'],
  [/\b(hotel|resort|inn|suites)\b/i, 'HOTEL'],
  [/\b(college|university|school|institute|iisc|iim|campus)\b/i, 'EDUCATIONAL'],
  [/\b(apartment|apartments|residency|enclave|layout association|society)\b/i, 'RESIDENTIAL'],
  [/\b(tech ?park|it park|office|business park|towers?|plaza|complex)\b/i, 'COMMERCIAL'],
];

export function inferParkingType(tags: Record<string, string>): ParkingType {
  if (tags.amenity === 'charging_station') return 'EV_CHARGING';
  if (tags.park_ride && tags.park_ride !== 'no') return 'METRO';

  const text = `${tags.name ?? ''} ${tags.operator ?? ''}`;
  for (const [re, type] of KEYWORDS) if (re.test(text)) return type;

  switch (tags.parking) {
    case 'multi-storey':
      return 'MULTI_LEVEL';
    case 'underground':
      return 'UNDERGROUND';
    case 'street_side':
    case 'lane':
    case 'on_kerb':
    case 'layby':
    case 'half_on_kerb':
      return 'ON_STREET';
  }
  if (tags.access === 'yes' || tags.access === 'public') return 'PUBLIC';
  if (tags.access === 'customers') return 'COMMERCIAL';
  if (tags.parking === 'surface' || tags.amenity === 'motorcycle_parking') return 'OFF_STREET';
  return 'UNKNOWN';
}

export function inferVehicleTypes(tags: Record<string, string>): VehicleType[] {
  const out = new Set<VehicleType>();
  if (tags.amenity === 'motorcycle_parking' || tags.motorcycle === 'yes' || parseCount(tags['capacity:motorcycle'])) out.add('TWO_WHEELER');
  if (tags.motorcar === 'yes' || tags.car === 'yes' || parseCount(tags['capacity:car'])) out.add('CAR');
  if (tags.bicycle === 'yes') out.add('BICYCLE');
  if (tags.hgv === 'yes') out.add('TRUCK');
  if (tags.bus === 'yes') out.add('BUS');
  // For generic amenity=parking without vehicle tags we leave the list empty (= unknown).
  return [...out];
}

function evCharging(tags: Record<string, string>): boolean | null {
  if (tags.amenity === 'charging_station') return true;
  const n = parseCount(tags['capacity:charging']);
  if (n != null) return n > 0;
  if (tags['capacity:charging'] === 'yes' || tags.charging === 'yes') return true;
  return null;
}

function pricing(tags: Record<string, string>): { pricingText: string | null; isFree: boolean | null } {
  const fee = tags.fee?.toLowerCase();
  const isFree = fee === 'no' ? true : fee === 'yes' ? false : null;
  const pricingText = tags.charge ?? (fee === 'no' ? 'Free' : fee === 'yes' ? 'Paid (rates not published in source)' : null);
  return { pricingText, isFree };
}

function address(tags: Record<string, string>): string | null {
  const parts = [
    [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    tags['addr:suburb'] ?? tags['addr:place'],
    tags['addr:postcode'],
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : tags['addr:full'] ?? null;
}

export function mapFacility(el: OsmElement): MappedFacility | null {
  const tags = el.tags ?? {};
  if (!['parking', 'motorcycle_parking', 'charging_station'].includes(tags.amenity)) return null;
  if (tags.access && EXCLUDED_ACCESS.has(tags.access)) return null;
  const c = coords(el);
  if (!c) return null;

  const capacity = parseCount(tags.capacity);
  return {
    externalId: externalIdOf(el),
    name: tags.name?.trim() || tags['name:en']?.trim() || null,
    type: inferParkingType(tags),
    address: address(tags),
    latitude: c.lat,
    longitude: c.lon,
    capacity: capacity === 0 ? null : capacity,
    vehicleTypes: inferVehicleTypes(tags),
    evCharging: evCharging(tags),
    ...pricing(tags),
    operatingHours: tags.opening_hours?.trim() || null,
    sourceUrl: osmUrlOf(el),
  };
}

export function mapLocality(el: OsmElement): MappedLocality | null {
  const tags = el.tags ?? {};
  const c = coords(el);
  const name = tags['name:en']?.trim() || tags.name?.trim();
  if (!c || !name || !PLACE_TYPES.has(tags.place)) return null;
  return { externalId: externalIdOf(el), name, placeType: tags.place, latitude: c.lat, longitude: c.lon };
}

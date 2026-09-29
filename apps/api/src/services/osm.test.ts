import { describe, expect, it } from 'vitest';
import { inferParkingType, mapFacility, mapLocality, parseCount } from './osm.js';

describe('OSM mapping', () => {
  it('parses only clean integer counts', () => {
    expect(parseCount('120')).toBe(120);
    expect(parseCount('yes')).toBeNull();
    expect(parseCount('50-60')).toBeNull();
    expect(parseCount(undefined)).toBeNull();
  });

  it('infers types from structural tags, park_ride and explicit name keywords', () => {
    expect(inferParkingType({ amenity: 'parking', parking: 'multi-storey' })).toBe('MULTI_LEVEL');
    expect(inferParkingType({ amenity: 'parking', parking: 'street_side' })).toBe('ON_STREET');
    expect(inferParkingType({ amenity: 'parking', park_ride: 'yes' })).toBe('METRO');
    expect(inferParkingType({ amenity: 'parking', name: 'Orion Mall Parking' })).toBe('MALL');
    expect(inferParkingType({ amenity: 'parking', name: 'St. John’s Hospital Parking' })).toBe('HOSPITAL');
    expect(inferParkingType({ amenity: 'parking', access: 'yes' })).toBe('PUBLIC');
    expect(inferParkingType({ amenity: 'parking' })).toBe('UNKNOWN');
    expect(inferParkingType({ amenity: 'charging_station' })).toBe('EV_CHARGING');
  });

  it('maps a way with center coordinates and keeps unknowns null', () => {
    const f = mapFacility({ type: 'way', id: 42, center: { lat: 12.93, lon: 77.62 }, tags: { amenity: 'parking', parking: 'surface' } });
    expect(f).toMatchObject({
      externalId: 'osm:way/42',
      name: null,
      type: 'OFF_STREET',
      capacity: null,
      pricingText: null,
      isFree: null,
      operatingHours: null,
      evCharging: null,
      vehicleTypes: [],
      sourceUrl: 'https://www.openstreetmap.org/way/42',
    });
  });

  it('reads capacity, fee, hours, EV and vehicle tags when present', () => {
    const f = mapFacility({
      type: 'node',
      id: 7,
      lat: 12.97,
      lon: 77.59,
      tags: { amenity: 'parking', name: 'Test', capacity: '80', fee: 'yes', opening_hours: '24/7', 'capacity:charging': '4', motorcar: 'yes' },
    });
    expect(f).toMatchObject({ capacity: 80, isFree: false, operatingHours: '24/7', evCharging: true, vehicleTypes: ['CAR'] });
    expect(f!.pricingText).toMatch(/rates not published/);
  });

  it('excludes private or coordinate-less elements', () => {
    expect(mapFacility({ type: 'node', id: 1, lat: 1, lon: 1, tags: { amenity: 'parking', access: 'private' } })).toBeNull();
    expect(mapFacility({ type: 'way', id: 2, tags: { amenity: 'parking' } })).toBeNull();
    expect(mapFacility({ type: 'node', id: 3, lat: 1, lon: 1, tags: { amenity: 'bench' } })).toBeNull();
  });

  it('maps localities and prefers English names', () => {
    expect(mapLocality({ type: 'node', id: 9, lat: 12.93, lon: 77.62, tags: { place: 'suburb', name: 'ಕೋರಮಂಗಲ', 'name:en': 'Koramangala' } })).toMatchObject({
      name: 'Koramangala',
      placeType: 'suburb',
    });
    expect(mapLocality({ type: 'node', id: 10, lat: 1, lon: 1, tags: { place: 'city', name: 'X' } })).toBeNull();
  });
});

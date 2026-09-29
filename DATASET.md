# Datasets

ParkFlow uses **separate data layers** that are never mixed:

| Layer | Source | Used for |
|---|---|---|
| City parking directory | OpenStreetMap (this document, part 1) | Discovery: where parking exists in Bengaluru |
| Live availability | None connected. Pluggable provider interface. | — |
| Historical research data | Public parking-occupancy dataset (part 2, milestone 5) | Training and evaluating the spillover models |
| Demo / simulation | Replay of research data onto labelled demo facilities | Demonstrating the UI; never used in evaluation |

---

## Part 1: Bengaluru parking directory (OpenStreetMap)

**Source:** OpenStreetMap, queried through the Overpass API (`apps/api/scripts/import-osm.ts`).
**Licence:** Open Database License (ODbL) 1.0, © OpenStreetMap contributors. Attribution is shown in the app and API.
**Snapshot used in development:** OSM base timestamp `2026-06-01T08:52:28Z`. Raw response cached at `data/raw/osm/bengaluru.json`, which is git-ignored and about 580 kB.
**Extent:** bounding box `12.83,77.43 – 13.15,77.80` (south, west, north, east), covering the Bengaluru urban area.

### Query
`amenity=parking`, `amenity=motorcycle_parking`, `amenity=charging_station` (nodes, ways and relations, as centre points), and `place=suburb|neighbourhood|quarter` nodes for locality names.

### What the snapshot contains (measured on import)
| Item | Count |
|---|---|
| Elements returned | 2,718 |
| `amenity=parking` | 1,423 |
| `amenity=motorcycle_parking` | 126 |
| `amenity=charging_station` | 46 |
| Locality nodes (suburb / neighbourhood / quarter) | 97 / 827 / 199 |
| Facilities imported, after excluding `access=private/no/permit/delivery` and elements without coordinates | 1,173 |
| Excluded | 422 |
| Facilities labelled with a locality within 3 km | 1,156 |

Tag coverage among `amenity=parking` elements: `name` 111, `capacity` 60, `fee` 190, `opening_hours` 3, `operator` 84, `parking=*` 1,140.

### Mapping rules
- **Unknown stays unknown.** Missing capacity, pricing, hours, EV or vehicle-type tags are stored as `NULL` or an empty list.
- **Name:** `name`, else `name:en`, else `NULL`. For unnamed facilities the API returns a *derived* label such as "Off-street parking near Koramangala 6th Block", with `nameIsDerived: true`.
- **Type** (`src/services/osm.ts`, unit-tested):
  1. `amenity=charging_station` → EV charging. `park_ride=*` → Metro.
  2. Explicit keywords in the facility's own `name` or `operator` (e.g. "Mall", "Hospital", "Metro", "College").
  3. `parking=multi-storey` → Multi-level; `underground` → Underground; `street_side/lane/on_kerb/layby` → On-street.
  4. `access=yes/public` → Public; `access=customers` → Commercial; `parking=surface` or motorcycle parking → Off-street.
  5. Otherwise Unclassified.
- **Capacity:** only clean integers are kept; `"yes"`, ranges and `0` become `NULL`.
- **Pricing:** `fee=no` → free; `fee=yes` → paid, "rates not published in source" unless a `charge` tag exists.
- **Locality:** the nearest OSM place node within 3 km, found with a PostGIS KNN query.
- Each directory facility gets one `WHOLE_FACILITY` zone, so occupancy can be attached later if a real source appears.

### Limitations
- OSM coverage in Bengaluru is incomplete and uneven. Many real facilities are missing, and most entries lack names and capacities.
- Type inference from names is heuristic and can misclassify facilities.
- **The directory contains no availability data.** Every OSM facility is shown as "Availability currently unavailable".
- The snapshot is a point in time. Re-run `npm run import:osm -w apps/api -- --fetch` to refresh it. The import upserts facilities but does not delete ones removed from OSM.

### Reproduce
```bash
npm run import:osm -w apps/api -- --fetch   # download and import
npm run import:osm -w apps/api              # re-import from the cached file
```

---

## Part 2: Historical research dataset

*To be completed in milestone 5, after inspecting candidate datasets (City of Melbourne on-street sensors, SFpark, Seattle SDOT). The inspection checks structure, resolution, licence and suitability.*

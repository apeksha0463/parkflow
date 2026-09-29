# Datasets

ParkFlow uses **separate data layers** that are never mixed:

| Layer | Source | Used for |
|---|---|---|
| City parking directory | OpenStreetMap (this document, part 1) | Discovery: where parking exists in Bengaluru |
| Live availability | None connected. Pluggable provider interface. | — |
| Historical research data | City of Melbourne on-street parking sensors, 2019 (part 2) | Training and evaluating the spillover models |
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

**City of Melbourne — On-street Car Parking Sensor Data, 2019.** This is **not Bengaluru data**. It is used only to
evaluate the forecasting method. No public dataset provides per-zone occupancy time series for Bengaluru.

| | |
|---|---|
| Source | City of Melbourne Open Data, dataset `on-street-car-parking-sensor-data-2019` |
| Download | `https://opendatasoft-s3.s3.amazonaws.com/downloads/archive/7pgd-bdf2.zip` (717,085,379 bytes; one CSV of 7,450,489,331 bytes) |
| Locations | `on-street-parking-bays` dataset (bay coordinates + road-segment description), CSV export |
| Licence | CC BY (as stated in the portal metadata for both datasets). Attribution: City of Melbourne. |
| Size | 42,672,743 rows, 6,623 in-ground sensors (bays), 2019-01-01 to 2019-12-31 |
| Structure | One row per sensor state interval: `DeviceId`, `ArrivalTime`, `DepartureTime`, `VehiclePresent` (true = occupied, false = vacant interval), street block (`StreetId`, `BetweenStreet1/2(ID)`), `AreaName`, bay/marker IDs, restriction sign |
| Temporal resolution | Event level, timestamps to the second, local time without offset |

### Candidates inspected and why they were not used

Each candidate was checked from its source files and portal metadata, not assumed.

- **SFpark (San Francisco, 2011–2013).** The public sensor file (`SFpark_ParkingSensorData_HourlyOccupancy_20112013.csv`, 1.49 GB) is hourly.
  Occupancy is given as *occupied time / total time* per block-hour. It has no capacity column and no coordinates (block IDs only).
  Hourly resolution cannot support 5–30 minute horizons.
- **Seattle Paid Parking Occupancy (2019+).** Minute-level rows with space counts and coordinates, public domain.
  However, occupancy there is derived from **payment transactions**, not sensors, so unpaid, permit and overstaying vehicles are invisible.
- **Melbourne 2019 sensors** (chosen). Physical detection per bay at second resolution supports any grid down to minutes.
  Capacity can be measured as the number of *reporting* bays, and the licence permits research use.

### How the data was checked (sample of 177,101 rows, then the full file)

- Events per sensor mostly cover time continuously: the median gap between one interval's end and the next start is 0 s.
  The 99th-percentile gap is about 5.4 h (sensor offline), and a few intervals overlap.
  So **time without an interval is treated as unknown, not vacant**, and overlaps are clipped.
- The 2019 file has no coordinates, and its bay IDs do not match the current bay dataset's `kerbsideid`.
  Both datasets name blocks as "Street between X and Y", so zones are located by matching normalised street names (below).

### Preprocessing (measured on the full file)

| Step | Rows / result |
|---|---|
| Raw rows | 42,672,743 |
| Removed: missing required fields | 32,251 |
| Removed: departure ≤ arrival | 21,202 |
| Removed: unparseable time / outside 2019 / invalid flag | 0 / 0 / 0 |
| Removed: exact duplicates | 191 |
| **Kept** | **42,619,099 (99.87%)** |
| Overlapping intervals clipped to the next start | 22,164 |
| Zones (street blocks, both kerb sides) | 335 |
| Zones located by block-name match | 253 (5,341 of 6,623 sensors) |
| 5-min zone-instants with ≥ 4 reporting bays (valid) | 25,785,352 of 35,215,200 (73.2%) |
| Mean occupancy over valid instants | 0.4878 (min 0.0, max 1.0) |

**Occupancy** at grid instant *t* is `occupied(t) / observed(t)`:
- `observed(t)` is the number of the zone's bays whose sensor has an interval covering *t*.
- `occupied(t)` is the number of those bays whose interval has `VehiclePresent = true`.

The source has no capacity field. Capacity is therefore the count of *reporting* bays, so a sensor outage lowers capacity rather than being counted as a vacant space.
Occupancy is left unknown (NaN, never filled) when fewer than 4 bays report.
By construction `occupied ≤ observed`, and the pipeline asserts this.

Timestamps are local wall-clock time. The two DST transitions (7 Apr and 6 Oct 2019) are kept as recorded.
The repeated/missing hour affects at most one hour per transition.

### Experiment subset

- Zones: located zones with any valid occupancy (218).
- Hours: 07:00–21:55 local.
- Split, chronological by date:
  - train Jan–Aug
  - validation Sep–Oct
  - test Nov–Dec
- Sample counts are written to `ml/evaluation/results.json` by the training run.

### Limitations

- Melbourne CBD kerbside parking in 2019 is not Bengaluru. It differs in road layout, enforcement, pricing, parking types (no malls or multi-level car parks) and driver behaviour.
  The dataset evaluates the *method*, not Bengaluru outcomes.
- Zone locations come from the **current** bay layout. Blocks whose bays were renumbered or removed since 2019 could not be matched (82 zones, 1,282 sensors).
- Zone location is the mean bay coordinate of the block (both kerb sides), not a precise point.
- The sensors cover sensor-equipped bays only, not every space on a block.

### Reproduce

```bash
cd ml
.venv/Scripts/python -m parkflow_ml.download   # resumable; ~720 MB into data/raw/melbourne (git-ignored)
.venv/Scripts/python -m parkflow_ml.ingest     # -> data/processed/intervals.parquet, zones_raw.csv, ingest_report.json
.venv/Scripts/python -m parkflow_ml.occupancy  # -> occupancy_grid.npz, occupancy_report.json
.venv/Scripts/python -m parkflow_ml.geo        # -> zones.csv, neighbours.csv, geo_report.json
.venv/Scripts/python -m parkflow_ml.train      # -> ml/evaluation/*, ml/artifacts/*
.venv/Scripts/python -m parkflow_ml.replay     # -> data/processed/replay_cluster.json (simulation demo)
```

Peak memory is about 3 GB (ingest). The report files hold every number quoted above.

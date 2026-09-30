# Datasets

ParkFlow is built on one dataset: the **City of Melbourne on-street parking sensors, 2019**.

| Use | What | Where |
|---|---|---|
| Research | Training (Jan–Aug), validation (Sep–Oct) and test (Nov–Dec) of the spillover models | `ml/`, RESEARCH.md |
| Product | **Historical replay** of the test split only (never used for training), at the blocks' real coordinates | `replay_melbourne.json` → `db:seed:melbourne` |
| Live availability | None connected. The product never presents the replay as live data. | — |

---

## Historical research dataset

**City of Melbourne — On-street Car Parking Sensor Data, 2019.** Per-bay arrival/departure records, aggregated here to
street-block occupancy on a 5-minute grid.

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

- Melbourne CBD kerbside parking in 2019 only. Other cities, off-street car parks and later years may behave differently.
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
.venv/Scripts/python -m parkflow_ml.replay     # -> data/processed/replay_melbourne.json (product replay, test split)
cd .. && npm run db:seed:melbourne -w apps/api  # loads zones, recorded occupancy, neighbours, events
```

Peak memory is about 3 GB (ingest). The report files hold every number quoted above.

### Product replay export (`replay_melbourne.json`)

- Every modelled block with occupancy data in the test split (8 of the 218 modelled blocks have none and are not exported).
- Per block: key, street description (as given by the source, title-cased; the block key when there is none), area,
  sensor count, coordinates, research neighbours (200 m) and occupancy + reporting bays per 5-minute instant from
  7 days before the test split (model-input history only) to its end. Unknown values are `null`.
- Saturation events detected with the research definition (`saturation.detect_events`) whose onset is in the test split.
- Timestamps are real 2019 instants (Melbourne time converted to UTC; the range has no daylight-saving change).

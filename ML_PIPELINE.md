# ML pipeline

This is a reproducible pipeline from raw sensor events to served predictions. The code is in `ml/parkflow_ml/`, the service in `ml/service/`, and the tests in `ml/tests/`.
Every number quoted in the docs is produced by these scripts and written to a report file. Nothing is typed in by hand.

```
download -> ingest -> occupancy -> geo -> train -> replay
                                          |-> ml/evaluation/results.{json,csv}, actual_vs_predicted_sample.csv
                                          |-> ml/artifacts/{temporal,spatial_temporal}/hgb_h{5,10,15,30}.joblib + metadata.json
                                          '-> ml/artifacts/registry.json
```

## 1. Dataset
This is the City of Melbourne on-street parking sensors dataset for 2019: 42.7 M sensor state intervals from 6,623 bays.
See [DATASET.md](DATASET.md) part 2 for its source, licence, the candidates that were rejected, and the preprocessing counts.
The product replays the test split of the same data (never the training period).

## 2. Preprocessing (`ingest.py`)
- The 7.45 GB CSV is streamed in 2 M-row chunks. Only the needed columns are kept, times are stored as int32 seconds, and zones as int codes.
- Rows are removed only for these reasons, and every removal is counted in `ingest_report.json`:
  - missing required fields
  - unparseable time
  - departure ≤ arrival
  - outside 2019
  - an invalid `VehiclePresent` flag
  - exact duplicates
- **Zone = street block**: `StreetId` plus the unordered pair of cross-street IDs, with both kerb sides together.

## 3. Occupancy (`occupancy.py`)
The data is put on a 5-minute grid (the source has second-resolution events, so 5 minutes is supported). At each grid instant *t*:
`occupancy(t) = occupied(t) / observed(t)`.
- `observed(t)` counts bays whose sensor interval covers *t*.
- `occupied(t)` counts those with `VehiclePresent = true`.

Sensor gaps are **unknown**, not vacant. Overlapping intervals from one sensor are clipped to the next start.
Occupancy is NaN when fewer than `MIN_OBSERVED_BAYS = 4` bays report.
Missing values are never interpolated or filled. Features that depend on a missing value are NaN; the gradient-boosting model handles NaN natively, and the linear baseline uses median imputation plus missing-indicator columns.

## 4. Neighbour identification (`geo.py`)
- **Zone location.** Zone names ("BOURKE ST between RUSSELL ST and EXHIBITION ST") are matched to the City's bay dataset road-segment descriptions.
  Matching uses normalised street names with the cross streets as an unordered pair. The zone's location is the mean coordinate of the matched bays.
  Unmatched zones are excluded (reported in `geo_report.json`), never placed by guesswork.
- **Neighbours.** All located zones within `NEIGHBOUR_RADIUS_M = 200` m great-circle (haversine) distance.
  - Why 200 m: a CBD block is about 200 m long (Hoddle Grid), so this captures adjacent blocks, with a median of 4 neighbours.
  - 400 m gave a median of 16, mixing in zones two or more blocks away.
  - The radius was fixed from these counts before any model was evaluated.
- Relationships are cached in `data/processed/neighbours.csv` as (zone, neighbour, distance_m).
- Zones without neighbours keep `nb_count = 0`; their other spatial features are NaN. They stay in both models' data, so the comparison is on identical samples.

## 5. Saturation (`saturation.py`)
- **States**, with threshold T = 0.90 (configurable) and margin 0.10:
  - `SATURATED`: o ≥ T
  - `APPROACHING_SATURATION`: T − 0.10 ≤ o < T
  - `NORMAL`: otherwise
- **Event onset**: the zone is saturated at *k* and was known and below T for the previous **30 minutes** (`EVENT_MIN_BELOW_MINUTES`).
  Without that debounce, occupancy on ~12-bay blocks flickering around 90% produced 4.4 "events" per zone per day. With 30 minutes, the rate is 1.8.
- **Event end**: the first known instant below T.
- Events describe observations. Nothing in the pipeline assumes that saturation *causes* pressure elsewhere.

## 6. Feature engineering (`features.py`)
The same function serves training and inference. For a sample at instant *k*, every feature uses grid values at instants ≤ *k* only.

**Temporal (target zone only)**:

| Feature | Definition |
|---|---|
| `occ_t` | occupancy at k |
| `occ_lag1/2/3/6/12` | occupancy 5/10/15/30/60 min earlier |
| `occ_lag1w` | occupancy one week earlier (same weekday and time) |
| `diff1/3/6` | `occ_t` minus the lag 1/3/6 value |
| `roll_mean_6/12` | mean of known values over the last 30/60 min, including k |
| `observed_bays` | number of reporting bays at k (measured capacity) |
| `tod_sin/tod_cos` | time of day, encoded cyclically |
| `dow`, `is_weekend` | day of week |

**Spatial (neighbours within 200 m, at instant k)**:

| Feature | Definition |
|---|---|
| `nb_count` / `nb_valid` | number of neighbours / number with known occupancy |
| `nb_mean_occ`, `nb_max_occ`, `nb_min_occ` | occupancy aggregates |
| `nb_wmean_occ` | inverse-distance-weighted mean, with distance floored at 50 m |
| `nb_mean_diff1`, `nb_mean_diff3` | mean neighbour change over 5 / 15 min |
| `nb_n_saturated`, `nb_n_approaching` | neighbours in each state |
| `nb_n_recent_onset` | neighbours whose saturation event began in the last 15 min |
| `nb_mean_dist_m` | mean neighbour distance |

## 7. Prediction target
The target is **occupancy of the target zone at k + h** (a fraction from 0 to 1).
Models are fitted on the change `occupancy(k+h) − occupancy(k)`, then converted back and clipped to [0, 1].
Errors are always reported on occupancy, where MAE is identical for both parameterisations.

## 8. Forecast horizons
The horizons are 5, 10, 15 and 30 minutes, which all fit the 5-minute grid. The API returns only horizons that have a trained model.

## 9. Train / validation / test split
The split is chronological by calendar date, with no shuffling:
- **Train:** 2019-01-01 to 2019-08-31 (a sample every 15 min; neighbouring 5-min samples are near-duplicates)
- **Validation:** 2019-09-01 to 2019-10-31 (every 5-min instant)
- **Test:** 2019-11-01 to 2019-12-31 (every 5-min instant)

Samples are restricted to 07:00–21:55. The overnight gap (≥ 9 h) is far longer than the maximum horizon (30 min), so no target of one period falls in the next.
The validation set is used only to choose hyper-parameters and the served model. The test set is evaluated **once**, after refitting on train + validation.

## 10. Model A — temporal-only
This is `HistGradientBoostingRegressor` (scikit-learn) on the temporal features:
- learning rate 0.1, 300 iterations, no early stopping
- `max_leaf_nodes` ∈ {31, 63} chosen on validation MAE at h = 15

There are two reference points:
- **persistence**: ŷ = current occupancy
- **ridge**: median impute + missing indicators + standardise + Ridge(α = 1)

## 11. Model B — spatial-temporal
This is identical to Model A (same algorithm, grid, samples, split and seed) with the spatial features added.
The only difference between A and B is the neighbour information, which is exactly what the research question asks about.

## 12. Metrics (`train.py`)
- **MAE, RMSE and R²** on test occupancy, per model × horizon × subset:
  - `all`: all samples
  - `post_neighbour_saturation`: a neighbour's event began within the last 15 min. This is the research subset.
  - `target_approaching_or_saturated`: the target zone's occupancy is at least 0.80
  - `has_neighbours`
- **A vs B**: MAE reduction (%), and a **paired day-block bootstrap** (1,000 resamples of whole test days) giving the 95% interval of MAE(A) − MAE(B).
  Whole days are resampled because 5-minute errors within a day are autocorrelated.
- Outputs are written to `ml/evaluation/`:
  - `results.json`: config, splits, selection, metrics, comparisons, saturation-event statistics
  - `results.csv`
  - `actual_vs_predicted_sample.csv`: 5,000 random test samples at h = 15

## 13. Leakage prevention
| Risk | Control |
|---|---|
| Future feature leakage | Features read only columns ≤ k. `test_features_do_not_depend_on_future_values` overwrites all values after k and asserts identical features. |
| Target leakage | The target is read only via `targets()` at k + h and never enters `build_features`. |
| Temporal split leakage | The split is by date, with an overnight gap longer than any horizon. There is no shuffling. |
| Overlapping windows | Lags and rolling windows look backwards only. Within-period overlap is expected, and bootstrap CIs resample whole days. |
| Selection on test | Hyper-parameters and the served model are chosen on validation only. |
| Demo data | Simulation replay uses **test-period** data only and never feeds training or evaluation. |

## 14. Serving
- `ml/service` (FastAPI) loads `registry.json` and the model files and never trains.
- `POST /predict` takes the target zone's 5-minute occupancy history (up to one week plus now), its reporting bays, and the neighbours' histories with distances.
- It rebuilds features with `build_features` and returns predicted occupancy per horizon. No confidence value is returned, because none is computed.
- It refuses rather than guesses:
  - `422 INSUFFICIENT_HISTORY` when less than an hour of history is available or the current value is unknown
  - `503` when no model is available
- The Node API (`apps/api/src/services/predictions.ts`):
  - builds the histories from stored snapshots
  - chooses neighbours within the **model's** training radius (read from its metadata)
  - stores every served prediction
  - fills in the actual value and absolute error once the target time is observed, for online predicted-vs-actual monitoring

## 15. Limitations
- The data is from one city and one year (Melbourne CBD, 2019). Performance on other road networks, parking types or cities is unknown.
- Neighbours are based on straight-line distance, not the road network. One-way streets and turn restrictions are ignored.
- Occupancy is measured over sensor-equipped bays only, and blocks with fewer than 4 reporting bays are excluded.
- Predicted "pressure" is a statistical association between neighbouring occupancy and future occupancy. It is **not** evidence that drivers move from one zone to another; the data has no vehicle-level trajectories.
- External events (concerts, weather, roadworks) are not in the features.
- The 30-minute debounce and the 200 m radius are design choices. They were set from data characteristics before evaluation, and results may differ under other choices.

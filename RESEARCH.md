# Research: event-based spatial-temporal parking spillover forecasting

> An implementation and evaluation of an event-based spatial-temporal parking spillover forecasting workflow.
> This document makes no claim that the problem is new. It describes what was built, how it was evaluated, and what the measurements show.

## 1. Problem statement
Drivers usually find out that parking is full only when they arrive. When one parking zone saturates, nearby zones may come under more pressure.
A system that only reports current availability cannot anticipate this. We ask whether short-term occupancy forecasts can be improved by using information from neighbouring zones, particularly after a nearby zone saturates.

## 2. Existing parking-management approaches
In general terms (no specific systems are cited here):
- **Static directories** list where parking exists, with no occupancy.
- **Real-time availability systems** report current free spaces from sensors, gates or payment data.
- **Demand-responsive pricing programmes** adjust prices from observed occupancy. SFpark, whose public data we inspected (DATASET.md), is one such programme.
- **Short-term occupancy forecasting** predicts occupancy from each zone's own history. Some approaches add spatial context from nearby zones.

A literature review with verifiable citations has **not** been completed for this project. Section 13 lists it as outstanding work.

## 3. Research motivation
A forecasting workflow that is **triggered by saturation events** and **evaluated specifically on the periods that follow them** tests whether neighbour information helps exactly when it would matter to a driver looking for an alternative.

## 4. Research question
> Does incorporating neighbouring parking-zone information improve short-term prediction of parking occupancy following a saturation event in a neighbouring zone?

We study **occupancy changes following saturation events** (parking-pressure propagation).
We do **not** observe individual drivers moving between zones. The dataset has no vehicle trajectories, so any effect found is a statistical association between zones' occupancy, not evidence of driver displacement.

## 5. Proposed approach
1. Convert sensor events into a 5-minute occupancy series per street block.
2. Locate blocks and define neighbours geographically (within 200 m).
3. Detect saturation events: occupancy ≥ 90% after at least 30 minutes below.
4. Train two models that differ **only** in whether they see neighbour features:
   - **Model A**, temporal-only
   - **Model B**, spatial-temporal
5. Compare them on a chronologically held-out test period, both overall and on the samples that follow a neighbour's saturation event.

## 6. Dataset
City of Melbourne on-street parking bay sensors, 2019 (CC BY): 42.7 M sensor state intervals from 6,623 bays.
- Chosen after inspecting SFpark (hourly, no capacity or coordinates) and Seattle (occupancy inferred from payments).
- The product (ParkFlow — Melbourne Parking Intelligence) replays only the test split of this data, as clearly labelled history.
- Details, measured preprocessing counts and limitations are in [DATASET.md](DATASET.md) part 2.

## 7. Data preprocessing
Summary of [ML_PIPELINE.md](ML_PIPELINE.md) §2–3:
- 99.87% of rows were kept, and every removal is counted.
- Occupancy is occupied ÷ *reporting* bays per 5-minute instant.
- Sensor gaps are treated as unknown, never as vacant.
- Occupancy is unknown when fewer than 4 bays report.
- Of 335 blocks, 253 could be located from the City's bay dataset.
- The experiment uses the 218 located blocks that have data.

## 8. Feature engineering
See ML_PIPELINE.md §6.
- **Temporal:** current occupancy; lags of 5 min to 1 week; changes; rolling means; reporting bays; time of day; day of week.
- **Spatial:** neighbour count, mean, inverse-distance-weighted mean, max and min occupancy; neighbour change; counts of neighbours that are saturated or approaching; neighbours whose saturation event began in the last 15 minutes; mean distance.
- All features use data up to the forecast time only, and a test enforces this.

## 9. Models
- Models A and B both use `HistGradientBoostingRegressor` with identical settings. The number of leaves is chosen on validation.
- Both predict the change in occupancy over the horizon.
- Reference points for both feature sets: **persistence** (no change) and a **ridge regression**.

## 10. Evaluation methodology
- **Split, chronological:** train Jan–Aug 2019, validation Sep–Oct, test Nov–Dec. Samples are 07:00–21:55.
- **Horizons:** 5, 10, 15 and 30 minutes.
- **Metrics:** MAE and RMSE on occupancy (fraction 0–1; ×100 gives percentage points), plus R².
- **Subsets:**
  - all test samples
  - **post-neighbour-saturation**, the research subset: a neighbour's event began within the last 15 minutes
  - target zone approaching or saturated
  - zones with neighbours
- **A vs B:** MAE reduction, plus a paired day-block bootstrap (1,000 resamples) for the 95% interval of MAE(A) − MAE(B).
- **Test-set use:** the test set is evaluated once. Model choice uses validation only.

## 11. Results

*Generated by `python -m parkflow_ml.report` from `ml/evaluation/results.json` (run 2026-09-29T16:06:59+00:00). Errors are in **percentage points of occupancy** (MAE × 100). The test period is 2019-11-01 to 2019-12-31, and the test set was evaluated once.*

- Zones in the experiment: 218; 207 of them have at least one neighbour within 200 m.
- Test samples: 2,210,667, of which 250,385 (11.3%) follow a neighbour's saturation event.
- Saturation events in 2019 (all hours, experiment zones): 160,824 in 216 zones; median duration 10 min.
- Hyper-parameters chosen on validation: temporal {'max_leaf_nodes': 63}, spatial-temporal {'max_leaf_nodes': 63}.

### All test samples

| Model | MAE 5 min | MAE 10 min | MAE 15 min | MAE 30 min | RMSE 5 | RMSE 10 | RMSE 15 | RMSE 30 | R² 15 min |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Persistence (no change) | 4.83 | 6.70 | 7.96 | 10.48 | 9.12 | 11.44 | 12.96 | 16.00 | 0.789 |
| Ridge — temporal | 5.55 | 7.38 | 8.56 | 10.91 | 8.73 | 10.80 | 12.14 | 14.80 | 0.814 |
| Ridge — spatial-temporal | 5.54 | 7.35 | 8.52 | 10.83 | 8.71 | 10.76 | 12.09 | 14.70 | 0.816 |
| **A** HGB — temporal-only | 5.48 | 7.20 | 8.26 | 10.28 | 8.60 | 10.55 | 11.77 | 14.07 | 0.826 |
| **B** HGB — spatial-temporal | 5.43 | 7.11 | 8.13 | 10.01 | 8.53 | 10.41 | 11.55 | 13.65 | 0.832 |

*n = 2,209,742 samples per horizon (varies slightly with target availability).*

### After a neighbour's saturation event (research subset)

| Model | MAE 5 min | MAE 10 min | MAE 15 min | MAE 30 min | RMSE 5 | RMSE 10 | RMSE 15 | RMSE 30 | R² 15 min |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Persistence (no change) | 5.57 | 7.52 | 8.75 | 11.24 | 9.80 | 12.17 | 13.66 | 16.73 | 0.702 |
| Ridge — temporal | 6.16 | 7.97 | 9.10 | 11.33 | 9.32 | 11.39 | 12.70 | 15.31 | 0.743 |
| Ridge — spatial-temporal | 6.12 | 7.89 | 8.98 | 11.12 | 9.29 | 11.32 | 12.59 | 15.12 | 0.747 |
| **A** HGB — temporal-only | 6.12 | 7.79 | 8.76 | 10.56 | 9.16 | 11.06 | 12.20 | 14.31 | 0.763 |
| **B** HGB — spatial-temporal | 6.10 | 7.70 | 8.62 | 10.26 | 9.08 | 10.90 | 11.95 | 13.84 | 0.772 |

*n = 250,280 samples per horizon (varies slightly with target availability).*

### Target zone approaching or saturated (occupancy ≥ 0.80)

| Model | MAE 5 min | MAE 10 min | MAE 15 min | MAE 30 min | RMSE 5 | RMSE 10 | RMSE 15 | RMSE 30 | R² 15 min |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Persistence (no change) | 4.13 | 5.72 | 6.76 | 8.87 | 8.34 | 10.51 | 11.93 | 14.72 | 0.062 |
| Ridge — temporal | 4.89 | 6.44 | 7.42 | 9.34 | 7.75 | 9.53 | 10.68 | 12.89 | 0.248 |
| Ridge — spatial-temporal | 4.88 | 6.41 | 7.37 | 9.24 | 7.74 | 9.50 | 10.64 | 12.81 | 0.254 |
| **A** HGB — temporal-only | 5.05 | 6.49 | 7.36 | 8.99 | 7.62 | 9.28 | 10.33 | 12.30 | 0.296 |
| **B** HGB — spatial-temporal | 5.01 | 6.42 | 7.26 | 8.81 | 7.56 | 9.17 | 10.17 | 12.03 | 0.318 |

*n = 605,393 samples per horizon (varies slightly with target availability).*

### A vs B: does neighbour information help?

| Subset | Horizon | MAE A | MAE B | Reduction | 95% CI of MAE(A) − MAE(B), pp |
|---|---:|---:|---:|---:|---:|
| All test samples | 5 min | 5.48 | 5.43 | 0.88% | [0.042, 0.054] |
| All test samples | 10 min | 7.20 | 7.11 | 1.20% | [0.078, 0.095] |
| All test samples | 15 min | 8.26 | 8.13 | 1.59% | [0.119, 0.143] |
| All test samples | 30 min | 10.28 | 10.01 | 2.57% | [0.239, 0.287] |
| After a neighbour's saturation event | 5 min | 6.12 | 6.10 | 0.25% | [0.009, 0.022] |
| After a neighbour's saturation event | 10 min | 7.79 | 7.70 | 1.08% | [0.073, 0.095] |
| After a neighbour's saturation event | 15 min | 8.76 | 8.62 | 1.64% | [0.127, 0.158] |
| After a neighbour's saturation event | 30 min | 10.56 | 10.26 | 2.86% | [0.271, 0.330] |
| Target zone approaching or saturated | 5 min | 5.05 | 5.01 | 0.91% | [0.038, 0.053] |
| Target zone approaching or saturated | 10 min | 6.49 | 6.42 | 1.20% | [0.067, 0.089] |
| Target zone approaching or saturated | 15 min | 7.36 | 7.26 | 1.34% | [0.082, 0.115] |
| Target zone approaching or saturated | 30 min | 8.99 | 8.81 | 1.91% | [0.147, 0.196] |

### Interpretation

Figures: `ml/evaluation/mae_by_horizon.png`, `ml/evaluation/actual_vs_predicted_15min.png`.

1. **Answer to the research question.** On this dataset, adding neighbouring-zone features gave a small but consistent improvement.
   - Model B has lower MAE than Model A at every horizon and in every subset, for both the gradient-boosting and ridge models.
   - The paired day-block bootstrap 95% intervals exclude zero in all cases.
   - The effect is **small**: about 0.9–2.6% lower MAE overall (0.05–0.26 percentage points), growing with the horizon.
   - In the research subset (after a neighbour's saturation event) the reduction is 0.25% at 5 minutes and 2.86% at 30 minutes. That is larger than overall at 15 and 30 minutes, and smaller at 5 minutes.
   - This supports "neighbour information helps short-term forecasting here, more so at longer horizons". It does **not** show a large or causal spillover effect.
2. **Persistence baseline.** "No change" has a *lower MAE* than both learned models at 5 and 10 minutes in every subset. At 15 minutes it is also lower for all samples and for near-saturated targets, though not after a neighbour's saturation event. The learned models have lower RMSE and higher R² at every horizon.
   - A plausible explanation, not tested here: the models were trained on squared error, which targets the conditional mean. Occupancy on a block often does not change over 5–10 minutes, so the median change is 0, and MAE rewards predicting "no change".
   - Practically, Model B beats persistence on MAE only at 30 minutes (every subset), and at 15 minutes after a neighbour's saturation event.
3. **Near saturation** (target occupancy ≥ 0.80), persistence explains little variance (R² 0.06 at 15 minutes). Both models do better (R² 0.30 and 0.32), but absolute errors of 7–9 percentage points remain large relative to the gap between "approaching" and "saturated".
4. **What the product may state.** "Spatial-temporal model reduced MAE by X%" can be shown only with the measured values above: horizon-specific, dataset-specific, and with the persistence comparison available.

### Follow-up (not part of the pre-registered comparison)
Training with an absolute-error loss (to target the median), or reporting persistence alongside every prediction, would address point 2.
Any such change must be selected on the validation period and reported as a post-hoc experiment, because the test period has now been seen.

## 12. Limitations
- **One city and one year:** Melbourne CBD kerbside parking in 2019. This says nothing directly about other cities, off-street car parks or other parking types.
- **Replay, not live:** the product demonstrates the method on recorded test-period data; it does not show current availability.
- **Association, not causation:** parking-pressure propagation is not the same as observing drivers move between zones.
- **Data quality:** predictions depend on it. Sensor outages reduce the measured capacity; blocks that could not be located (82 of 335) are excluded.
- **Predictions are not guarantees.** External events (concerts, weather, roadworks, holidays) are not modelled.
- **Variation across locations:** performance may differ by block, time of day and season. The test period (Nov–Dec) includes the pre-Christmas season.
- **Neighbour definition:** straight-line distance, not the road network.
- **Design choices:** the 200 m radius and 30-minute event debounce were set from data characteristics before evaluation. Other choices may give different results.

## 13. Future work
- Complete a literature review with verifiable citations.
- Try road-network neighbours, different radii and different event definitions as a sensitivity analysis.
- Evaluate on other cities' sensor datasets and on off-street car parks.
- Quantify uncertainty (e.g. quantile models) before showing any confidence to users.
- Connect a live occupancy feed (e.g. the current City of Melbourne sensor API) and monitor predicted vs actual online.

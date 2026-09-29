"""Feature engineering shared by training and serving.

All features for a sample at grid instant k use grid values at instants <= k only. Targets are the
occupancy at k + h. The same function is used on the full research grid (training) and on a short
history window (serving), so the two cannot drift apart.

Grid conventions: `occ` and `observed` are (rows, T) arrays on a BUCKET_MINUTES grid; NaN occupancy
means unknown. `neighbours` maps a row to (neighbour_rows, distances_m).
"""
from __future__ import annotations

import warnings

import numpy as np
import pandas as pd

from .config import APPROACHING_MARGIN, BUCKET_MINUTES, SATURATION_THRESHOLD
from .saturation import MIN_BELOW_STEPS

STEPS_PER_HOUR = 60 // BUCKET_MINUTES
WEEK_STEPS = 7 * 24 * STEPS_PER_HOUR
RECENT_ONSET_STEPS = 3  # a neighbour "recently saturated" if a saturation event (see saturation.py) started in the last 15 min

TEMPORAL_FEATURES = [
    "occ_t", "occ_lag1", "occ_lag2", "occ_lag3", "occ_lag6", "occ_lag12", "occ_lag1w",
    "diff1", "diff3", "diff6", "roll_mean_6", "roll_mean_12", "observed_bays",
    "tod_sin", "tod_cos", "dow", "is_weekend",
]
SPATIAL_FEATURES = [
    "nb_count", "nb_valid", "nb_mean_occ", "nb_wmean_occ", "nb_max_occ", "nb_min_occ",
    "nb_mean_diff1", "nb_mean_diff3", "nb_n_saturated", "nb_n_approaching", "nb_n_recent_onset",
    "nb_mean_dist_m",
]
FEATURE_SETS = {"temporal": TEMPORAL_FEATURES, "spatial_temporal": TEMPORAL_FEATURES + SPATIAL_FEATURES}


def _at(row: np.ndarray, cols: np.ndarray) -> np.ndarray:
    """row[cols] with NaN for negative columns (history before the grid start)."""
    out = np.full(cols.shape, np.nan, dtype=np.float64)
    ok = cols >= 0
    out[ok] = row[cols[ok]]
    return out


def _rolling_mean(row: np.ndarray, cols: np.ndarray, window: int) -> np.ndarray:
    """NaN-aware mean of row[c-window+1 .. c]; NaN when no value in the window is known."""
    vals = np.nan_to_num(row, nan=0.0)
    known = (~np.isnan(row)).astype(np.float64)
    csum = np.concatenate([[0.0], np.cumsum(vals)])
    ccnt = np.concatenate([[0.0], np.cumsum(known)])
    hi = cols + 1
    lo = np.clip(cols - window + 1, 0, None)
    n = ccnt[hi] - ccnt[lo]
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(n > 0, (csum[hi] - csum[lo]) / n, np.nan)


def time_features(times: pd.DatetimeIndex) -> dict[str, np.ndarray]:
    minute = times.hour * 60 + times.minute
    angle = 2 * np.pi * np.asarray(minute) / 1440
    dow = np.asarray(times.dayofweek)
    return {"tod_sin": np.sin(angle), "tod_cos": np.cos(angle), "dow": dow.astype(float), "is_weekend": (dow >= 5).astype(float)}


def build_features(
    occ: np.ndarray,
    observed: np.ndarray,
    rows: np.ndarray,
    cols: np.ndarray,
    times: pd.DatetimeIndex,
    neighbours: dict[int, tuple[np.ndarray, np.ndarray]],
    threshold: float = SATURATION_THRESHOLD,
    margin: float = APPROACHING_MARGIN,
) -> pd.DataFrame:
    """Features for samples (rows[i], cols[i]); `times[i]` is the wall-clock time of cols[i]."""
    rows = np.asarray(rows)
    cols = np.asarray(cols)
    n = len(rows)
    feats = {name: np.full(n, np.nan) for name in TEMPORAL_FEATURES + SPATIAL_FEATURES}
    for name, values in time_features(pd.DatetimeIndex(times)).items():
        feats[name] = values

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)  # all-NaN neighbour slices -> NaN, intended
        for r in np.unique(rows):
            idx = np.flatnonzero(rows == r)
            c = cols[idx]
            series = occ[r]
            cur = _at(series, c)
            feats["occ_t"][idx] = cur
            for lag, name in [(1, "occ_lag1"), (2, "occ_lag2"), (3, "occ_lag3"), (6, "occ_lag6"), (12, "occ_lag12"), (WEEK_STEPS, "occ_lag1w")]:
                feats[name][idx] = _at(series, c - lag)
            feats["diff1"][idx] = cur - feats["occ_lag1"][idx]
            feats["diff3"][idx] = cur - feats["occ_lag3"][idx]
            feats["diff6"][idx] = cur - feats["occ_lag6"][idx]
            feats["roll_mean_6"][idx] = _rolling_mean(series, c, 6)
            feats["roll_mean_12"][idx] = _rolling_mean(series, c, 12)
            feats["observed_bays"][idx] = observed[r, c]

            nb_rows, nb_dist = neighbours.get(int(r), (np.empty(0, int), np.empty(0)))
            feats["nb_count"][idx] = len(nb_rows)
            if len(nb_rows) == 0:
                feats["nb_valid"][idx] = 0
                feats["nb_n_saturated"][idx] = 0
                feats["nb_n_approaching"][idx] = 0
                feats["nb_n_recent_onset"][idx] = 0
                continue
            nb = occ[nb_rows]
            v = np.stack([_at(x, c) for x in nb])
            v1 = np.stack([_at(x, c - 1) for x in nb])
            v3 = np.stack([_at(x, c - 3) for x in nb])
            valid = ~np.isnan(v)
            w = (1.0 / np.maximum(nb_dist, 50.0))[:, None] * valid
            feats["nb_valid"][idx] = valid.sum(0)
            feats["nb_mean_occ"][idx] = np.nanmean(v, 0)
            feats["nb_wmean_occ"][idx] = np.where(w.sum(0) > 0, np.nansum(v * w, 0) / np.maximum(w.sum(0), 1e-12), np.nan)
            feats["nb_max_occ"][idx] = np.nanmax(v, 0)
            feats["nb_min_occ"][idx] = np.nanmin(v, 0)
            feats["nb_mean_diff1"][idx] = np.nanmean(v - v1, 0)
            feats["nb_mean_diff3"][idx] = np.nanmean(v - v3, 0)
            feats["nb_n_saturated"][idx] = (v >= threshold).sum(0)
            feats["nb_n_approaching"][idx] = ((v >= threshold - margin) & (v < threshold)).sum(0)
            # history needed: RECENT_ONSET_STEPS instants plus the MIN_BELOW_STEPS "below" window before each
            hist = {b: np.stack([_at(x, c - b) for x in nb]) for b in range(RECENT_ONSET_STEPS + MIN_BELOW_STEPS)}
            recent = np.zeros(v.shape, dtype=bool)
            for back in range(RECENT_ONSET_STEPS):
                onset = hist[back] >= threshold
                for b in range(1, MIN_BELOW_STEPS + 1):
                    onset &= hist[back + b] < threshold
                recent |= onset
            feats["nb_n_recent_onset"][idx] = recent.sum(0)
            feats["nb_mean_dist_m"][idx] = float(np.mean(nb_dist))
    return pd.DataFrame(feats)


def targets(occ: np.ndarray, rows: np.ndarray, cols: np.ndarray, horizon_steps: int) -> np.ndarray:
    """Occupancy at k + h (NaN when unknown or beyond the grid)."""
    c = np.asarray(cols) + horizon_steps
    out = np.full(len(c), np.nan)
    ok = c < occ.shape[1]
    out[ok] = occ[np.asarray(rows)[ok], c[ok]]
    return out

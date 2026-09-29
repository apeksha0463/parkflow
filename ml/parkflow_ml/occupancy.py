"""Stage 2: sensor intervals -> regular occupancy grid per zone.

At each grid instant t (every BUCKET_MINUTES), for each zone:
    observed(t) = number of bays whose sensor has a state interval covering t
    occupied(t) = number of those bays whose interval has VehiclePresent = true
    occupancy(t) = occupied(t) / observed(t)

Time not covered by any interval of a sensor is UNKNOWN (sensor offline), not vacant, so capacity is
the number of reporting bays rather than an assumed fixed count. occupancy(t) is NaN when fewer than
MIN_OBSERVED_BAYS bays report.

Usage: python -m parkflow_ml.occupancy
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from .config import BUCKET_MINUTES, MIN_OBSERVED_BAYS, PROCESSED_DIR
from .ingest import INTERVALS_PATH

GRID_PATH = PROCESSED_DIR / "occupancy_grid.npz"
OCCUPANCY_REPORT_PATH = PROCESSED_DIR / "occupancy_report.json"
STEP_S = BUCKET_MINUTES * 60
N_BUCKETS = 365 * 24 * 60 // BUCKET_MINUTES


def clip_overlaps(df: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """Truncates an interval where the same sensor's next interval starts before it ends.

    Expects df sorted by (device, start). Returns the clipped frame and the number of clipped rows.
    """
    next_start = df["start"].shift(-1)
    same_device = df["device"].shift(-1) == df["device"]
    overlap = same_device & (next_start < df["end"])
    end = np.where(overlap, next_start.fillna(0).to_numpy(np.int64), df["end"].to_numpy(np.int64))
    out = df.assign(end=end)
    return out[out["end"] > out["start"]], int(overlap.sum())


def bucket_range(start: np.ndarray, end: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Grid instants k*STEP with start <= k*STEP < end, as the half-open index range [first, stop)."""
    first = -(-start // STEP_S)
    stop = -(-end // STEP_S)
    return np.clip(first, 0, N_BUCKETS), np.clip(stop, 0, N_BUCKETS)


def count_grid(zone: np.ndarray, first: np.ndarray, stop: np.ndarray, weight: np.ndarray, n_zones: int, batch: int = 100) -> np.ndarray:
    """Counts, per zone and grid instant, how many intervals cover the instant (difference-array sweep).

    Zones are processed in batches to bound memory on the full dataset.
    """
    keep = (stop > first) & weight
    z, f, s = zone[keep], first[keep], stop[keep]
    width = N_BUCKETS + 1
    out = np.zeros((n_zones, N_BUCKETS), dtype=np.int16)
    for lo in range(0, n_zones, batch):
        hi = min(lo + batch, n_zones)
        m = (z >= lo) & (z < hi)
        zz = z[m] - lo
        size = (hi - lo) * width
        diff = np.bincount(zz * width + f[m], minlength=size) - np.bincount(zz * width + s[m], minlength=size)
        out[lo:hi] = np.cumsum(diff.reshape(hi - lo, width), axis=1)[:, :N_BUCKETS]
    return out


def occupancy_from_counts(occupied: np.ndarray, observed: np.ndarray, min_observed: int = MIN_OBSERVED_BAYS) -> np.ndarray:
    occ = np.full(occupied.shape, np.nan, dtype=np.float32)
    ok = observed >= min_observed
    occ[ok] = occupied[ok] / observed[ok]
    return occ


def main() -> dict:
    df = pd.read_parquet(INTERVALS_PATH)
    df, clipped = clip_overlaps(df)
    n_zones = int(df["zone"].max()) + 1
    first, stop = bucket_range(df["start"].to_numpy(np.int64), df["end"].to_numpy(np.int64))
    zone = df["zone"].to_numpy(np.int64)
    present = df["present"].to_numpy(bool)
    observed = count_grid(zone, first, stop, np.ones_like(present), n_zones)
    occupied = count_grid(zone, first, stop, present, n_zones)
    del df, first, stop, zone, present

    if (occupied > observed).any():
        raise AssertionError("occupied exceeds observed; interval clipping failed")
    occ = occupancy_from_counts(occupied, observed)
    np.savez_compressed(GRID_PATH, occupancy=occ, observed=observed, occupied=occupied, step_minutes=BUCKET_MINUTES)

    valid = ~np.isnan(occ)
    report = {
        "grid_step_minutes": BUCKET_MINUTES,
        "grid_instants_per_zone": N_BUCKETS,
        "zones": n_zones,
        "overlapping_intervals_clipped": clipped,
        "min_observed_bays": MIN_OBSERVED_BAYS,
        "valid_zone_instants": int(valid.sum()),
        "valid_fraction": round(float(valid.mean()), 4),
        "zones_with_any_valid": int(valid.any(axis=1).sum()),
        "occupancy_min": float(np.nanmin(occ)),
        "occupancy_max": float(np.nanmax(occ)),
        "occupancy_mean": round(float(np.nanmean(occ)), 4),
    }
    OCCUPANCY_REPORT_PATH.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    main()

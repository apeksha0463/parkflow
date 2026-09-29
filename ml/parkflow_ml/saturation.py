"""Saturation states and events.

State of a zone at an instant, from its occupancy o and threshold T (default 0.90):
    SATURATED               o >= T
    APPROACHING_SATURATION  T - APPROACHING_MARGIN <= o < T
    NORMAL                  o < T - APPROACHING_MARGIN
    (unknown when o is NaN)

A saturation EVENT starts at an instant a zone is SATURATED after having been known and below T for the previous
MIN_BELOW_STEPS instants (30 min), which ignores flicker around the threshold. It ends at the first instant the
zone is known and below T again. Events are derived from observations only; nothing
here assumes that saturation causes pressure changes elsewhere.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .config import APPROACHING_MARGIN, BUCKET_MINUTES, EVENT_MIN_BELOW_MINUTES, SATURATION_THRESHOLD

MIN_BELOW_STEPS = EVENT_MIN_BELOW_MINUTES // BUCKET_MINUTES

NORMAL, APPROACHING, SATURATED = 0, 1, 2
STATE_NAMES = {NORMAL: "NORMAL", APPROACHING: "APPROACHING_SATURATION", SATURATED: "SATURATED"}


def state_codes(occ: np.ndarray, threshold: float = SATURATION_THRESHOLD, margin: float = APPROACHING_MARGIN) -> np.ndarray:
    """Element-wise state codes; -1 where occupancy is unknown."""
    out = np.full(np.shape(occ), -1, dtype=np.int8)
    valid = ~np.isnan(occ)
    out[valid & (occ < threshold - margin)] = NORMAL
    out[valid & (occ >= threshold - margin) & (occ < threshold)] = APPROACHING
    out[valid & (occ >= threshold)] = SATURATED
    return out


def state_name(occupancy: float | None, threshold: float = SATURATION_THRESHOLD, margin: float = APPROACHING_MARGIN) -> str | None:
    if occupancy is None or np.isnan(occupancy):
        return None
    return STATE_NAMES[int(state_codes(np.array([occupancy], dtype=float), threshold, margin)[0])]


def onset_matrix(occ: np.ndarray, threshold: float = SATURATION_THRESHOLD, min_below: int = MIN_BELOW_STEPS) -> np.ndarray:
    """True at (zone, k) where an event starts: saturated at k, known and below threshold at k-1 .. k-min_below."""
    on = occ >= threshold
    below = occ < threshold  # NaN compares False, so unknown history never counts as "below"
    for b in range(1, min_below + 1):
        prev = np.zeros_like(on)
        prev[:, b:] = below[:, :-b]
        on &= prev
    return on


def detect_events(occ: np.ndarray, zone_ids: np.ndarray, threshold: float = SATURATION_THRESHOLD, min_below: int = MIN_BELOW_STEPS) -> pd.DataFrame:
    """Lists events per zone: onset index, end index (exclusive; -1 if still running at the end), peak occupancy."""
    rows = []
    onsets = onset_matrix(occ, threshold, min_below)
    for r, zone in enumerate(zone_ids):
        series = occ[r]
        for k in np.flatnonzero(onsets[r]):
            below = np.flatnonzero(series[k + 1:] < threshold)
            end = int(k + 1 + below[0]) if len(below) else -1
            seg = series[k:end] if end != -1 else series[k:]
            rows.append({"zone": int(zone), "onset": int(k), "end": end, "peak_occupancy": float(np.nanmax(seg)), "threshold": threshold})
    return pd.DataFrame(rows, columns=["zone", "onset", "end", "peak_occupancy", "threshold"])

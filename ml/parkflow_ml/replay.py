"""Exports the Melbourne research zones for the product's HISTORICAL REPLAY.

Every modelled zone (located, with occupancy data) is exported with its real coordinates, street description,
research neighbours (200 m, from neighbours.csv) and its occupancy over the TEST split, so the product never
replays data the models were trained on. Seven days before the test split are included as model-input history
only (the weekly lag feature); they are never shown as replay time.

Saturation events are detected with the research definition (saturation.detect_events) on the same series, so the
product's event list is exactly the research event definition applied to the test period.

Nothing here changes the research pipeline; it only re-exports its processed outputs.

Usage: python -m parkflow_ml.replay
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from .config import BUCKET_MINUTES, DATASET_ID, NEIGHBOUR_RADIUS_M, PROCESSED_DIR, SATURATION_THRESHOLD, SOURCE_TZ
from .ingest import EPOCH
from .saturation import detect_events
from .train import SPLITS, load_grid

REPLAY_PATH = PROCESSED_DIR / "replay_melbourne.json"
HISTORY_DAYS = 7


def zone_label(z: pd.Series) -> str:
    """Street description exactly as the source gives it (title-cased); the block key when there is no street."""
    street = z.get("street")
    if not isinstance(street, str) or not street.strip():
        return f"Block {z['key']}"
    b1, b2 = z.get("between1"), z.get("between2")
    if isinstance(b1, str) and isinstance(b2, str) and b1.strip() and b2.strip():
        return f"{street.title()} between {b1.title()} and {b2.title()}"
    return street.title()


def to_utc(local: pd.Timestamp) -> str:
    return local.tz_localize(SOURCE_TZ).tz_convert("UTC").isoformat().replace("+00:00", "Z")


def main() -> dict:
    occ, observed, zone_ids, zones, neighbours = load_grid()
    steps_per_day = 24 * 60 // BUCKET_MINUTES
    replay_col = (pd.Timestamp(SPLITS["test"][0]) - EPOCH).days * steps_per_day
    start_col = replay_col - HISTORY_DAYS * steps_per_day
    stop_col = min(occ.shape[1], ((pd.Timestamp(SPLITS["test"][1]) - EPOCH).days + 1) * steps_per_day)
    history_start = EPOCH + pd.Timedelta(minutes=start_col * BUCKET_MINUTES)
    replay_start = EPOCH + pd.Timedelta(minutes=replay_col * BUCKET_MINUTES)
    replay_end = EPOCH + pd.Timedelta(minutes=(stop_col - 1) * BUCKET_MINUTES)

    # Timestamps are exported as UTC instants start + k * step, which is only valid without a DST change in range.
    offsets = {pd.Timestamp(t).tz_localize(SOURCE_TZ).utcoffset() for t in (history_start, replay_end)}
    if len(offsets) != 1:
        raise SystemExit("replay range crosses a daylight-saving change; export would misplace timestamps")

    occ_w = occ[:, start_col:stop_col]
    obs_w = observed[:, start_col:stop_col]
    keep = [r for r in range(len(zone_ids)) if not np.isnan(occ_w[r, replay_col - start_col:]).all()]
    key_of = {r: str(zones.loc[r, "key"]) for r in keep}

    events = detect_events(occ_w[keep], np.arange(len(keep)))
    events = events[events["onset"] >= replay_col - start_col]

    out_zones = []
    for i, r in enumerate(keep):
        z = zones.loc[r]
        series, bays = occ_w[r], obs_w[r]
        nb_rows, nb_dist = neighbours.get(r, (np.empty(0, dtype=int), np.empty(0)))
        out_zones.append({
            "key": key_of[r],
            "label": zone_label(z),
            "street": z["street"].title() if isinstance(z["street"], str) else None,
            "area": z["area"] if isinstance(z.get("area"), str) else None,
            "sensorCount": int(z["sensor_count"]),
            "latitude": float(z["latitude"]),
            "longitude": float(z["longitude"]),
            "neighbours": [
                {"key": key_of[int(n)], "distanceM": round(float(d), 1)}
                for n, d in sorted(zip(nb_rows, nb_dist), key=lambda x: x[1]) if int(n) in key_of
            ],
            # occupancy (as used by the models) and reporting bays per 5-minute instant; null where unknown
            "occupancy": [None if np.isnan(o) else round(float(o), 6) for o in series],
            "bays": [int(b) for b in bays],
            "events": [
                {"onset": int(e.onset), "end": None if e.end == -1 else int(e.end), "peak": round(float(e.peak_occupancy), 4)}
                for e in events[events["zone"] == i].itertuples()
            ],
        })

    payload = {
        "dataset": DATASET_ID,
        "licence": "CC BY 4.0 - City of Melbourne Open Data",
        "sourceUrl": "https://data.melbourne.vic.gov.au/explore/dataset/on-street-car-parking-sensor-data-2019/",
        "note": "City of Melbourne on-street parking sensors, 2019 test split, replayed as history. Not live data.",
        "timezone": SOURCE_TZ,
        "stepMinutes": BUCKET_MINUTES,
        "seriesStart": to_utc(history_start),
        "replayStart": to_utc(replay_start),
        "replayEnd": to_utc(replay_end),
        "steps": int(stop_col - start_col),
        "saturationThreshold": SATURATION_THRESHOLD,
        "neighbourRadiusM": NEIGHBOUR_RADIUS_M,
        "zonesWithoutReplayData": int(len(zone_ids) - len(keep)),
        "zones": out_zones,
    }
    REPLAY_PATH.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"replay: {len(out_zones)} zones, {len(events)} events, {payload['replayStart']} .. {payload['replayEnd']} -> {REPLAY_PATH}")
    return payload


if __name__ == "__main__":
    main()

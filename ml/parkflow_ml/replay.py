"""Exports a small cluster of research zones for the product's SIMULATION demo (historical replay).

Only TEST-period data is exported, so the demo never replays data the models were trained on.
The cluster is the located zone with the most saturation events in the test period that has at least
MIN_NEIGHBOURS neighbours, plus its nearest neighbours. Positions are exported as east/north offsets
(metres) from the cluster centre so the product can lay the demo out with the real relative geometry.

Usage: python -m parkflow_ml.replay
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from .config import BUCKET_MINUTES, DATASET_ID, PROCESSED_DIR
from .ingest import EPOCH
from .saturation import onset_matrix
from .train import SPLITS, load_grid

REPLAY_PATH = PROCESSED_DIR / "replay_cluster.json"
MIN_NEIGHBOURS = 3
MAX_ZONES = 8


def main() -> dict:
    occ, observed, zone_ids, zones, neighbours = load_grid()
    start = (pd.Timestamp(SPLITS["test"][0]) - EPOCH).days * 288
    # Replay whole weeks starting on the first Monday of the test period.
    while (EPOCH + pd.Timedelta(minutes=start * BUCKET_MINUTES)).dayofweek != 0:
        start += 288
    weeks = (occ.shape[1] - start) // 2016
    stop = start + weeks * 2016
    test_onsets = onset_matrix(occ[:, start:stop]).sum(axis=1)

    candidates = [r for r, (nb, _) in neighbours.items() if len(nb) >= MIN_NEIGHBOURS]
    if not candidates:
        raise SystemExit("no zone has enough neighbours for a replay cluster")
    centre = max(candidates, key=lambda r: test_onsets[r])
    nb_rows, nb_dist = neighbours[centre]
    rows = [centre] + list(nb_rows[np.argsort(nb_dist)][: MAX_ZONES - 1])

    lat0 = zones.loc[rows, "latitude"].mean()
    lon0 = zones.loc[rows, "longitude"].mean()
    m_per_deg_lat = 111_195.0
    m_per_deg_lon = m_per_deg_lat * np.cos(np.radians(lat0))
    out_zones = []
    for r in rows:
        z = zones.loc[r]
        series = occ[r, start:stop]
        obs = observed[r, start:stop]
        out_zones.append({
            "sourceZone": f"{DATASET_ID}:{z['key']}",
            "label": f"{str(z['street']).title()} between {str(z['between1']).title()} and {str(z['between2']).title()}",
            "sensorCount": int(z["sensor_count"]),
            "eastM": round(float((z["longitude"] - lon0) * m_per_deg_lon), 1),
            "northM": round(float((z["latitude"] - lat0) * m_per_deg_lat), 1),
            "saturationOnsetsInReplay": int(test_onsets[r]),
            "occupancy": [None if np.isnan(v) else round(float(v), 4) for v in series],
            "observedBays": [int(v) for v in obs],
        })
    payload = {
        "dataset": DATASET_ID,
        "licence": "CC BY 4.0 - City of Melbourne Open Data",
        "note": "Historical sensor data from Melbourne (2019 test period) replayed for demonstration. Not Bengaluru data and not live.",
        "stepMinutes": BUCKET_MINUTES,
        "replayStart": str(EPOCH + pd.Timedelta(minutes=start * BUCKET_MINUTES)),
        "weeks": int(weeks),
        "zones": out_zones,
    }
    REPLAY_PATH.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"replay cluster: {len(out_zones)} zones, {weeks} weeks from {payload['replayStart']}, "
          f"onsets {[z['saturationOnsetsInReplay'] for z in out_zones]} -> {REPLAY_PATH}")
    return payload


if __name__ == "__main__":
    main()

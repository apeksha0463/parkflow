"""Zone locations and neighbour identification.

Zone location: the 2019 sensor file has no coordinates. Each zone is a street block ("X between Y and Z").
The City of Melbourne on-street parking bays dataset gives bay coordinates with a road segment description
in the same "X between Y and Z" form. A zone is located at the mean coordinate of the bays on its matching
segment(s). Matching is on normalised street names; the cross streets are an unordered pair. Zones without a
match have no location and are excluded from the experiment (reported, not guessed).

Neighbours: zones whose locations are within NEIGHBOUR_RADIUS_M (great-circle distance) of each other.

Usage: python -m parkflow_ml.geo
"""
from __future__ import annotations

import json
import re

import numpy as np
import pandas as pd

from .config import NEIGHBOUR_RADIUS_M, PROCESSED_DIR
from .download import BAYS_CSV
from .ingest import ZONES_RAW_PATH

ZONES_PATH = PROCESSED_DIR / "zones.csv"
NEIGHBOURS_PATH = PROCESSED_DIR / "neighbours.csv"
GEO_REPORT_PATH = PROCESSED_DIR / "geo_report.json"
EARTH_RADIUS_M = 6_371_008.8

_SUFFIXES = {"STREET": "ST", "ROAD": "RD", "AVENUE": "AVE", "PARADE": "PDE", "PLACE": "PL", "LANE": "LA",
             "DRIVE": "DR", "BOULEVARD": "BVD", "TERRACE": "TCE", "CRESCENT": "CR", "HIGHWAY": "HWY",
             "SQUARE": "SQ", "WALK": "WK", "WAY": "WAY", "ALLEY": "AL", "CLOSE": "CL", "COURT": "CT"}


def normalise_street(name: str) -> str:
    s = re.sub(r"[^A-Z0-9 ]", " ", str(name).upper())
    words = [_SUFFIXES.get(w, w) for w in s.split()]
    return " ".join(words)


def parse_segment(desc: str) -> tuple[str, frozenset[str]] | None:
    m = re.match(r"^(.*?) between (.*?) and (.*)$", str(desc), flags=re.IGNORECASE)
    if not m:
        return None
    return normalise_street(m.group(1)), frozenset({normalise_street(m.group(2)), normalise_street(m.group(3))})


def haversine_m(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_M * np.arcsin(np.sqrt(a))


def locate_zones(zones: pd.DataFrame, bays: pd.DataFrame) -> pd.DataFrame:
    """Adds latitude/longitude/location_bays to zones by matching block descriptions."""
    parsed = bays["roadsegmentdescription"].map(parse_segment)
    bays = bays.assign(seg=parsed).dropna(subset=["seg", "latitude", "longitude"])
    centroids = bays.groupby("seg").agg(latitude=("latitude", "mean"), longitude=("longitude", "mean"), location_bays=("latitude", "size"))
    keys = [
        (normalise_street(r.street), frozenset({normalise_street(r.between1), normalise_street(r.between2)}))
        for r in zones.itertuples()
    ]
    located = centroids.reindex(keys)
    return zones.assign(
        latitude=located["latitude"].to_numpy(),
        longitude=located["longitude"].to_numpy(),
        location_bays=located["location_bays"].to_numpy(),
    )


def find_neighbours(zones: pd.DataFrame, radius_m: float = NEIGHBOUR_RADIUS_M) -> pd.DataFrame:
    """All ordered pairs (zone, neighbour) of distinct located zones within radius_m."""
    z = zones.dropna(subset=["latitude", "longitude"])
    lat, lon, ids = z["latitude"].to_numpy(), z["longitude"].to_numpy(), z["zone"].to_numpy()
    d = haversine_m(lat[:, None], lon[:, None], lat[None, :], lon[None, :])
    i, j = np.nonzero((d <= radius_m) & ~np.eye(len(ids), dtype=bool))
    return pd.DataFrame({"zone": ids[i], "neighbour": ids[j], "distance_m": d[i, j].round(1)}).sort_values(["zone", "distance_m"], ignore_index=True)


def main() -> dict:
    zones = pd.read_csv(ZONES_RAW_PATH)
    bays = pd.read_csv(BAYS_CSV, encoding="utf-8-sig")
    zones = locate_zones(zones, bays)
    zones.to_csv(ZONES_PATH, index=False)
    nb = find_neighbours(zones)
    nb.to_csv(NEIGHBOURS_PATH, index=False)
    counts = nb.groupby("zone").size().reindex(zones.dropna(subset=["latitude"])["zone"], fill_value=0)
    report = {
        "zones": int(len(zones)),
        "zones_located": int(zones["latitude"].notna().sum()),
        "sensors_in_located_zones": int(zones.loc[zones["latitude"].notna(), "sensor_count"].sum()),
        "sensors_total": int(zones["sensor_count"].sum()),
        "neighbour_radius_m": NEIGHBOUR_RADIUS_M,
        "neighbour_pairs": int(len(nb)),
        "neighbours_per_zone": {k: round(float(v), 2) for k, v in counts.describe().items()},
        "located_zones_without_neighbours": int((counts == 0).sum()),
    }
    GEO_REPORT_PATH.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    main()

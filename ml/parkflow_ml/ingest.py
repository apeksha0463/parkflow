"""Stage 1: stream the 2019 sensor archive into a compact interval table.

Each source row is one sensor state interval: a bay (DeviceId) was occupied (VehiclePresent=true)
or vacant from ArrivalTime to DepartureTime. We keep only what the pipeline uses and store times as
int32 seconds since 2019-01-01 00:00 local wall-clock time.

Zones are street blocks: a street between two cross streets (both kerb sides together), identified
by the source's StreetId + unordered pair of BetweenStreet ids.

Usage: python -m parkflow_ml.ingest
"""
from __future__ import annotations

import json
import zipfile

import numpy as np
import pandas as pd

from .config import PROCESSED_DIR
from .download import SENSOR_ZIP

EPOCH = pd.Timestamp("2019-01-01 00:00:00")
TIME_FORMAT = "%m/%d/%Y %I:%M:%S %p"
USECOLS = [
    "DeviceId", "ArrivalTime", "DepartureTime", "StreetId", "StreetName",
    "BetweenStreet1ID", "BetweenStreet1", "BetweenStreet2ID", "BetweenStreet2", "AreaName", "VehiclePresent",
]
INTERVALS_PATH = PROCESSED_DIR / "intervals.parquet"
ZONES_RAW_PATH = PROCESSED_DIR / "zones_raw.csv"
INGEST_REPORT_PATH = PROCESSED_DIR / "ingest_report.json"


def to_seconds(s: pd.Series) -> pd.Series:
    """Parses source timestamps; unparseable values become NaN (counted and dropped by the caller)."""
    ts = pd.to_datetime(s, format=TIME_FORMAT, errors="coerce")
    return (ts - EPOCH).dt.total_seconds()


def zone_key(df: pd.DataFrame) -> pd.Series:
    lo = np.minimum(df["BetweenStreet1ID"], df["BetweenStreet2ID"]).astype("int64")
    hi = np.maximum(df["BetweenStreet1ID"], df["BetweenStreet2ID"]).astype("int64")
    return df["StreetId"].astype("int64").astype(str) + ":" + lo.astype(str) + "-" + hi.astype(str)


def clean_chunk(df: pd.DataFrame, stats: dict) -> pd.DataFrame:
    """Validates one chunk. Every removal is counted by reason."""
    stats["raw_rows"] += len(df)
    missing = df[["DeviceId", "ArrivalTime", "DepartureTime", "StreetId", "BetweenStreet1ID", "BetweenStreet2ID", "VehiclePresent"]].isna().any(axis=1)
    stats["removed_missing_fields"] += int(missing.sum())
    df = df[~missing].copy()

    df["start"] = to_seconds(df["ArrivalTime"])
    df["end"] = to_seconds(df["DepartureTime"])
    bad_time = df["start"].isna() | df["end"].isna()
    stats["removed_unparseable_time"] += int(bad_time.sum())
    df = df[~bad_time]

    non_positive = df["end"] <= df["start"]
    stats["removed_non_positive_duration"] += int(non_positive.sum())
    df = df[~non_positive]

    out_of_year = (df["start"] < 0) | (df["start"] >= 365 * 86400)
    stats["removed_outside_2019"] += int(out_of_year.sum())
    df = df[~out_of_year]

    present = df["VehiclePresent"]
    if present.dtype != bool:
        present = present.astype(str).str.lower().map({"true": True, "false": False})
    df = df.assign(present=present)
    bad_flag = df["present"].isna()
    stats["removed_invalid_vehicle_present"] += int(bad_flag.sum())
    return df[~bad_flag]


def main(chunksize: int = 2_000_000) -> dict:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    stats = {k: 0 for k in [
        "raw_rows", "removed_missing_fields", "removed_unparseable_time", "removed_non_positive_duration",
        "removed_outside_2019", "removed_invalid_vehicle_present", "removed_duplicates",
    ]}
    zone_codes: dict[str, int] = {}
    zone_meta: dict[str, dict] = {}
    parts: list[pd.DataFrame] = []

    with zipfile.ZipFile(SENSOR_ZIP) as zf:
        name = next(n for n in zf.namelist() if n.lower().endswith(".csv"))
        with zf.open(name) as fh:
            reader = pd.read_csv(fh, usecols=USECOLS, chunksize=chunksize, encoding="utf-8-sig", low_memory=False)
            for i, chunk in enumerate(reader):
                df = clean_chunk(chunk, stats)
                keys = zone_key(df)
                for key, row in zip(keys.drop_duplicates(), df.loc[keys.drop_duplicates().index].itertuples()):
                    if key not in zone_codes:
                        zone_codes[key] = len(zone_codes)
                        zone_meta[key] = {
                            "street": row.StreetName, "between1": row.BetweenStreet1,
                            "between2": row.BetweenStreet2, "area": row.AreaName,
                        }
                parts.append(pd.DataFrame({
                    "zone": keys.map(zone_codes).astype("int32").to_numpy(),
                    "device": df["DeviceId"].astype("int32").to_numpy(),
                    "start": df["start"].astype("int32").to_numpy(),
                    "end": df["end"].astype("int32").to_numpy(),
                    "present": df["present"].astype(bool).to_numpy(),
                }))
                print(f"chunk {i}: {stats['raw_rows']:,} rows read")

    intervals = pd.concat(parts, ignore_index=True)
    del parts
    # Sort, then drop rows identical to their predecessor (cheaper than hashing 40M+ rows).
    intervals = intervals.sort_values(["device", "start", "end", "present"], kind="mergesort", ignore_index=True)
    cols = ["device", "start", "end", "present"]
    dup = np.logical_and.reduce([intervals[c].to_numpy()[1:] == intervals[c].to_numpy()[:-1] for c in cols])
    keep = np.concatenate([[True], ~dup])
    stats["removed_duplicates"] = int((~keep).sum())
    intervals = intervals[keep].reset_index(drop=True)
    intervals.to_parquet(INTERVALS_PATH, index=False)

    zones = pd.DataFrame([{"zone": code, "key": key, **zone_meta[key]} for key, code in zone_codes.items()])
    devices = intervals.groupby("zone")["device"].nunique().rename("sensor_count")
    zones = zones.join(devices, on="zone")
    zones.to_csv(ZONES_RAW_PATH, index=False)

    stats["final_rows"] = len(intervals)
    stats["devices"] = int(intervals["device"].nunique())
    stats["zones"] = int(len(zones))
    stats["first_start"] = str(EPOCH + pd.Timedelta(seconds=int(intervals["start"].min())))
    stats["last_end"] = str(EPOCH + pd.Timedelta(seconds=int(intervals["end"].max())))
    INGEST_REPORT_PATH.write_text(json.dumps(stats, indent=2))
    print(json.dumps(stats, indent=2))
    return stats


if __name__ == "__main__":
    main()

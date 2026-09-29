"""Pipeline constants. Values here define the research experiment and are recorded in model metadata."""
from __future__ import annotations

from pathlib import Path

ML_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = ML_ROOT.parent
RAW_DIR = REPO_ROOT / "data" / "raw" / "melbourne"
PROCESSED_DIR = REPO_ROOT / "data" / "processed"
ARTIFACTS_DIR = ML_ROOT / "artifacts"
EVALUATION_DIR = ML_ROOT / "evaluation"

DATASET_ID = "melbourne-on-street-sensors-2019"
SENSOR_ZIP_URL = "https://opendatasoft-s3.s3.amazonaws.com/downloads/archive/7pgd-bdf2.zip"
BAYS_CSV_URL = (
    "https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/"
    "on-street-parking-bays/exports/csv?delimiter=%2C"
)
# Sensor timestamps are Melbourne local time (no offset in the source).
SOURCE_TZ = "Australia/Melbourne"

# Occupancy is sampled on a regular grid. The source records second-resolution events,
# so a 5-minute grid is supported by the data.
BUCKET_MINUTES = 5
HORIZONS_MINUTES = (5, 10, 15, 30)

SATURATION_THRESHOLD = 0.90
# APPROACHING_SATURATION starts this far below the saturation threshold.
APPROACHING_MARGIN = 0.10

# A saturation EVENT starts only after the zone was below the threshold for this long. With ~12 bays per block,
# occupancy flickers around 90% (e.g. 11/12 <-> 12/12); without this, 4.4 "events" per zone per day were detected.
EVENT_MIN_BELOW_MINUTES = 30

# Neighbours = zones within this distance. A Melbourne CBD block is ~200 m (Hoddle Grid), so 200 m captures
# adjacent blocks (median 4 neighbours); 400 m gave a median of 16, mixing in zones two or more blocks away.
NEIGHBOUR_RADIUS_M = 200
# A zone must have at least this many reporting sensors at a timestamp for its occupancy to be used;
# below it the ratio is too coarse (e.g. 1 of 2 bays = 50%).
MIN_OBSERVED_BAYS = 4

FEATURE_VERSION = "v1"

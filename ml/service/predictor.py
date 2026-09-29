"""Loads trained models from the registry and turns occupancy histories into predictions.

The service is geography-agnostic: the caller (Node API) sends the target zone's recent occupancy history
and the histories of its neighbours (already selected by distance). Features are built with the same
function used in training.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from parkflow_ml import features as F
from parkflow_ml.config import SATURATION_THRESHOLD
from parkflow_ml.saturation import state_name

from .registry import load_registry, registry_path

MIN_HISTORY_STEPS = 13  # one hour on the 5-minute grid: covers every short lag and rolling window


class PredictionUnavailable(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class LoadedModel:
    meta: dict
    models: dict[int, object]


@lru_cache(maxsize=4)
def _load(model_id: str, registry_file: str, mtime: float) -> LoadedModel:
    registry = load_registry()
    meta = next((m for m in (registry or {}).get("models", []) if m["id"] == model_id), None)
    if meta is None:
        raise PredictionUnavailable("MODEL_NOT_FOUND", f"Model {model_id} is not in the registry")
    base = Path(registry_file).parent
    return LoadedModel(meta=meta, models={int(h): joblib.load(base / rel) for h, rel in meta["files"].items()})


def get_model(model_id: str | None = None) -> LoadedModel:
    registry = load_registry()
    if not registry or not registry.get("models"):
        raise PredictionUnavailable("NO_MODEL", "No trained model is available")
    wanted = model_id or registry["active"]
    path = registry_path()
    return _load(wanted, str(path), path.stat().st_mtime)


def _series(values: list[float | None]) -> np.ndarray:
    return np.array([np.nan if v is None else float(v) for v in values], dtype=np.float64)


def predict(
    target_history: list[float | None],
    observed_bays: int,
    timestamp: pd.Timestamp,
    neighbours: list[dict],
    horizons: list[int] | None = None,
    model_id: str | None = None,
    threshold: float = SATURATION_THRESHOLD,
) -> dict:
    """target_history / neighbour histories are oldest -> newest on the 5-minute grid, the last value at `timestamp`."""
    loaded = get_model(model_id)
    meta = loaded.meta
    target = _series(target_history)
    if len(target) < MIN_HISTORY_STEPS or np.isnan(target[-1]) or np.isnan(target[-MIN_HISTORY_STEPS:]).sum() > MIN_HISTORY_STEPS // 2:
        raise PredictionUnavailable("INSUFFICIENT_HISTORY", "Prediction unavailable - insufficient historical data")
    if observed_bays <= 0:
        raise PredictionUnavailable("INSUFFICIENT_HISTORY", "Prediction unavailable - no reporting capacity")

    use_neighbours = meta["feature_set"] == "spatial_temporal"
    nb_series = [_series(n["history"]) for n in neighbours] if use_neighbours else []
    length = max([len(target)] + [len(s) for s in nb_series])
    grid = np.full((1 + len(nb_series), length), np.nan)
    grid[0, length - len(target):] = target
    for i, s in enumerate(nb_series, start=1):
        grid[i, length - len(s):] = s
    observed = np.zeros(grid.shape, dtype=np.int16)
    observed[0, -1] = observed_bays
    nb_map = {0: (np.arange(1, 1 + len(nb_series)), np.array([float(n["distanceM"]) for n in neighbours]) if use_neighbours else np.empty(0))}
    # Model features use the training threshold; the caller's threshold only labels the output.
    X = F.build_features(grid, observed, np.array([0]), np.array([length - 1]), pd.DatetimeIndex([timestamp]), nb_map)
    X = X[meta["features"]].astype(np.float32)

    current = float(target[-1])
    wanted = horizons or sorted(loaded.models)
    out = []
    for h in wanted:
        if h not in loaded.models:
            continue
        p = float(np.clip(current + loaded.models[h].predict(X)[0], 0.0, 1.0))
        out.append({"horizonMinutes": h, "predictedOccupancy": round(p, 4), "pressureLevel": state_name(p, threshold)})
    return {
        "modelVersion": meta["id"],
        "featureSet": meta["feature_set"],
        "basedOn": timestamp.isoformat(),
        "currentOccupancy": round(current, 4),
        "currentState": state_name(current, threshold),
        "neighboursUsed": len(nb_series),
        "predictions": out,
    }

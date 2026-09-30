from __future__ import annotations

import json
from datetime import datetime, timezone

import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from parkflow_ml.config import DATASET_ID, PROCESSED_DIR

from .predictor import PredictionUnavailable, predict
from .registry import load_registry, registry_path

app = FastAPI(title="ParkFlow ML Service", version="0.2.0")


@app.get("/health")
def health() -> dict:
    registry = load_registry()
    return {
        "status": "ok",
        "service": "parkflow-ml",
        "modelsLoaded": bool(registry and registry.get("models")),
        "activeModelVersion": (registry or {}).get("active"),
    }


@app.get("/models")
def models() -> dict:
    """Model metadata and test metrics exactly as written by the training run."""
    registry = load_registry()
    if not registry:
        raise HTTPException(503, {"code": "NO_MODEL", "message": "No trained model is available"})
    return registry


@app.get("/evaluation")
def evaluation() -> dict:
    """The offline evaluation written by `python -m parkflow_ml.train` (results.json), unmodified."""
    path = registry_path().parent.parent / "evaluation" / "results.json"
    if not path.exists():
        raise HTTPException(503, {"code": "NO_EVALUATION", "message": "No evaluation results are available"})
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/dataset")
def dataset() -> dict:
    """Dataset processing reports written by the pipeline (ingest, occupancy grid, geo), unmodified."""
    out = {}
    for name in ("ingest", "occupancy", "geo"):
        path = PROCESSED_DIR / f"{name}_report.json"
        out[name] = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
    if not any(out.values()):
        raise HTTPException(503, {"code": "NO_DATASET_REPORT", "message": "No dataset reports are available"})
    return {"dataset": DATASET_ID, **out}


class NeighbourIn(BaseModel):
    distanceM: float = Field(ge=0, le=5000)
    history: list[float | None] = Field(max_length=2100)


class PredictIn(BaseModel):
    zoneId: str = Field(max_length=64)
    timestamp: datetime = Field(description="Local wall-clock time of the last history value")
    history: list[float | None] = Field(max_length=2100, description="Occupancy 0-1 on the 5-minute grid, oldest first")
    observedBays: int = Field(ge=1, le=10000)
    neighbours: list[NeighbourIn] = Field(default_factory=list, max_length=50)
    horizons: list[int] | None = None
    model: str | None = Field(default=None, max_length=64)
    threshold: float = Field(default=0.9, gt=0.5, le=1.0)


@app.post("/predict")
def predict_route(body: PredictIn) -> dict:
    for v in body.history + [x for n in body.neighbours for x in n.history]:
        if v is not None and not 0.0 <= v <= 1.0:
            raise HTTPException(422, {"code": "VALIDATION_ERROR", "message": "Occupancy values must be within [0, 1]"})
    # Time features are wall-clock based, so an offset (if sent) is dropped without converting.
    ts = pd.Timestamp(body.timestamp).tz_localize(None)
    try:
        result = predict(body.history, body.observedBays, ts, [n.model_dump() for n in body.neighbours], body.horizons, body.model, body.threshold)
    except PredictionUnavailable as e:
        status = 422 if e.code == "INSUFFICIENT_HISTORY" else 503
        raise HTTPException(status, {"code": e.code, "message": e.message})
    return {"zoneId": body.zoneId, "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), **result}

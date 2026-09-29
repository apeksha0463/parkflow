from __future__ import annotations

from fastapi import FastAPI

from .registry import load_registry

app = FastAPI(title="ParkFlow ML Service", version="0.1.0")


@app.get("/health")
def health() -> dict:
    registry = load_registry()
    return {
        "status": "ok",
        "service": "parkflow-ml",
        "modelsLoaded": bool(registry and registry.get("models")),
        "activeModelVersion": (registry or {}).get("active"),
    }

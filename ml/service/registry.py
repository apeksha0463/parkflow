"""Loads trained model artifacts described by artifacts/registry.json.

The service never trains models; if no registry exists it reports that honestly
and prediction endpoints return 503 rather than inventing values.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

ML_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_REGISTRY = ML_ROOT / "artifacts" / "registry.json"


def registry_path() -> Path:
    env = os.getenv("MODEL_REGISTRY_PATH")
    if not env:
        return DEFAULT_REGISTRY
    p = Path(env)
    return p if p.is_absolute() else ML_ROOT.parent / p


def load_registry() -> dict | None:
    path = registry_path()
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))

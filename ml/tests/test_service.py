import json

import joblib
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sklearn.ensemble import HistGradientBoostingRegressor

from parkflow_ml import features as F
from service import predictor
from service.app import app


def test_health_reports_no_models_when_registry_missing(tmp_path, monkeypatch):
    monkeypatch.setenv("MODEL_REGISTRY_PATH", str(tmp_path / "missing.json"))
    res = TestClient(app).get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["modelsLoaded"] is False
    assert body["activeModelVersion"] is None


def test_predict_returns_503_without_a_model(tmp_path, monkeypatch):
    monkeypatch.setenv("MODEL_REGISTRY_PATH", str(tmp_path / "missing.json"))
    res = TestClient(app).post("/predict", json={"zoneId": "z", "timestamp": "2019-11-04T09:00:00", "history": [0.5] * 20, "observedBays": 10})
    assert res.status_code == 503
    assert res.json()["detail"]["code"] == "NO_MODEL"


@pytest.fixture
def tiny_registry(tmp_path, monkeypatch):
    """A registry with small models fitted on arbitrary rows: this checks plumbing and shapes, not accuracy."""
    rng = np.random.default_rng(0)
    registry = {"active": "spatial_temporal-hgb-test", "models": []}
    for fs, cols in F.FEATURE_SETS.items():
        X = pd.DataFrame(rng.random((200, len(cols))), columns=cols)
        y = rng.normal(0, 0.05, 200)
        files = {}
        (tmp_path / fs).mkdir()
        for h in (5, 15):
            joblib.dump(HistGradientBoostingRegressor(max_iter=5).fit(X, y), tmp_path / fs / f"h{h}.joblib")
            files[str(h)] = f"{fs}/h{h}.joblib"
        registry["models"].append({"id": f"{fs}-hgb-test", "feature_set": fs, "features": cols, "files": files})
    path = tmp_path / "registry.json"
    path.write_text(json.dumps(registry))
    monkeypatch.setenv("MODEL_REGISTRY_PATH", str(path))
    predictor._load.cache_clear()
    return path


def _body(**over):
    body = {
        "zoneId": "zone-1", "timestamp": "2019-11-04T09:00:00", "history": list(np.linspace(0.6, 0.92, 24)), "observedBays": 12,
        "neighbours": [{"distanceM": 150, "history": [0.5] * 24}, {"distanceM": 320, "history": [0.95] * 24}],
    }
    body.update(over)
    return body


def test_predict_returns_only_trained_horizons_in_bounds(tiny_registry):
    res = TestClient(app).post("/predict", json=_body())
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["modelVersion"] == "spatial_temporal-hgb-test"
    assert out["neighboursUsed"] == 2
    assert [p["horizonMinutes"] for p in out["predictions"]] == [5, 15]
    for p in out["predictions"]:
        assert 0.0 <= p["predictedOccupancy"] <= 1.0
        assert p["pressureLevel"] in {"NORMAL", "APPROACHING_SATURATION", "SATURATED"}
    assert out["currentOccupancy"] == pytest.approx(0.92)
    assert "confidence" not in json.dumps(out)


def test_temporal_model_ignores_neighbours(tiny_registry):
    out = TestClient(app).post("/predict", json=_body(model="temporal-hgb-test")).json()
    assert out["featureSet"] == "temporal" and out["neighboursUsed"] == 0


def test_short_or_missing_history_is_refused_not_guessed(tiny_registry):
    client = TestClient(app)
    res = client.post("/predict", json=_body(history=[0.5] * 5))
    assert res.status_code == 422 and res.json()["detail"]["code"] == "INSUFFICIENT_HISTORY"
    res = client.post("/predict", json=_body(history=[0.5] * 23 + [None]))
    assert res.status_code == 422


def test_out_of_range_occupancy_is_rejected(tiny_registry):
    res = TestClient(app).post("/predict", json=_body(history=[1.4] * 24))
    assert res.status_code == 422

from fastapi.testclient import TestClient

from service.app import app


def test_health_reports_no_models_when_registry_missing(tmp_path, monkeypatch):
    monkeypatch.setenv("MODEL_REGISTRY_PATH", str(tmp_path / "missing.json"))
    res = TestClient(app).get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["modelsLoaded"] is False
    assert body["activeModelVersion"] is None

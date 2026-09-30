FROM python:3.13-slim

# Build context is the repo root.

WORKDIR /app

# Install deps first for layer caching
COPY ml/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# ML package + service (mirror the local ml/ layout; both packages are top-level from /app/ml)
COPY ml/parkflow_ml ./ml/parkflow_ml
COPY ml/service ./ml/service

# Trained model artifacts (~4 MB total, committed to git)
COPY ml/artifacts ./ml/artifacts

# Evaluation results (served by GET /evaluation)
COPY ml/evaluation/results.json ./ml/evaluation/results.json

# Dataset pipeline reports (served by GET /dataset)
COPY data/processed/ingest_report.json ./data/processed/ingest_report.json
COPY data/processed/occupancy_report.json ./data/processed/occupancy_report.json
COPY data/processed/geo_report.json ./data/processed/geo_report.json

ENV MODEL_REGISTRY_PATH=artifacts/registry.json
ENV PORT=8000

# Run from /app/ml so that `service` and `parkflow_ml` are importable as top-level packages,
# and Path(__file__).resolve().parent.parent (ML_ROOT) == /app/ml, matching local dev.
WORKDIR /app/ml

EXPOSE 8000

CMD ["sh", "-c", "python -m uvicorn service.app:app --host 0.0.0.0 --port ${PORT:-8000}"]

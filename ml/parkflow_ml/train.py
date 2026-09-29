"""Stage 4: train and evaluate the temporal-only (A) and spatial-temporal (B) models.

Split (chronological, by calendar date, no shuffling):
    train       2019-01-01 .. 2019-08-31
    validation  2019-09-01 .. 2019-10-31   (hyper-parameter choice only)
    test        2019-11-01 .. 2019-12-31   (reported once, after the final refit on train+validation)
Samples are restricted to EXPERIMENT_HOURS; the overnight gap means no target (k + 30 min) of one
period falls inside the next period.

For each feature set and horizon we fit:
    persistence   y_hat = current occupancy (reference baseline, no fitting)
    ridge         imputation + scaling + ridge regression
    hgb           HistGradientBoostingRegressor
Models predict the change in occupancy and are converted back to occupancy clipped to [0, 1]; errors
are reported on occupancy (fraction 0-1).

Usage: python -m parkflow_ml.train
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from . import features as F
from .config import (
    APPROACHING_MARGIN, ARTIFACTS_DIR, BUCKET_MINUTES, DATASET_ID, EVALUATION_DIR, FEATURE_VERSION,
    HORIZONS_MINUTES, MIN_OBSERVED_BAYS, NEIGHBOUR_RADIUS_M, SATURATION_THRESHOLD,
)
from .geo import NEIGHBOURS_PATH, ZONES_PATH
from .ingest import EPOCH
from .occupancy import GRID_PATH
from .saturation import detect_events

EXPERIMENT_HOURS = (7, 22)  # 07:00-21:55 local time
SPLITS = {"train": ("2019-01-01", "2019-08-31"), "validation": ("2019-09-01", "2019-10-31"), "test": ("2019-11-01", "2019-12-31")}
TRAIN_STRIDE = 3  # training samples every 15 min (neighbouring 5-min samples are near-duplicates); evaluation uses every instant
HGB_GRID = [{"max_leaf_nodes": 31}, {"max_leaf_nodes": 63}]
HGB_FIXED = {"learning_rate": 0.1, "max_iter": 300, "early_stopping": False, "random_state": 0}
SELECTION_HORIZON = 15
BOOTSTRAP_ROUNDS = 1000


def load_grid():
    grid = np.load(GRID_PATH)
    zones = pd.read_csv(ZONES_PATH)
    occ_all, observed_all = grid["occupancy"], grid["observed"]
    located = zones[zones["latitude"].notna()].copy()
    located = located[~np.isnan(occ_all[located["zone"].to_numpy()]).all(axis=1)]
    zone_ids = located["zone"].to_numpy()
    occ = occ_all[zone_ids]
    observed = observed_all[zone_ids]
    del occ_all, observed_all
    pos = {int(z): i for i, z in enumerate(zone_ids)}
    nb = pd.read_csv(NEIGHBOURS_PATH)
    nb = nb[nb["zone"].isin(pos) & nb["neighbour"].isin(pos)]
    neighbours = {
        pos[int(z)]: (g["neighbour"].map(pos).to_numpy(), g["distance_m"].to_numpy())
        for z, g in nb.groupby("zone")
    }
    return occ, observed, zone_ids, located.reset_index(drop=True), neighbours


def sample_index(occ: np.ndarray, split: str, stride: int) -> tuple[np.ndarray, np.ndarray]:
    """(rows, cols) of samples in a split whose current occupancy is known."""
    start, end = SPLITS[split]
    steps = 24 * 60 // BUCKET_MINUTES
    day0 = (pd.Timestamp(start) - EPOCH).days
    day1 = (pd.Timestamp(end) - EPOCH).days
    per_day = np.arange(EXPERIMENT_HOURS[0] * 60 // BUCKET_MINUTES, EXPERIMENT_HOURS[1] * 60 // BUCKET_MINUTES, stride)
    cols = (np.arange(day0, day1 + 1)[:, None] * steps + per_day[None, :]).ravel()
    cols = cols[cols < occ.shape[1]]
    valid = ~np.isnan(occ[:, cols])
    r, c = np.nonzero(valid)
    return r, cols[c]


def build_split(occ, observed, neighbours, split, stride):
    rows, cols = sample_index(occ, split, stride)
    times = EPOCH + pd.to_timedelta(cols * BUCKET_MINUTES, unit="m")
    X = F.build_features(occ, observed, rows, cols, times, neighbours).astype(np.float32)
    Y = {h: F.targets(occ, rows, cols, h // BUCKET_MINUTES) for h in HORIZONS_MINUTES}
    meta = pd.DataFrame({"row": rows, "col": cols, "date": times.normalize()})
    return X, Y, meta


def make_model(kind: str, params: dict | None = None):
    if kind == "ridge":
        return make_pipeline(SimpleImputer(strategy="median", add_indicator=True), StandardScaler(), Ridge(alpha=1.0))
    return HistGradientBoostingRegressor(**HGB_FIXED, **(params or {}))


def predict_occupancy(model, X: pd.DataFrame) -> np.ndarray:
    return np.clip(X["occ_t"].to_numpy() + model.predict(X), 0.0, 1.0)


def metrics(y: np.ndarray, p: np.ndarray) -> dict:
    err = p - y
    ss_res = float(np.sum(err ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    return {"n": int(len(y)), "mae": float(np.mean(np.abs(err))), "rmse": float(np.sqrt(np.mean(err ** 2))),
            "r2": float(1 - ss_res / ss_tot) if ss_tot > 0 else None}


def paired_bootstrap(dates: np.ndarray, err_a: np.ndarray, err_b: np.ndarray, rounds: int = BOOTSTRAP_ROUNDS, seed: int = 0) -> dict:
    """Day-block bootstrap of MAE(A) - MAE(B) (positive = B lower error). Resamples whole days to respect autocorrelation."""
    days, inv = np.unique(dates, return_inverse=True)
    sum_a = np.bincount(inv, weights=np.abs(err_a), minlength=len(days))
    sum_b = np.bincount(inv, weights=np.abs(err_b), minlength=len(days))
    cnt = np.bincount(inv, minlength=len(days))
    rng = np.random.default_rng(seed)
    pick = rng.integers(0, len(days), size=(rounds, len(days)))
    n = cnt[pick].sum(1)
    diff = (sum_a[pick].sum(1) - sum_b[pick].sum(1)) / np.maximum(n, 1)
    return {"days": int(len(days)), "mae_diff_mean": float(diff.mean()), "ci95": [float(np.percentile(diff, 2.5)), float(np.percentile(diff, 97.5))]}


def subsets(X: pd.DataFrame) -> dict[str, np.ndarray]:
    return {
        "all": np.ones(len(X), dtype=bool),
        # The research subset: a neighbouring zone's saturation event began within the last 15 minutes.
        "post_neighbour_saturation": (X["nb_n_recent_onset"] >= 1).to_numpy(),
        "target_approaching_or_saturated": (X["occ_t"] >= SATURATION_THRESHOLD - APPROACHING_MARGIN).to_numpy(),
        "has_neighbours": (X["nb_count"] >= 1).to_numpy(),
    }


def main() -> dict:
    t0 = time.time()
    EVALUATION_DIR.mkdir(parents=True, exist_ok=True)
    occ, observed, zone_ids, zones, neighbours = load_grid()
    print(f"zones in experiment: {len(zone_ids)}; with neighbours: {len(neighbours)}")

    data = {s: build_split(occ, observed, neighbours, s, TRAIN_STRIDE if s == "train" else 1) for s in SPLITS}
    split_info = {}
    for s, (X, Y, meta) in data.items():
        split_info[s] = {"range": SPLITS[s], "samples": int(len(X)),
                         "samples_with_15min_target": int(np.isfinite(Y[15]).sum()),
                         "post_neighbour_saturation_samples": int((X["nb_n_recent_onset"] >= 1).sum())}
    print(json.dumps(split_info, indent=2), f"({time.time() - t0:.0f}s)")

    # --- hyper-parameter choice on validation (h = SELECTION_HORIZON) ---
    Xtr, Ytr, _ = data["train"]
    Xva, Yva, _ = data["validation"]
    h = SELECTION_HORIZON
    selection = {}
    for fs, cols in F.FEATURE_SETS.items():
        mtr, mva = np.isfinite(Ytr[h]), np.isfinite(Yva[h])
        best = None
        for params in HGB_GRID:
            m = make_model("hgb", params).fit(Xtr.loc[mtr, cols], Ytr[h][mtr] - Xtr.loc[mtr, "occ_t"])
            mae = metrics(Yva[h][mva], predict_occupancy(m, Xva.loc[mva, cols]))["mae"]
            print(f"select {fs} {params}: val MAE {mae:.5f}")
            if best is None or mae < best[1]:
                best = (params, mae)
        selection[fs] = {"params": best[0], "validation_mae": best[1]}

    # --- final fit on train+validation, single evaluation on test ---
    Xfit = pd.concat([Xtr, Xva], ignore_index=True)
    Xte, Yte, meta_te = data["test"]
    subset_masks = subsets(Xte)
    trained_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows_out, comparisons, per_pred = [], [], {}
    for hz in HORIZONS_MINUTES:
        yfit = np.concatenate([Ytr[hz], Yva[hz]])
        mfit = np.isfinite(yfit)
        mte = np.isfinite(Yte[hz])
        preds = {"persistence": np.clip(Xte["occ_t"].to_numpy(), 0, 1)}
        for fs, cols in F.FEATURE_SETS.items():
            for kind in ("ridge", "hgb"):
                model = make_model(kind, selection[fs]["params"] if kind == "hgb" else None)
                model.fit(Xfit.loc[mfit, cols], yfit[mfit] - Xfit.loc[mfit, "occ_t"])
                preds[f"{fs}/{kind}"] = predict_occupancy(model, Xte[cols])
                if kind == "hgb":
                    out_dir = ARTIFACTS_DIR / fs
                    out_dir.mkdir(parents=True, exist_ok=True)
                    joblib.dump(model, out_dir / f"hgb_h{hz}.joblib", compress=3)
                print(f"h={hz} {fs}/{kind} fitted ({time.time() - t0:.0f}s)")
        per_pred[hz] = preds
        for name, p in preds.items():
            fs, kind = (name.split("/") + [None])[:2] if "/" in name else ("none", "persistence")
            for sub, sm in subset_masks.items():
                m = mte & sm
                if m.sum() == 0:
                    continue
                rows_out.append({"horizon_min": hz, "feature_set": fs, "model": kind, "subset": sub, **metrics(Yte[hz][m], p[m])})
        for sub, sm in subset_masks.items():
            m = mte & sm
            if m.sum() == 0:
                continue
            for kind in ("ridge", "hgb"):
                ea = preds[f"temporal/{kind}"][m] - Yte[hz][m]
                eb = preds[f"spatial_temporal/{kind}"][m] - Yte[hz][m]
                mae_a, mae_b = float(np.mean(np.abs(ea))), float(np.mean(np.abs(eb)))
                comparisons.append({
                    "horizon_min": hz, "model": kind, "subset": sub, "n": int(m.sum()),
                    "mae_temporal": mae_a, "mae_spatial_temporal": mae_b,
                    "mae_reduction_pct": 100 * (mae_a - mae_b) / mae_a if mae_a > 0 else None,
                    "bootstrap": paired_bootstrap(meta_te["date"].to_numpy()[m], ea, eb),
                })

    results = pd.DataFrame(rows_out)
    results.to_csv(EVALUATION_DIR / "results.csv", index=False)

    # Actual-vs-predicted sample for plots and the analytics page: 15-min horizon, test period, post-saturation samples first.
    hz = 15
    m = np.isfinite(Yte[hz])
    sample = pd.DataFrame({
        "zone": zone_ids[meta_te["row"].to_numpy()], "time": (EPOCH + pd.to_timedelta(meta_te["col"] * BUCKET_MINUTES, unit="m")).astype(str),
        "current": Xte["occ_t"].to_numpy(), "actual": Yte[hz],
        "temporal": per_pred[hz]["temporal/hgb"], "spatial_temporal": per_pred[hz]["spatial_temporal/hgb"],
        "post_neighbour_saturation": subset_masks["post_neighbour_saturation"],
    })[m]
    sample.sample(n=min(5000, len(sample)), random_state=0).sort_values(["zone", "time"]).to_csv(EVALUATION_DIR / "actual_vs_predicted_sample.csv", index=False)

    events = detect_events(occ, zone_ids)
    events["onset_time"] = (EPOCH + pd.to_timedelta(events["onset"] * BUCKET_MINUTES, unit="m")).astype(str)
    event_stats = {
        "events": int(len(events)),
        "zones_with_events": int(events["zone"].nunique()),
        "events_by_hour": {int(k): int(v) for k, v in pd.to_datetime(events["onset_time"]).dt.hour.value_counts().sort_index().items()},
        "median_duration_min": float(np.median((events.loc[events["end"] >= 0, "end"] - events.loc[events["end"] >= 0, "onset"]) * BUCKET_MINUTES)) if (events["end"] >= 0).any() else None,
    }
    events.to_csv(EVALUATION_DIR / "saturation_events.csv", index=False)

    config = {
        "dataset": DATASET_ID, "feature_version": FEATURE_VERSION, "bucket_minutes": BUCKET_MINUTES,
        "horizons_minutes": list(HORIZONS_MINUTES), "saturation_threshold": SATURATION_THRESHOLD,
        "approaching_margin": APPROACHING_MARGIN, "neighbour_radius_m": NEIGHBOUR_RADIUS_M,
        "min_observed_bays": MIN_OBSERVED_BAYS, "experiment_hours": list(EXPERIMENT_HOURS), "train_stride": TRAIN_STRIDE,
        "hgb_fixed": HGB_FIXED, "hgb_grid": HGB_GRID, "selection_horizon": SELECTION_HORIZON,
        "features": F.FEATURE_SETS,
    }
    summary = {
        "generated_at": trained_at, "config": config, "splits": split_info, "selection": selection,
        "zones_in_experiment": int(len(zone_ids)), "zones_with_neighbours": int(len(neighbours)),
        "saturation_events": event_stats, "metrics": rows_out, "comparisons": comparisons,
        "runtime_s": round(time.time() - t0),
    }
    (EVALUATION_DIR / "results.json").write_text(json.dumps(summary, indent=2))

    # The served model is chosen on validation error (never on test results).
    active_fs = min(selection, key=lambda fs: selection[fs]["validation_mae"])
    registry = {"active": f"{active_fs}-hgb-{FEATURE_VERSION}", "active_selected_by": f"lowest validation MAE at h={SELECTION_HORIZON}",
                "generated_at": trained_at, "models": []}
    for fs in F.FEATURE_SETS:
        model_metrics = [r for r in rows_out if r["feature_set"] == fs and r["model"] == "hgb" and r["subset"] == "all"]
        meta = {
            "id": f"{fs}-hgb-{FEATURE_VERSION}", "feature_set": fs, "algorithm": "HistGradientBoostingRegressor (predicts occupancy change)",
            "training_dataset": DATASET_ID, "trained_at": trained_at, "feature_version": FEATURE_VERSION,
            "features": F.FEATURE_SETS[fs], "hyper_parameters": {**HGB_FIXED, **selection[fs]["params"]},
            "horizons_minutes": list(HORIZONS_MINUTES), "files": {str(h): f"{fs}/hgb_h{h}.joblib" for h in HORIZONS_MINUTES},
            "test_metrics": model_metrics, "config": config,
        }
        (ARTIFACTS_DIR / fs / "metadata.json").write_text(json.dumps(meta, indent=2))
        registry["models"].append(meta)
    (ARTIFACTS_DIR / "registry.json").write_text(json.dumps(registry, indent=2))
    print(f"done in {time.time() - t0:.0f}s")
    return summary


if __name__ == "__main__":
    main()

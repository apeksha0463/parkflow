"""Evaluation figures, drawn only from the saved evaluation outputs (results.csv, actual_vs_predicted_sample.csv).

Usage: python -m parkflow_ml.plots   (requires matplotlib from requirements-dev.txt)
"""
from __future__ import annotations

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

from .config import EVALUATION_DIR  # noqa: E402

INK, MUTED, GRID = "#1d2430", "#5f6b7c", "#e9edf2"
TEMPORAL, SPATIAL, PERSIST = "#2349d1", "#0f7c8c", "#8793a3"  # brand blue, teal, grey
SUBSET_TITLE = {"all": "All test samples", "post_neighbour_saturation": "After a neighbour's saturation event"}


def _style(ax):
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    ax.spines["left"].set_color(GRID)
    ax.spines["bottom"].set_color(GRID)
    ax.tick_params(colors=MUTED, labelsize=9)


def mae_by_horizon() -> None:
    r = pd.read_csv(EVALUATION_DIR / "results.csv")
    fig, axes = plt.subplots(1, 2, figsize=(10, 3.6), sharey=True)
    for ax, subset in zip(axes, SUBSET_TITLE):
        d = r[r["subset"] == subset]
        for (fs, model), color, label in [
            (("none", "persistence"), PERSIST, "Persistence"),
            (("temporal", "hgb"), TEMPORAL, "A: temporal-only"),
            (("spatial_temporal", "hgb"), SPATIAL, "B: spatial-temporal"),
        ]:
            s = d[(d["feature_set"] == fs) & (d["model"] == model)].sort_values("horizon_min")
            ax.plot(s["horizon_min"], s["mae"] * 100, marker="o", markersize=5, linewidth=2, color=color, label=label)
        ax.set_title(SUBSET_TITLE[subset], fontsize=10, color=INK, loc="left")
        ax.set_xlabel("Forecast horizon (min)", fontsize=9, color=MUTED)
        ax.set_xticks(sorted(d["horizon_min"].unique()))
        _style(ax)
    axes[0].set_ylabel("MAE (percentage points of occupancy)", fontsize=9, color=MUTED)
    axes[0].legend(frameon=False, fontsize=9)
    fig.tight_layout()
    fig.savefig(EVALUATION_DIR / "mae_by_horizon.png", dpi=150)
    plt.close(fig)


def actual_vs_predicted() -> None:
    s = pd.read_csv(EVALUATION_DIR / "actual_vs_predicted_sample.csv")
    fig, axes = plt.subplots(1, 2, figsize=(9, 4.2), sharex=True, sharey=True)
    for ax, col, color, title in [(axes[0], "temporal", TEMPORAL, "A: temporal-only"), (axes[1], "spatial_temporal", SPATIAL, "B: spatial-temporal")]:
        ax.scatter(s["actual"] * 100, s[col] * 100, s=4, alpha=0.25, color=color, linewidths=0)
        ax.plot([0, 100], [0, 100], color=MUTED, linewidth=1, linestyle="--")
        ax.set_title(f"{title} — 15 min, test sample (n={len(s):,})", fontsize=10, color=INK, loc="left")
        ax.set_xlabel("Actual occupancy (%)", fontsize=9, color=MUTED)
        _style(ax)
    axes[0].set_ylabel("Predicted occupancy (%)", fontsize=9, color=MUTED)
    fig.tight_layout()
    fig.savefig(EVALUATION_DIR / "actual_vs_predicted_15min.png", dpi=150)
    plt.close(fig)


def main() -> None:
    mae_by_horizon()
    actual_vs_predicted()
    print(f"figures written to {EVALUATION_DIR}")


if __name__ == "__main__":
    main()

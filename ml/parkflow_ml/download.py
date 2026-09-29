"""Downloads the raw research data into data/raw/melbourne (git-ignored).

Large files are fetched as parallel HTTP byte ranges and every range is resumable, so an interrupted
download continues where it stopped (rerun the command).

Usage: python -m parkflow_ml.download
"""
from __future__ import annotations

import shutil
import subprocess
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .config import BAYS_CSV_URL, RAW_DIR, SENSOR_ZIP_URL

SENSOR_ZIP = RAW_DIR / "on-street-car-parking-sensor-data-2019.zip"
BAYS_CSV = RAW_DIR / "on-street-parking-bays.csv"
HEADERS = {"User-Agent": "ParkFlow research pipeline"}
PARTS = 8


def _size(url: str) -> int | None:
    req = urllib.request.Request(url, method="HEAD", headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as res:
        if res.headers.get("Accept-Ranges") != "bytes":
            return None
        return int(res.headers["Content-Length"])


def _fetch_range(url: str, piece: Path, start: int, end: int) -> None:
    """Downloads bytes [start, end] into `piece`, resuming from its current length."""
    have = piece.stat().st_size if piece.exists() else 0
    curl = shutil.which("curl")
    while start + have <= end:
        try:
            if curl:  # much faster than urllib on some Windows setups
                with open(piece, "ab") as out:
                    subprocess.run([curl, "-sSfL", "--max-time", "1800", "-r", f"{start + have}-{end}", url], stdout=out, check=True)
            else:
                req = urllib.request.Request(url, headers={**HEADERS, "Range": f"bytes={start + have}-{end}"})
                with urllib.request.urlopen(req, timeout=60) as res, open(piece, "ab") as out:
                    shutil.copyfileobj(res, out, length=1 << 20)
        except (OSError, subprocess.CalledProcessError) as e:  # timeouts / resets: retry from the current length
            print(f"  retry {piece.name}: {e}")
        have = piece.stat().st_size if piece.exists() else 0


def _fetch(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        print(f"exists: {dest} ({dest.stat().st_size:,} bytes)")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    total = _size(url)
    print(f"downloading {url} ({total:,} bytes)" if total else f"downloading {url}")
    if total is None:
        req = urllib.request.Request(url, headers=HEADERS)
        tmp = dest.with_suffix(dest.suffix + ".part")
        with urllib.request.urlopen(req, timeout=120) as res, open(tmp, "wb") as out:
            shutil.copyfileobj(res, out, length=1 << 20)
        tmp.replace(dest)
    else:
        # Keep any sequential prefix from an earlier single-stream attempt as the first piece.
        legacy = dest.with_suffix(dest.suffix + ".part")
        head = legacy.stat().st_size if legacy.exists() else 0
        bounds = [head + (total - head) * i // PARTS for i in range(PARTS + 1)]
        pieces = [dest.with_suffix(dest.suffix + f".range{i}") for i in range(PARTS)]
        with ThreadPoolExecutor(PARTS) as pool:
            list(pool.map(lambda i: _fetch_range(url, pieces[i], bounds[i], bounds[i + 1] - 1), range(PARTS)))
        with open(dest.with_suffix(".tmp"), "wb") as out:
            for src in ([legacy] if head else []) + pieces:
                with open(src, "rb") as f:
                    shutil.copyfileobj(f, out, length=1 << 20)
        if dest.with_suffix(".tmp").stat().st_size != total:
            raise RuntimeError("size mismatch after download; rerun to resume")
        dest.with_suffix(".tmp").replace(dest)
        for src in ([legacy] if head else []) + pieces:
            src.unlink()
    print(f"saved: {dest} ({dest.stat().st_size:,} bytes)")


def main() -> None:
    _fetch(BAYS_CSV_URL, BAYS_CSV)
    _fetch(SENSOR_ZIP_URL, SENSOR_ZIP)


if __name__ == "__main__":
    main()

"""Split cached Peec MCP responses into per-date raw files.

Historical Peec data can only be fetched through the Peec MCP, which
requires a Claude session. A one-time Claude-triggered 30-day pull was
cached to ``data/raw/peec/_backfill_cache/*.json``. This script:

1. Reads the cached ``by_model``, ``own_by_topic``, ``own_by_tag`` JSON
   blobs.
2. Groups rows by date.
3. Projects each row from the Peec wire format (15 columns including
   raw sentiment_sum/count + position_sum/count) down to the 11-column
   schema the aggregator reads from ``data/raw/peec/<date>.json``.
4. Writes a new per-date raw file that references ``2026-04-22.json``
   as canonical for context + citations + actions (unchanged).

Idempotent: re-running overwrites. Use ``--overwrite`` to also replace
existing per-date files (default is to skip them).

Usage::

    python scripts/backfill_peec_30d.py
    python scripts/backfill_peec_30d.py --overwrite

After running, trigger the dashboard aggregator via Refresh →
Backfill 30 days to re-produce ``data/processed/daily/*.json`` with
the newly-available Peec data in their cross-channel joins.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

_ROOT = Path(__file__).resolve().parent.parent
_PEEC_DIR = _ROOT / "data" / "raw" / "peec"
_CACHE_DIR = _PEEC_DIR / "_backfill_cache"
_CANONICAL = "data/raw/peec/2026-04-22.json"

# The aggregator reads the columnar schema below — derived from the
# 15-column Peec wire format by dropping the raw sum/count fields that
# only the Peec API itself needs.
_BY_MODEL_OUT_COLS = [
    "brand_id", "brand_name", "visibility", "visibility_count",
    "visibility_total", "mention_count", "share_of_voice", "sentiment",
    "position", "date", "model_id",
]
_BY_TOPIC_OUT_COLS = [
    "topic_id", "visibility", "visibility_count", "visibility_total",
    "mention_count", "sentiment", "position",
]
_BY_TAG_OUT_COLS = [
    "tag_id", "visibility", "visibility_count", "visibility_total",
    "mention_count", "sentiment", "position",
]


def _load_cache(name: str) -> dict[str, Any]:
    path = _CACHE_DIR / f"{name}.json"
    if not path.exists():
        raise FileNotFoundError(
            f"Cache file {path} not found. Run the Claude-triggered Peec "
            f"MCP pull first and save the response to {path}."
        )
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _idx(columns: list[str], name: str) -> int:
    try:
        return columns.index(name)
    except ValueError as e:
        raise ValueError(f"Column {name!r} not in {columns}") from e


def _project_by_model(row: list[Any], cols: list[str]) -> list[Any]:
    """Wire row (15 cols) → output row (11 cols)."""
    return [
        row[_idx(cols, "brand_id")],
        row[_idx(cols, "brand_name")],
        row[_idx(cols, "visibility")],
        row[_idx(cols, "visibility_count")],
        row[_idx(cols, "visibility_total")],
        row[_idx(cols, "mention_count")],
        row[_idx(cols, "share_of_voice")],
        row[_idx(cols, "sentiment")],
        row[_idx(cols, "position")],
        row[_idx(cols, "date")],
        row[_idx(cols, "model_id")],
    ]


def _project_by_topic(row: list[Any], cols: list[str]) -> list[Any]:
    return [
        row[_idx(cols, "topic_id")],
        row[_idx(cols, "visibility")],
        row[_idx(cols, "visibility_count")],
        row[_idx(cols, "visibility_total")],
        row[_idx(cols, "mention_count")],
        row[_idx(cols, "sentiment")],
        row[_idx(cols, "position")],
    ]


def _project_by_tag(row: list[Any], cols: list[str]) -> list[Any]:
    return [
        row[_idx(cols, "tag_id")],
        row[_idx(cols, "visibility")],
        row[_idx(cols, "visibility_count")],
        row[_idx(cols, "visibility_total")],
        row[_idx(cols, "mention_count")],
        row[_idx(cols, "sentiment")],
        row[_idx(cols, "position")],
    ]


def _group_by_date(
    rows: Iterable[list[Any]], cols: list[str],
) -> dict[str, list[list[Any]]]:
    out: dict[str, list[list[Any]]] = defaultdict(list)
    date_idx = _idx(cols, "date")
    for r in rows:
        d = r[date_idx]
        if not d:
            continue
        out[d].append(r)
    return out


def _build_file(
    date: str,
    by_model_rows: list[list[Any]],
    by_topic_rows: list[list[Any]],
    by_tag_rows: list[list[Any]],
    source_cols: dict[str, list[str]],
) -> dict[str, Any]:
    anomaly_note = (
        "2026-04-14 is a Peec backfill/recrawl day — visibility_total ~353 "
        "vs ~50 typical. Interpret absolute mention_count with caution; "
        "visibility ratios remain comparable."
    ) if date == "2026-04-14" else None

    topic_rows_out = sorted(
        [_project_by_topic(r, source_cols["topic"]) for r in by_topic_rows],
        key=lambda r: (-(r[2] or 0), r[0] or ""),  # by visibility_count desc
    )
    tag_rows_out = sorted(
        [_project_by_tag(r, source_cols["tag"]) for r in by_tag_rows],
        key=lambda r: (-(r[2] or 0), r[0] or ""),
    )
    model_rows_out = sorted(
        [_project_by_model(r, source_cols["model"]) for r in by_model_rows],
        # Order: own brand first, then by visibility_count desc.
        key=lambda r: (
            0 if r[0] == "kw_REPLACE_WITH_YOUR_OWN_BRAND_ID" else 1,
            -(r[3] or 0),
        ),
    )

    data_quality_flags: list[dict[str, Any] | dict[str, str]] = [
        {"_reference": f"{_CANONICAL}#_data_quality_flags"},
    ]
    if anomaly_note:
        data_quality_flags.append({
            "flag": "peec_backfill_day_2026_04_14",
            "severity": "medium",
            "description": anomaly_note,
            "affects": ["brand_visibility.by_model_raw", "brand_visibility.own_by_topic", "brand_visibility.own_by_tag"],
        })

    return {
        "date": date,
        "fetched_at": datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
        "project_id": "or_REPLACE_WITH_YOUR_PROJECT_ID",
        "_canonical_file_reference": _CANONICAL,
        "_generated_by": "scripts/backfill_peec_30d.py (historical pull)",

        "context": {"_reference": f"{_CANONICAL}#context"},
        "coverage_integrity": {"_reference": f"{_CANONICAL}#coverage_integrity"},

        "brand_visibility": {
            "by_model_raw": {
                "columns": _BY_MODEL_OUT_COLS,
                "rows": model_rows_out,
            },
            "own_by_topic": {
                "columns": _BY_TOPIC_OUT_COLS,
                "rows": topic_rows_out,
            },
            "own_by_tag": {
                "columns": _BY_TAG_OUT_COLS,
                "rows": tag_rows_out,
            },
        },

        "citations": {"_reference": f"{_CANONICAL}#citations"},
        "actions_overview": {"_reference": f"{_CANONICAL}#actions_overview"},
        "_errors": [],
        "_data_quality_flags": data_quality_flags,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--overwrite", action="store_true",
                        help="Overwrite existing per-date files (default: skip them).")
    args = parser.parse_args(argv)

    try:
        by_model = _load_cache("by_model")
        by_topic = _load_cache("own_by_topic")
        by_tag = _load_cache("own_by_tag")
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    source_cols = {
        "model": by_model["columns"],
        "topic": by_topic["columns"],
        "tag": by_tag["columns"],
    }

    model_by_date = _group_by_date(by_model["rows"], source_cols["model"])
    topic_by_date = _group_by_date(by_topic["rows"], source_cols["topic"])
    tag_by_date = _group_by_date(by_tag["rows"], source_cols["tag"])

    all_dates = sorted(set(model_by_date) | set(topic_by_date) | set(tag_by_date))
    print(f"Backfill window: {all_dates[0]} → {all_dates[-1]} ({len(all_dates)} dates)")

    written = 0
    skipped = 0
    for date in all_dates:
        out_path = _PEEC_DIR / f"{date}.json"
        if out_path.exists() and not args.overwrite:
            print(f"  [{date}] skip (exists; use --overwrite to replace)")
            skipped += 1
            continue

        payload = _build_file(
            date=date,
            by_model_rows=model_by_date.get(date, []),
            by_topic_rows=topic_by_date.get(date, []),
            by_tag_rows=tag_by_date.get(date, []),
            source_cols=source_cols,
        )
        tmp = out_path.with_suffix(".json.tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        tmp.replace(out_path)
        print(f"  [{date}] wrote {out_path.relative_to(_ROOT)} "
              f"(model={len(model_by_date.get(date, []))}, "
              f"topic={len(topic_by_date.get(date, []))}, "
              f"tag={len(tag_by_date.get(date, []))})")
        written += 1

    print(f"\nDone. {written} file(s) written, {skipped} skipped.")
    print("Next step: click Refresh → Backfill 30 days in the dashboard so "
          "aggregate_daily.py re-runs for each date and picks up the new "
          "Peec data in the cross-channel joins.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

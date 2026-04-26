"""Pull Google Search Console performance data + URL inspection.

Writes one JSON file per date in ``data/raw/gsc/<date>.json`` with:

  * ``site_totals`` — dashboard-matching totals (clicks, impressions,
                      ctr, position) from a 0-dimension query. These
                      bypass GSC's privacy filter and MUST be used for
                      day totals; summing the 4-D ``queries`` array
                      below dramatically under-counts.
  * ``queries``   — per (query, page, country, device) row (top queries view)
  * ``pages``     — per (page, country, device) row (top pages view)
  * ``indexing``  — per-URL inspection status for the top 50 pages
                    by impressions across the window

Usage::

    python scripts/pull_gsc.py --date 2026-04-20
    python scripts/pull_gsc.py --date 2026-04-20 --lookback-days 3

The ``--lookback-days`` window is only used for picking the top 50
pages to URL-inspect (you want volume of impressions, not just
yesterday's thin data). Each day in the window still gets its own
``<date>.json`` — we don't silently back-fill.

Env (from ``.env``):
  * ``GSC_SERVICE_ACCOUNT_JSON_B64`` — base64 of the SA JSON
  * ``GSC_SITE_URL``                 — e.g. ``sc-domain:acme.io``
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional

from dotenv import load_dotenv

# Add repo root to sys.path so this script can `from scripts.utils ...`
# when invoked as ``python scripts/pull_gsc.py`` from the project root.
_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from scripts.utils import get_logger, normalize_url, parse_date, yesterday  # noqa: E402

log = get_logger(__name__)


# ---------------------------------------------------------------------
# Config / auth
# ---------------------------------------------------------------------

GSC_SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]
_RAW_DIR = _ROOT / "data" / "raw" / "gsc"


@dataclass(frozen=True)
class GscConfig:
    site_url: str
    sa_json: dict[str, Any]

    @classmethod
    def from_env(cls) -> "GscConfig":
        site_url = os.environ.get("GSC_SITE_URL", "").strip()
        if not site_url:
            raise RuntimeError(
                "GSC_SITE_URL is not set. See docs/google-credentials-setup.md"
            )
        sa_json = _load_sa_json_from_env()
        return cls(site_url=site_url, sa_json=sa_json)


def _load_sa_json_from_env() -> dict[str, Any]:
    """Load the service-account JSON from either a file path
    (``GSC_SERVICE_ACCOUNT_JSON_PATH``) or a base64 blob
    (``GSC_SERVICE_ACCOUNT_JSON_B64``). Path wins if both are set.

    Shared by pull_gsc.py and pull_ga4.py — same SA credentials.
    """
    path = os.environ.get("GSC_SERVICE_ACCOUNT_JSON_PATH", "").strip()
    if path:
        expanded = os.path.expanduser(path)
        if not os.path.isfile(expanded):
            raise RuntimeError(
                f"GSC_SERVICE_ACCOUNT_JSON_PATH points to {expanded!r} "
                "but no file is there. Check the path in .env."
            )
        try:
            with open(expanded, "r", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            raise RuntimeError(
                f"Could not read/parse service-account JSON at {expanded!r}: {e}"
            ) from e

    b64 = os.environ.get("GSC_SERVICE_ACCOUNT_JSON_B64", "").strip()
    if not b64:
        raise RuntimeError(
            "Neither GSC_SERVICE_ACCOUNT_JSON_PATH nor GSC_SERVICE_ACCOUNT_JSON_B64 "
            "is set. See docs/google-credentials-setup.md §3."
        )
    # Strip any embedded whitespace (newlines, tabs, spaces) that might
    # have snuck in from a wrapped base64 paste.
    cleaned = "".join(b64.split())
    try:
        return json.loads(base64.b64decode(cleaned))
    except (ValueError, json.JSONDecodeError) as e:
        raise RuntimeError(
            "GSC_SERVICE_ACCOUNT_JSON_B64 is not valid base64(JSON). "
            "Most common cause: pasted across multiple lines in .env "
            "(python-dotenv only reads the first line). Re-encode with "
            "`base64 -i sa.json | tr -d '\\n'`. "
            "Alternatively, set GSC_SERVICE_ACCOUNT_JSON_PATH=/path/to/sa.json "
            "to skip base64 entirely. "
            f"Original error: {e}"
        ) from e


def _build_service(config: GscConfig):  # type: ignore[no-untyped-def]
    """Build an authed Search Console service client. Lazy-import so
    smoke tests don't need googleapiclient installed for unit tests
    that never call this function."""
    from google.oauth2 import service_account  # type: ignore[import-untyped]
    from googleapiclient.discovery import build  # type: ignore[import-untyped]

    creds = service_account.Credentials.from_service_account_info(
        config.sa_json, scopes=GSC_SCOPES
    )
    return build("searchconsole", "v1", credentials=creds, cache_discovery=False)


# ---------------------------------------------------------------------
# Response normalization
# ---------------------------------------------------------------------

def _rows_to_dicts(
    rows: Iterable[dict[str, Any]],
    dimensions: list[str],
) -> list[dict[str, Any]]:
    """Turn GSC searchanalytics rows into a stable list of dicts.

    GSC returns ``{"keys": ["...", "..."], "clicks": N, ...}`` where
    the order of ``keys`` matches the ``dimensions`` request. Map back
    to named fields and normalize URLs on the ``page`` dimension.
    """
    out: list[dict[str, Any]] = []
    for row in rows or []:
        keys = row.get("keys", []) or []
        record: dict[str, Any] = {}
        for dim, val in zip(dimensions, keys):
            if dim == "page":
                record[dim] = normalize_url(val)
            else:
                record[dim] = val
        record["clicks"] = int(row.get("clicks", 0) or 0)
        record["impressions"] = int(row.get("impressions", 0) or 0)
        record["ctr"] = float(row.get("ctr", 0.0) or 0.0)
        record["position"] = float(row.get("position", 0.0) or 0.0)
        out.append(record)
    return out


# ---------------------------------------------------------------------
# GSC API calls
# ---------------------------------------------------------------------

def _searchanalytics(
    service: Any,
    site_url: str,
    date_: str,
    dimensions: list[str],
    row_limit: int = 25000,
) -> list[dict[str, Any]]:
    """Paginate ``searchanalytics.query`` until the API stops returning rows.

    The API caps ``rowLimit`` at 25k per request; use ``startRow`` to
    paginate beyond that. We stop as soon as a page returns fewer rows
    than ``row_limit``.
    """
    all_rows: list[dict[str, Any]] = []
    start_row = 0
    while True:
        body = {
            "startDate": date_,
            "endDate": date_,
            "dimensions": dimensions,
            "rowLimit": row_limit,
            "startRow": start_row,
            "dataState": "final",  # exclude still-fresh data
        }
        resp = (
            service.searchanalytics()
            .query(siteUrl=site_url, body=body)
            .execute()
        )
        rows = resp.get("rows", []) or []
        if not rows:
            break
        all_rows.extend(_rows_to_dicts(rows, dimensions))
        if len(rows) < row_limit:
            break
        start_row += row_limit
    return all_rows


def _pull_site_totals(
    service: Any, site_url: str, date_: str
) -> dict[str, Any]:
    """Fetch the **unaggregated** dashboard-matching totals for one day.

    The per-query pull uses ``dimensions=["query", "page", "country",
    "device"]``, and GSC aggressively anonymizes low-volume rows
    across that 4-D grid — often dropping 60-80% of total impressions
    to privacy filtering. Summing those rows produces a number far
    below what GSC's own Performance dashboard shows.

    Calling the same ``searchanalytics.query`` endpoint with NO
    dimensions returns the single "dashboard total" row for the
    date — the same number the GSC UI displays under "Total clicks"
    and "Total impressions". Use THIS for `summary.seo.total_*` in
    the daily aggregate; use the 4-D `queries` list only for
    top-query text + per-query breakdown (where the privacy dropout
    doesn't matter because we only care about the top N).

    Returns an empty dict if GSC returns no rows (edge: zero impressions
    for a sparse day, or stale `dataState=final` on today's date).
    """
    body = {
        "startDate": date_,
        "endDate": date_,
        "dimensions": [],
        "rowLimit": 1,
        "dataState": "final",
    }
    resp = (
        service.searchanalytics()
        .query(siteUrl=site_url, body=body)
        .execute()
    )
    rows = resp.get("rows", []) or []
    if not rows:
        return {}
    r = rows[0]
    return {
        "clicks": int(r.get("clicks", 0) or 0),
        "impressions": int(r.get("impressions", 0) or 0),
        "ctr": float(r.get("ctr", 0.0) or 0.0),
        "position": float(r.get("position", 0.0) or 0.0),
    }


def _top_pages_by_impressions(
    service: Any, site_url: str, start: str, end: str, limit: int = 50
) -> list[str]:
    """Return up to ``limit`` page URLs with the highest impression
    volume across the given inclusive date range."""
    body = {
        "startDate": start,
        "endDate": end,
        "dimensions": ["page"],
        "rowLimit": limit,
        "dataState": "final",
    }
    resp = (
        service.searchanalytics()
        .query(siteUrl=site_url, body=body)
        .execute()
    )
    return [
        normalize_url((r.get("keys") or [""])[0])
        for r in resp.get("rows", []) or []
    ]


def _inspect_url(service: Any, site_url: str, url: str) -> dict[str, Any]:
    """Run URL Inspection for one URL. Returns a flat, serializable
    dict; tolerates a missing ``indexStatusResult`` block (happens on
    URLs Google has never crawled).
    """
    try:
        resp = (
            service.urlInspection()
            .index()
            .inspect(body={"inspectionUrl": url, "siteUrl": site_url})
            .execute()
        )
    except Exception as e:  # noqa: BLE001 — we log and continue per-URL
        log.warning(
            "url inspection failed", extra={"url": url, "error": str(e)}
        )
        return {
            "url": url,
            "status": "inspection_failed",
            "last_crawled": None,
            "reason": str(e),
        }
    result = (resp or {}).get("inspectionResult", {}) or {}
    index_status = result.get("indexStatusResult", {}) or {}
    return {
        "url": url,
        "status": index_status.get("verdict"),
        "coverage_state": index_status.get("coverageState"),
        "indexing_state": index_status.get("indexingState"),
        "robots_txt_state": index_status.get("robotsTxtState"),
        "last_crawled": index_status.get("lastCrawlTime"),
        "page_fetch_state": index_status.get("pageFetchState"),
        "referring_urls": index_status.get("referringUrls"),
        "reason": None,
    }


# ---------------------------------------------------------------------
# Per-date pull
# ---------------------------------------------------------------------

def pull_gsc_for_date(
    service: Any,
    site_url: str,
    date_iso: str,
    inspect_urls: Optional[list[str]] = None,
    inspection_sleep: float = 0.05,
) -> dict[str, Any]:
    """Pull GSC performance + indexing data for a single calendar day.

    ``inspect_urls`` should be the list of top-N URLs by impressions
    across the full lookback window (so we always inspect the same
    set across days in the window, rather than per-day jitter).
    """
    # Dashboard-matching totals (0 dimensions — no privacy dropout).
    # These are the numbers that should match the GSC Performance UI;
    # the aggregator uses them for `summary.seo.total_*`.
    log.info("fetching GSC site totals", extra={"date": date_iso})
    site_totals = _pull_site_totals(service, site_url, date_iso)
    log.info(
        "fetched GSC site totals",
        extra={
            "date": date_iso,
            "clicks": site_totals.get("clicks"),
            "impressions": site_totals.get("impressions"),
        },
    )

    log.info("fetching GSC queries", extra={"date": date_iso})
    queries = _searchanalytics(
        service,
        site_url,
        date_iso,
        dimensions=["query", "page", "country", "device"],
    )
    log.info(
        "fetched GSC queries",
        extra={"date": date_iso, "rows": len(queries)},
    )

    log.info("fetching GSC pages", extra={"date": date_iso})
    pages = _searchanalytics(
        service,
        site_url,
        date_iso,
        dimensions=["page", "country", "device"],
    )
    log.info(
        "fetched GSC pages",
        extra={"date": date_iso, "rows": len(pages)},
    )

    indexing: list[dict[str, Any]] = []
    if inspect_urls:
        log.info(
            "inspecting URLs",
            extra={"date": date_iso, "count": len(inspect_urls)},
        )
        for url in inspect_urls:
            indexing.append(_inspect_url(service, site_url, url))
            if inspection_sleep:
                time.sleep(inspection_sleep)

    return {
        "date": date_iso,
        "fetched_at": _now_iso(),
        "site_url": site_url,
        "site_totals": site_totals,
        "queries": queries,
        "pages": pages,
        "indexing": indexing,
    }


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(tz=timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------------
# Disk IO
# ---------------------------------------------------------------------

def write_output(date_iso: str, payload: dict[str, Any]) -> Path:
    """Idempotent write to ``data/raw/gsc/<date>.json``."""
    _RAW_DIR.mkdir(parents=True, exist_ok=True)
    out = _RAW_DIR / f"{date_iso}.json"
    tmp = out.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, sort_keys=False)
    tmp.replace(out)  # atomic rename — either full-new or full-old
    return out


# ---------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=(
            "Pull GSC performance + indexing data into data/raw/gsc/<date>.json"
        )
    )
    p.add_argument(
        "--date",
        help=(
            "Target date YYYY-MM-DD (default: yesterday). Pulls are "
            "per-day; if --lookback-days > 1 each day in the window "
            "gets its own file."
        ),
    )
    p.add_argument(
        "--lookback-days",
        type=int,
        default=1,
        help=(
            "Number of days to pull (ending at --date, inclusive). The "
            "top-50 URL-inspection set is chosen across the full window "
            "so results don't jitter day-to-day. Default: 1."
        ),
    )
    p.add_argument(
        "--no-inspection",
        action="store_true",
        help="Skip URL inspection (faster; useful for backfills).",
    )
    return p


def main(argv: Optional[list[str]] = None) -> int:
    load_dotenv()
    args = build_parser().parse_args(argv)

    end_date = parse_date(args.date) if args.date else yesterday()
    if args.lookback_days < 1:
        log.error(
            "lookback-days must be >= 1", extra={"value": args.lookback_days}
        )
        return 2

    try:
        config = GscConfig.from_env()
    except RuntimeError as e:
        log.error("config error", extra={"error": str(e)})
        return 3

    service = _build_service(config)

    # Date list oldest → newest
    from datetime import timedelta

    dates = [
        (end_date - timedelta(days=i)).isoformat()
        for i in range(args.lookback_days - 1, -1, -1)
    ]

    # Pick top-50 URLs across the whole window — once — so inspection
    # rows are comparable across days.
    inspect_urls: list[str] = []
    if not args.no_inspection:
        try:
            inspect_urls = _top_pages_by_impressions(
                service,
                config.site_url,
                start=dates[0],
                end=dates[-1],
                limit=50,
            )
        except Exception as e:  # noqa: BLE001
            log.warning(
                "failed to fetch top-pages for inspection; skipping inspection",
                extra={"error": str(e)},
            )
            inspect_urls = []

    exit_code = 0
    for d in dates:
        try:
            payload = pull_gsc_for_date(
                service, config.site_url, d, inspect_urls=inspect_urls
            )
            out = write_output(d, payload)
            log.info(
                "wrote GSC payload",
                extra={
                    "date": d,
                    "path": str(out),
                    "queries": len(payload["queries"]),
                    "pages": len(payload["pages"]),
                    "indexing": len(payload["indexing"]),
                },
            )
        except Exception as e:  # noqa: BLE001
            log.error(
                "failed to pull GSC for date",
                extra={"date": d, "error": str(e)},
            )
            exit_code = 1
    return exit_code


if __name__ == "__main__":
    sys.exit(main())

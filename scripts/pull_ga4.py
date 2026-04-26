"""Pull GA4 data into ``data/raw/ga4/<date>.json``.

Six report slices per day, each a separate API call so one failure
doesn't poison the others:

  * ``acquisition`` — sessions / users / engagement per
    source / medium / campaign / sessionDefaultChannelGroup
  * ``pages``       — views / users / avg engagement time per pagePath
  * ``events``      — count / users per eventName (flagged by
    ``is_conversion`` when the event key matches a GA4 "key event")
  * ``conversions`` — key-event counts per source / medium
  * ``referrers``   — sessions / users per pageReferrer (1-D summary,
                      feeds the LLM-provider totals on the overview)
  * ``referrers_by_page`` — 2-D (landingPage × sessionSource). Feeds
                      ``by_landing_page`` in the LLM-traffic parser so
                      the cross-channel Top Pages table can attribute
                      LLM-referred sessions to specific URLs.

Usage::

    python scripts/pull_ga4.py --date 2026-04-20
    python scripts/pull_ga4.py --date 2026-04-20 --lookback-days 3

Env (from ``.env``):
  * ``GSC_SERVICE_ACCOUNT_JSON_B64`` — reused (same service account as GSC)
  * ``GA4_PROPERTY_ID``              — numeric Property ID (NOT G-XXXXX)
  * ``SITE_CANONICAL_ORIGIN``        — optional; used to turn GA4's bare
                                       pagePaths into full URLs so they
                                       line up with GSC's page dimension
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from scripts.utils import get_logger, normalize_url, parse_date, yesterday  # noqa: E402

log = get_logger(__name__)


# ---------------------------------------------------------------------
# Config / auth
# ---------------------------------------------------------------------

GA4_SCOPES = ["https://www.googleapis.com/auth/analytics.readonly"]
_RAW_DIR = _ROOT / "data" / "raw" / "ga4"


@dataclass(frozen=True)
class Ga4Config:
    property_id: str
    canonical_origin: Optional[str]
    sa_json: dict[str, Any]

    @classmethod
    def from_env(cls) -> "Ga4Config":
        prop = os.environ.get("GA4_PROPERTY_ID", "").strip()
        if not prop:
            raise RuntimeError(
                "GA4_PROPERTY_ID is not set. In GA4 go to Admin → "
                "Property Settings and copy the numeric Property ID "
                "(NOT the G-XXXXX Measurement ID)."
            )
        if not prop.isdigit():
            raise RuntimeError(
                f"GA4_PROPERTY_ID must be numeric, got {prop!r}. "
                "Don't use the G-XXXXX Measurement ID."
            )
        # Reuse the SA loader from pull_gsc so we support both PATH and
        # B64 inputs without duplicating logic.
        from scripts.pull_gsc import _load_sa_json_from_env
        sa_json = _load_sa_json_from_env()

        origin = os.environ.get("SITE_CANONICAL_ORIGIN", "").strip() or None
        return cls(
            property_id=prop, canonical_origin=origin, sa_json=sa_json
        )


def _build_client(config: Ga4Config):  # type: ignore[no-untyped-def]
    """Build an authed Analytics Data API client. Lazy-imported."""
    from google.analytics.data_v1beta import BetaAnalyticsDataClient  # type: ignore[import-untyped]
    from google.oauth2 import service_account  # type: ignore[import-untyped]

    creds = service_account.Credentials.from_service_account_info(
        config.sa_json, scopes=GA4_SCOPES
    )
    return BetaAnalyticsDataClient(credentials=creds)


# ---------------------------------------------------------------------
# Report helpers
# ---------------------------------------------------------------------

def _run_report(
    client: Any,
    property_id: str,
    dimensions: list[str],
    metrics: list[str],
    start: str,
    end: str,
    order_by_metric: Optional[str] = None,
    limit: int = 10000,
) -> list[dict[str, Any]]:
    """Run a single ``runReport`` and return a list of dicts keyed by
    dimension/metric name.

    GA4 reports return columnar data (a list of `dimensionValues` +
    `metricValues` per row, with header arrays describing the column
    order). We flatten that into dicts so downstream code doesn't have
    to re-read headers.
    """
    from google.analytics.data_v1beta.types import (  # type: ignore[import-untyped]
        DateRange,
        Dimension,
        Metric,
        OrderBy,
        RunReportRequest,
    )

    request_kwargs: dict[str, Any] = {
        "property": f"properties/{property_id}",
        "dimensions": [Dimension(name=d) for d in dimensions],
        "metrics": [Metric(name=m) for m in metrics],
        "date_ranges": [DateRange(start_date=start, end_date=end)],
        "limit": limit,
    }
    if order_by_metric:
        request_kwargs["order_bys"] = [
            OrderBy(
                metric=OrderBy.MetricOrderBy(metric_name=order_by_metric),
                desc=True,
            )
        ]

    request = RunReportRequest(**request_kwargs)
    response = client.run_report(request=request)

    rows: list[dict[str, Any]] = []
    for row in response.rows:
        record: dict[str, Any] = {}
        for dim_header, dim_value in zip(response.dimension_headers, row.dimension_values):
            record[dim_header.name] = dim_value.value
        for metric_header, metric_value in zip(response.metric_headers, row.metric_values):
            raw = metric_value.value
            # All GA4 metrics come back as strings; cast to the right type.
            if raw == "" or raw is None:
                record[metric_header.name] = 0
            else:
                try:
                    if "." in raw:
                        record[metric_header.name] = float(raw)
                    else:
                        record[metric_header.name] = int(raw)
                except ValueError:
                    record[metric_header.name] = raw
        rows.append(record)
    return rows


# ---------------------------------------------------------------------
# Per-slice pulls
# ---------------------------------------------------------------------

def _pull_acquisition(client: Any, property_id: str, d: str) -> list[dict[str, Any]]:
    return _run_report(
        client,
        property_id,
        dimensions=[
            "sessionSource",
            "sessionMedium",
            "sessionCampaignName",
            "sessionDefaultChannelGroup",
        ],
        metrics=[
            "sessions",
            "totalUsers",
            "newUsers",
            "engagedSessions",
            "averageSessionDuration",
            "bounceRate",
        ],
        start=d,
        end=d,
        order_by_metric="sessions",
    )


def _pull_pages(
    client: Any,
    property_id: str,
    d: str,
    canonical_origin: Optional[str],
) -> list[dict[str, Any]]:
    rows = _run_report(
        client,
        property_id,
        dimensions=["pagePath"],
        metrics=[
            "screenPageViews",
            "totalUsers",
            "userEngagementDuration",
            "eventCount",
        ],
        start=d,
        end=d,
        order_by_metric="screenPageViews",
    )
    # Normalize page paths to full URLs when the canonical origin is
    # known; otherwise pass through (aggregate_daily.py will still
    # attempt the join but coverage drops).
    for r in rows:
        path = r.get("pagePath", "") or ""
        r["pagePath"] = path
        r["url"] = normalize_url(path, canonical_origin=canonical_origin)
    return rows


def _pull_events(client: Any, property_id: str, d: str) -> list[dict[str, Any]]:
    rows = _run_report(
        client,
        property_id,
        dimensions=["eventName", "isKeyEvent"],
        metrics=["eventCount", "totalUsers"],
        start=d,
        end=d,
        order_by_metric="eventCount",
    )
    # GA4 returns isKeyEvent as a stringy bool ("true"/"false"); coerce.
    for r in rows:
        raw = str(r.pop("isKeyEvent", "")).lower()
        r["is_conversion"] = raw == "true"
    return rows


def _pull_conversions(
    client: Any, property_id: str, d: str
) -> list[dict[str, Any]]:
    """GA4 doesn't have a single "conversions" metric anymore —
    conversions = events flagged as key events. We filter the events
    report by ``isKeyEvent=true`` and include source/medium so we can
    attribute.
    """
    rows = _run_report(
        client,
        property_id,
        dimensions=[
            "eventName",
            "isKeyEvent",
            "sessionSource",
            "sessionMedium",
        ],
        metrics=["eventCount", "totalUsers"],
        start=d,
        end=d,
        order_by_metric="eventCount",
    )
    out: list[dict[str, Any]] = []
    for r in rows:
        if str(r.pop("isKeyEvent", "")).lower() != "true":
            continue
        out.append(r)
    return out


def _pull_referrers(client: Any, property_id: str, d: str) -> list[dict[str, Any]]:
    return _run_report(
        client,
        property_id,
        dimensions=["pageReferrer"],
        metrics=["sessions", "totalUsers"],
        start=d,
        end=d,
        order_by_metric="sessions",
    )


def _pull_referrers_by_page(
    client: Any,
    property_id: str,
    d: str,
    canonical_origin: Optional[str],
) -> list[dict[str, Any]]:
    """Pull the 2-D (landingPage × sessionSource) cross.

    Why both dimensions are session-scoped: combining an event-scoped
    dim like ``pageReferrer`` with session-scoped ``sessions`` inflates
    counts when a session has multiple pageviews with different
    referrers (e.g. self-referrer on internal navigation). Using
    ``landingPage`` + ``sessionSource`` aggregates at session grain —
    each session counted once, at its landing URL, under its source.

    ``sessionSource`` values for external traffic look like
    ``chatgpt.com`` / ``copilot.microsoft.com`` / ``perplexity.ai``
    etc. — bare hostnames that match the LLM list's ``domain`` field
    without further extraction. For direct/unknown traffic GA4 emits
    ``(direct)`` / ``(not set)`` which the parser drops.

    Raw pagePaths are normalized to full URLs with the same logic as
    ``_pull_pages`` so the downstream join with GSC/Peec URLs lines up.
    """
    rows = _run_report(
        client,
        property_id,
        dimensions=["landingPage", "sessionSource"],
        metrics=["sessions", "totalUsers"],
        start=d,
        end=d,
        order_by_metric="sessions",
    )
    for r in rows:
        path = r.get("landingPage", "") or ""
        r["landingPage"] = path
        r["url"] = normalize_url(path, canonical_origin=canonical_origin)
    return rows


# ---------------------------------------------------------------------
# Per-date pull
# ---------------------------------------------------------------------

def pull_ga4_for_date(
    client: Any, config: Ga4Config, date_iso: str
) -> dict[str, Any]:
    """Run all five slices for one date. Slice failures are isolated —
    we keep going and report gaps in ``_errors``.
    """
    errors: dict[str, str] = {}

    def _safe(slice_name: str, fn: Any) -> Any:
        try:
            return fn()
        except Exception as e:  # noqa: BLE001
            log.warning(
                "GA4 slice failed",
                extra={"slice": slice_name, "date": date_iso, "error": str(e)},
            )
            errors[slice_name] = str(e)
            return []

    acquisition = _safe("acquisition", lambda: _pull_acquisition(client, config.property_id, date_iso))
    pages = _safe("pages", lambda: _pull_pages(client, config.property_id, date_iso, config.canonical_origin))
    events = _safe("events", lambda: _pull_events(client, config.property_id, date_iso))
    conversions = _safe("conversions", lambda: _pull_conversions(client, config.property_id, date_iso))
    referrers = _safe("referrers", lambda: _pull_referrers(client, config.property_id, date_iso))
    referrers_by_page = _safe(
        "referrers_by_page",
        lambda: _pull_referrers_by_page(
            client, config.property_id, date_iso, config.canonical_origin
        ),
    )

    return {
        "date": date_iso,
        "fetched_at": datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
        "property_id": config.property_id,
        "acquisition": acquisition,
        "pages": pages,
        "events": events,
        "conversions": conversions,
        "referrers": referrers,
        "referrers_by_page": referrers_by_page,
        "_errors": errors,
    }


# ---------------------------------------------------------------------
# Disk IO
# ---------------------------------------------------------------------

def write_output(date_iso: str, payload: dict[str, Any]) -> Path:
    _RAW_DIR.mkdir(parents=True, exist_ok=True)
    out = _RAW_DIR / f"{date_iso}.json"
    tmp = out.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, sort_keys=False)
    tmp.replace(out)
    return out


# ---------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Pull GA4 data into data/raw/ga4/<date>.json"
    )
    p.add_argument(
        "--date",
        help="Target date YYYY-MM-DD (default: yesterday).",
    )
    p.add_argument(
        "--lookback-days",
        type=int,
        default=1,
        help=(
            "Number of days to pull (ending at --date, inclusive). Each "
            "day gets its own file. Default: 1."
        ),
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
        config = Ga4Config.from_env()
    except RuntimeError as e:
        log.error("config error", extra={"error": str(e)})
        return 3

    client = _build_client(config)

    dates = [
        (end_date - timedelta(days=i)).isoformat()
        for i in range(args.lookback_days - 1, -1, -1)
    ]

    exit_code = 0
    for d in dates:
        try:
            payload = pull_ga4_for_date(client, config, d)
            out = write_output(d, payload)
            log.info(
                "wrote GA4 payload",
                extra={
                    "date": d,
                    "path": str(out),
                    "acquisition": len(payload["acquisition"]),
                    "pages": len(payload["pages"]),
                    "events": len(payload["events"]),
                    "conversions": len(payload["conversions"]),
                    "referrers": len(payload["referrers"]),
                    "errors": list(payload["_errors"].keys()),
                },
            )
        except Exception as e:  # noqa: BLE001
            log.error(
                "failed to pull GA4 for date",
                extra={"date": d, "error": str(e)},
            )
            exit_code = 1
    return exit_code


if __name__ == "__main__":
    sys.exit(main())

"""Roll seven daily aggregates into ``data/processed/weekly/<YYYY-Www>.json``.

Produces:
  * trend arrays per metric (7 daily values)
  * winners / losers — top 5 moving queries, pages, topics
  * anomalies — days where a metric is >2σ from the 28-day baseline
  * cross-channel correlation — for each tracked topic, the week's
    SEO × GEO × LLM numbers side-by-side
  * opportunity-gap candidates (rank-without-citation, citation-without-rank,
    LLM-traffic-without-conversion) — the four quadrants the skill looks for

If any day in the week is missing its processed daily file but the raw
sources for that day exist, we build it on the fly via
``aggregate_daily.aggregate``. This keeps weekly runs self-healing.

CLI::

    python scripts/aggregate_weekly.py --week 2026-W17
    python scripts/aggregate_weekly.py        # defaults to previous full ISO week
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from scripts.utils import (  # noqa: E402
    get_logger,
    previous_full_iso_week,
    week_date_range,
)
from scripts import aggregate_daily  # noqa: E402

log = get_logger(__name__)

_DAILY_DIR = _ROOT / "data" / "processed" / "daily"
_OUT_DIR = _ROOT / "data" / "processed" / "weekly"


# ---------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------

def _load_or_build_daily(date_iso: str) -> Optional[dict[str, Any]]:
    """Prefer the processed daily file; if missing, build it on the fly
    from the raw sources. Returns None only if no raw data exists either.
    """
    path = _DAILY_DIR / f"{date_iso}.json"
    if path.exists():
        try:
            with path.open("r", encoding="utf-8") as f:
                return json.load(f)
        except json.JSONDecodeError:
            log.warning("corrupt daily file; rebuilding", extra={"path": str(path)})

    # Fallback: build from raw.
    built = aggregate_daily.aggregate(date_iso)
    if not built.get("sources_included"):
        return None
    return built


# ---------------------------------------------------------------------
# Trend extraction + anomalies
# ---------------------------------------------------------------------

_METRIC_PATHS: list[tuple[str, tuple[str, ...]]] = [
    ("seo.total_clicks",           ("summary", "seo", "total_clicks")),
    ("seo.total_impressions",      ("summary", "seo", "total_impressions")),
    ("seo.avg_position",           ("summary", "seo", "avg_position")),
    ("traffic.sessions",           ("summary", "traffic", "sessions")),
    ("traffic.users",              ("summary", "traffic", "users")),
    ("traffic.conversions",        ("summary", "traffic", "conversions")),
    ("llm_traffic.sessions",       ("summary", "llm_traffic", "sessions")),
    ("geo.avg_visibility",         ("summary", "geo", "avg_visibility")),
    ("geo.avg_share_of_voice",     ("summary", "geo", "avg_share_of_voice")),
    ("geo.total_mentions",         ("summary", "geo", "total_mentions")),
    ("scores.seo_score",           ("scores", "seo_score")),
    ("scores.geo_score",           ("scores", "geo_score")),
]


def _get_path(obj: Any, path: tuple[str, ...]) -> Any:
    cur = obj
    for p in path:
        if not isinstance(cur, dict) or p not in cur:
            return None
        cur = cur[p]
    return cur


def build_trends(daily_payloads: list[dict[str, Any]]) -> dict[str, list[Optional[float]]]:
    """Return {metric: [value_per_day_in_order]}. None for missing days."""
    trends: dict[str, list[Optional[float]]] = {name: [] for name, _ in _METRIC_PATHS}
    for payload in daily_payloads:
        for name, path in _METRIC_PATHS:
            v = _get_path(payload, path)
            trends[name].append(float(v) if isinstance(v, (int, float)) else None)
    return trends


def detect_anomalies(
    weekly_payloads: list[dict[str, Any]],
    week_dates: list[str],
    baseline_days: int = 28,
    sigma_threshold: float = 2.0,
) -> list[dict[str, Any]]:
    """For each metric, compare each day in the target week to the mean
    + stdev of the prior `baseline_days`. Flag days that are >2σ away.
    """
    # Collect baseline values from processed daily files (not the week itself).
    if not week_dates:
        return []
    first_day = datetime.fromisoformat(week_dates[0]).date()

    baseline_payloads: list[dict[str, Any]] = []
    for i in range(1, baseline_days + 1):
        d = (first_day - timedelta(days=i)).isoformat()
        path = _DAILY_DIR / f"{d}.json"
        if not path.exists():
            continue
        try:
            with path.open("r", encoding="utf-8") as f:
                baseline_payloads.append(json.load(f))
        except json.JSONDecodeError:
            continue
    if len(baseline_payloads) < 5:
        # Not enough baseline to compute meaningful sigma.
        return []

    anomalies: list[dict[str, Any]] = []
    for name, path in _METRIC_PATHS:
        base_values = [
            _get_path(p, path) for p in baseline_payloads
            if isinstance(_get_path(p, path), (int, float))
        ]
        base_values = [float(v) for v in base_values]  # type: ignore[arg-type]
        if len(base_values) < 5:
            continue
        mu = statistics.mean(base_values)
        sigma = statistics.pstdev(base_values)
        if sigma == 0:
            continue
        for day_payload, day_iso in zip(weekly_payloads, week_dates):
            v = _get_path(day_payload, path)
            if not isinstance(v, (int, float)):
                continue
            deviation = (float(v) - mu) / sigma
            if abs(deviation) >= sigma_threshold:
                anomalies.append({
                    "date": day_iso,
                    "metric": name,
                    "value": float(v),
                    "baseline_mean": round(mu, 2),
                    "baseline_sigma": round(sigma, 2),
                    "sigma_deviation": round(deviation, 2),
                    "direction": "up" if deviation > 0 else "down",
                })
    anomalies.sort(key=lambda a: abs(a["sigma_deviation"]), reverse=True)
    return anomalies


# ---------------------------------------------------------------------
# Winners / losers across queries, pages, topics
# ---------------------------------------------------------------------

def _accumulate_by_key(
    daily_payloads: list[dict[str, Any]],
    source_path: tuple[str, ...],
    key_field: str,
    metric_field: str,
) -> dict[str, list[Optional[float]]]:
    """For each unique key across days, return a list of daily values.
    Missing days get None."""
    n = len(daily_payloads)
    series: dict[str, list[Optional[float]]] = defaultdict(lambda: [None] * n)
    for i, payload in enumerate(daily_payloads):
        items = _get_path(payload, source_path) or []
        if not isinstance(items, list):
            continue
        for item in items:
            k = item.get(key_field)
            v = item.get(metric_field)
            if k and isinstance(v, (int, float)):
                series[k][i] = float(v)
    return series


def _accumulate_topics_by_cluster_lang(
    daily_payloads: list[dict[str, Any]],
) -> dict[str, list[Optional[float]]]:
    """Like `_accumulate_by_key` but keyed on (cluster, lang) so bilingual
    topic rows with identical display names don't collide.

    Key format: "<cluster>::<lang>" — e.g. "whitelabel::en".
    For daily payloads emitted before the cluster migration (no
    `cluster`/`lang` on rows), we fall back to keying by `topic` so
    old data still surfaces; those rows just look "language-unknown"
    in the winners/losers table.
    """
    n = len(daily_payloads)
    series: dict[str, list[Optional[float]]] = defaultdict(lambda: [None] * n)
    for i, payload in enumerate(daily_payloads):
        items = _get_path(payload, ("cross_channel", "top_topics")) or []
        if not isinstance(items, list):
            continue
        for item in items:
            cluster = item.get("cluster")
            lang = item.get("lang")
            if cluster and lang:
                k = f"{cluster}::{lang}"
            else:
                k = item.get("topic")
            if not k:
                continue
            v = item.get("seo_clicks")
            if isinstance(v, (int, float)):
                series[k][i] = float(v)
    return series


def _first_last_delta(values: list[Optional[float]]) -> tuple[Optional[float], Optional[float], Optional[float]]:
    nonnone = [v for v in values if v is not None]
    if len(nonnone) < 2:
        return (None, None, None)
    first, last = nonnone[0], nonnone[-1]
    if first == 0:
        return (first, last, None)
    return (first, last, round(((last - first) / abs(first)) * 100, 2))


def compute_winners_losers(
    daily_payloads: list[dict[str, Any]], top_n: int = 5
) -> dict[str, Any]:
    queries_series = _accumulate_by_key(
        daily_payloads, ("summary", "seo", "top_queries"), "query", "clicks"
    )
    pages_series = _accumulate_by_key(
        daily_payloads, ("summary", "seo", "top_pages"), "page", "clicks"
    )
    # Topic rows are now bilingual — same cluster emits en + de rows.
    # Key by (cluster, lang) so we don't silently merge them when the
    # display name happens to be identical.
    # _accumulate_by_key already supports any key_field; we use a
    # synthesized `_cluster_lang_key` that daily payloads don't carry,
    # so fall back to per-row construction below.
    topics_series = _accumulate_topics_by_cluster_lang(daily_payloads)

    def _rank(series: dict[str, list[Optional[float]]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        rows = []
        for key, vals in series.items():
            first, last, pct = _first_last_delta(vals)
            if pct is None:
                continue
            rows.append({"key": key, "first": first, "last": last, "pct_change": pct, "series": vals})
        rows.sort(key=lambda r: r["pct_change"], reverse=True)
        return rows[:top_n], list(reversed(rows[-top_n:]))

    w_q, l_q = _rank(queries_series)
    w_p, l_p = _rank(pages_series)
    w_t, l_t = _rank(topics_series)
    return {
        "queries": {"winners": w_q, "losers": l_q},
        "pages":   {"winners": w_p, "losers": l_p},
        "topics":  {"winners": w_t, "losers": l_t},
    }


# ---------------------------------------------------------------------
# Cross-channel correlation per topic
# ---------------------------------------------------------------------

def cross_channel_topic_view(daily_payloads: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Aggregate per-(cluster, lang) cross-channel signals across the week.

    Uses `(cluster, lang)` as the accumulator key so bilingual clusters
    stay split. Emits `cluster` + `lang` alongside the legacy `topic`
    field so consumers that still key by display name keep working.
    """
    acc: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"topic": None, "cluster": None, "lang": None,
                 "seo_clicks": 0, "seo_impressions": 0,
                 "ga_views": 0, "geo_visibility_sum": 0.0, "geo_days": 0,
                 "geo_mentions": 0}
    )
    for payload in daily_payloads:
        for row in _get_path(payload, ("cross_channel", "top_topics")) or []:
            t = row.get("topic")
            cluster = row.get("cluster")
            lang = row.get("lang")
            if cluster and lang:
                key = f"{cluster}::{lang}"
            elif t:
                key = t  # pre-migration compatibility
            else:
                continue
            agg = acc[key]
            agg["topic"] = t or key
            agg["cluster"] = cluster
            agg["lang"] = lang
            agg["seo_clicks"] += int(row.get("seo_clicks", 0) or 0)
            agg["seo_impressions"] += int(row.get("seo_impressions", 0) or 0)
            agg["ga_views"] += int(row.get("ga_views", 0) or 0)
            viz = row.get("geo_visibility")
            if isinstance(viz, (int, float)):
                agg["geo_visibility_sum"] += float(viz)
                agg["geo_days"] += 1
            agg["geo_mentions"] += int(row.get("geo_mentions", 0) or 0)

    out = []
    for _, agg in acc.items():
        avg_viz = (agg["geo_visibility_sum"] / agg["geo_days"]) if agg["geo_days"] else 0.0
        out.append({
            "topic":           agg["topic"],
            "cluster":         agg["cluster"],
            "lang":            agg["lang"],
            "seo_clicks":      agg["seo_clicks"],
            "seo_impressions": agg["seo_impressions"],
            "ga_views":        agg["ga_views"],
            "geo_avg_visibility": round(avg_viz, 4),
            "geo_mentions":    agg["geo_mentions"],
        })
    out.sort(key=lambda r: r["seo_clicks"] + r["geo_mentions"], reverse=True)
    return out


# ---------------------------------------------------------------------
# Opportunity-gap quadrants (R3 style — see peec playbook)
# ---------------------------------------------------------------------

def opportunity_gaps(topic_view: list[dict[str, Any]]) -> dict[str, list[str]]:
    """Four quadrants the skill's weekly template uses:
      * rank_without_citation — we rank (seo_clicks>0) but Peec doesn't cite (geo_mentions=0)
      * citation_without_rank — Peec mentions us (geo_mentions>0) but we don't rank (seo_clicks=0)
      * traffic_without_conversion — handled in the skill (needs CRM data we don't have yet)
      * gap_where_everyone_loses — no SEO, no GEO, but high GA views (probably inbound referral we don't own)
    """
    rank_no_cite = [t["topic"] for t in topic_view if t["seo_clicks"] > 0 and t["geo_mentions"] == 0]
    cite_no_rank = [t["topic"] for t in topic_view if t["geo_mentions"] > 0 and t["seo_clicks"] == 0]
    orphan_traffic = [t["topic"] for t in topic_view
                      if t["ga_views"] > 0 and t["seo_clicks"] == 0 and t["geo_mentions"] == 0]
    return {
        "rank_without_citation": rank_no_cite,
        "citation_without_rank": cite_no_rank,
        "orphan_traffic_topics": orphan_traffic,
    }


# ---------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------

def aggregate_week(iso_week: str) -> dict[str, Any]:
    monday, sunday = week_date_range(iso_week)
    week_dates = [(monday + timedelta(days=i)).isoformat() for i in range(7)]
    daily_payloads: list[dict[str, Any]] = []
    missing: list[str] = []
    for d in week_dates:
        payload = _load_or_build_daily(d)
        if payload is None:
            missing.append(d)
            daily_payloads.append({"date": d, "sources_included": [], "sources_missing": ["gsc", "ga4", "llm_traffic", "peec"]})
        else:
            daily_payloads.append(payload)

    trends = build_trends(daily_payloads)
    anomalies = detect_anomalies(daily_payloads, week_dates)
    winners_losers = compute_winners_losers(daily_payloads)
    topic_view = cross_channel_topic_view(daily_payloads)
    gaps = opportunity_gaps(topic_view)

    # Week totals (sums + averages)
    def _safe_sum(name: str) -> Optional[float]:
        vals = [v for v in trends[name] if isinstance(v, (int, float))]
        return sum(vals) if vals else None

    def _safe_avg(name: str) -> Optional[float]:
        vals = [v for v in trends[name] if isinstance(v, (int, float))]
        return round(statistics.mean(vals), 4) if vals else None

    week_summary = {
        "total_clicks":         _safe_sum("seo.total_clicks"),
        "total_impressions":    _safe_sum("seo.total_impressions"),
        "avg_position":         _safe_avg("seo.avg_position"),
        "total_sessions":       _safe_sum("traffic.sessions"),
        "total_users":          _safe_sum("traffic.users"),
        "total_conversions":    _safe_sum("traffic.conversions"),
        "total_llm_sessions":   _safe_sum("llm_traffic.sessions"),
        "avg_geo_visibility":   _safe_avg("geo.avg_visibility"),
        "total_geo_mentions":   _safe_sum("geo.total_mentions"),
        "avg_seo_score":        _safe_avg("scores.seo_score"),
        "avg_geo_score":        _safe_avg("scores.geo_score"),
    }

    return {
        "iso_week": iso_week,
        "start_date": monday.isoformat(),
        "end_date": sunday.isoformat(),
        "generated_at": datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
        "days_available": 7 - len(missing),
        "dates_missing": missing,
        "week_summary": week_summary,
        "trends": trends,
        "winners_losers": winners_losers,
        "topic_view": topic_view,
        "opportunity_gaps": gaps,
        "anomalies": anomalies,
    }


# ---------------------------------------------------------------------
# IO + CLI
# ---------------------------------------------------------------------

def write_output(iso_week: str, payload: dict[str, Any]) -> Path:
    _OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = _OUT_DIR / f"{iso_week}.json"
    tmp = out.with_suffix(out.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, sort_keys=False)
    tmp.replace(out)
    return out


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Roll up 7 daily files into data/processed/weekly/<YYYY-Www>.json"
    )
    p.add_argument(
        "--week",
        help=(
            "ISO week label YYYY-Www (default: previous full ISO week). "
            "Example: 2026-W17."
        ),
    )
    return p


def main(argv: Optional[list[str]] = None) -> int:
    load_dotenv()
    args = build_parser().parse_args(argv)
    iso_week = args.week or previous_full_iso_week()

    try:
        payload = aggregate_week(iso_week)
    except ValueError as e:
        log.error("invalid --week", extra={"value": args.week, "error": str(e)})
        return 2
    except Exception as e:  # noqa: BLE001
        log.error("weekly aggregation failed", extra={"week": iso_week, "error": str(e)})
        return 1

    out = write_output(iso_week, payload)
    log.info(
        "wrote weekly aggregate",
        extra={
            "week": iso_week,
            "path": str(out),
            "days_available": payload["days_available"],
            "dates_missing": payload["dates_missing"],
            "anomalies": len(payload["anomalies"]),
            "winners_queries": len(payload["winners_losers"]["queries"]["winners"]),
        },
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Join GSC + GA4 + LLM traffic + Peec into ``data/processed/daily/<date>.json``.

Reads the four raw sources (any can be missing — we continue with
what's available and flag gaps in ``sources_missing``), computes
summary blocks, cross-channel views, composite SEO + GEO scores,
and deltas vs the prior day and prior-7-day baseline.

The resulting file is consumed by:
  * the daily routine in the orchestrating skill → Notion page
  * ``aggregate_weekly.py`` for 7-day roll-ups

CLI::

    python scripts/aggregate_daily.py --date 2026-04-20
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import mean
from typing import Any, Optional

import yaml  # type: ignore[import-untyped]
from dotenv import load_dotenv

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from scripts.utils import (  # noqa: E402
    extract_host,
    find_normalization_duplicates,
    get_logger,
    normalize_url,
    parse_date,
    yesterday,
)

log = get_logger(__name__)

_RAW_DIR = _ROOT / "data" / "raw"
_OUT_DIR = _ROOT / "data" / "processed" / "daily"
# Topic clusters config replaced the old tracked_topics.yaml on 2026-04-23.
# Each cluster emits TWO rows (lang=en, lang=de) in top_topics — same
# cluster identity, different language surfaces. See config file header
# + scripts/assign_clusters.py for the page-to-cluster join table.
_TOPIC_CONFIG = _ROOT / "config" / "topic_clusters.yaml"


# ---------------------------------------------------------------------
# Loaders (tolerant of missing files)
# ---------------------------------------------------------------------

def _load_raw(source: str, date_iso: str) -> Optional[dict[str, Any]]:
    path = _RAW_DIR / source / f"{date_iso}.json"
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        log.warning("failed to parse raw file",
                    extra={"source": source, "date": date_iso, "error": str(e)})
        return None


def _load_topic_config() -> list[dict[str, Any]]:
    """Load the topic_clusters.yaml file and flatten each cluster into
    two bilingual topic rows (one en, one de) in the *legacy shape* that
    `cross_channel_topics()` already understands.

    Legacy shape (what the aggregator consumes):
        { name, peec_topic_ids, gsc_query_patterns, ga4_path_patterns }

    New config shape:
        { slug, names: {en, de}, peec_topic_ids,
          gsc_query_patterns: {en, de}, ga4_path_patterns: {en, de} }

    Translation: we emit ONE flat row per (cluster, lang) pair, with
    the lang-specific patterns, and two extra fields — `cluster` and
    `lang` — so downstream stages can group by them. Peec IDs stay
    shared across lang rows because Peec prompts are language-mixed.
    """
    if not _TOPIC_CONFIG.exists():
        log.warning("topic_clusters.yaml not found; cross-channel topic view will be empty",
                    extra={"path": str(_TOPIC_CONFIG)})
        return []
    with _TOPIC_CONFIG.open("r", encoding="utf-8") as f:
        cfg = yaml.safe_load(f) or {}
    clusters = cfg.get("clusters", []) or []
    flat: list[dict[str, Any]] = []
    for c in clusters:
        slug = c.get("slug")
        names = c.get("names") or {}
        peec_ids = c.get("peec_topic_ids", []) or []
        gsc = c.get("gsc_query_patterns", {}) or {}
        ga4 = c.get("ga4_path_patterns", {}) or {}
        for lang in ("en", "de"):
            flat.append(
                {
                    "name": names.get(lang) or slug,
                    "cluster": slug,
                    "lang": lang,
                    "peec_topic_ids": list(peec_ids),
                    "gsc_query_patterns": list(gsc.get(lang, []) or []),
                    "ga4_path_patterns": list(ga4.get(lang, []) or []),
                }
            )
    return flat


def _resolve_peec_reference(
    peec: dict[str, Any], field_path: str
) -> Optional[dict[str, Any]]:
    """Peec daily files may reference another daily file for window-
    aggregate fields (top_own_urls, gap_urls, actions_overview). This
    resolver follows the `_reference` pointer to the canonical copy.
    """
    # field_path like "citations.top_own_urls"
    node: Any = peec
    for part in field_path.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    if not isinstance(node, dict):
        return None
    if "_reference" not in node:
        return node
    ref = node["_reference"]  # e.g. "data/raw/peec/2026-04-20.json#citations.top_own_urls"
    try:
        rel_path, anchor = ref.split("#", 1)
    except ValueError:
        return node
    full = _ROOT / rel_path
    if not full.exists():
        return None
    try:
        with full.open("r", encoding="utf-8") as f:
            target = json.load(f)
    except json.JSONDecodeError:
        return None
    for part in anchor.split("."):
        if not isinstance(target, dict) or part not in target:
            return None
        target = target[part]
    return target if isinstance(target, dict) else None


# ---------------------------------------------------------------------
# Summaries
# ---------------------------------------------------------------------

def summarize_seo(gsc: Optional[dict[str, Any]]) -> dict[str, Any]:
    if not gsc:
        return {"available": False}
    queries = gsc.get("queries", []) or []
    pages = gsc.get("pages", []) or []
    indexing = gsc.get("indexing", []) or []
    site_totals = gsc.get("site_totals") or {}

    # Day totals MUST come from the 0-dimension `site_totals` block
    # where available — the 4-D `queries` breakdown drops 60–80% of
    # impressions to GSC's privacy filter and would massively
    # under-count here. Fall back to summing queries only for old raw
    # files pulled before 2026-04-24 (pre-site_totals).
    if site_totals.get("impressions") is not None:
        total_clicks = int(site_totals.get("clicks", 0) or 0)
        total_impressions = int(site_totals.get("impressions", 0) or 0)
        # CTR comes back as a 0-1 ratio from GSC; keep same shape here.
        overall_ctr = float(site_totals.get("ctr", 0.0) or 0.0)
        # The 0-D position is already impression-weighted by GSC.
        totals_position = site_totals.get("position")
    else:
        # Legacy path — sums the privacy-filtered query rows.
        total_clicks = sum(int(q.get("clicks", 0) or 0) for q in queries)
        total_impressions = sum(int(q.get("impressions", 0) or 0) for q in queries)
        overall_ctr = (total_clicks / total_impressions) if total_impressions else 0.0
        totals_position = None

    # Sanity log: if we have BOTH site_totals and queries, compare.
    # Large divergence (>30%) indicates the privacy filter is dropping
    # so much that per-query analytics is nearly unusable — worth
    # documenting in the weekly report. Small divergence (5–30%) is
    # normal and expected at our scale.
    queries_sum = sum(int(q.get("impressions", 0) or 0) for q in queries)
    if site_totals.get("impressions") and queries_sum:
        recovery = queries_sum / total_impressions if total_impressions else 0.0
        if recovery < 0.70:  # missing >30% due to privacy filter
            import logging
            logging.getLogger(__name__).warning(
                "GSC privacy filter dropped %.0f%% of impressions in per-query breakdown "
                "(site_totals=%d, sum(queries)=%d). Top-query analysis will be incomplete; "
                "site totals remain accurate.",
                (1 - recovery) * 100,
                total_impressions,
                queries_sum,
            )

    # Impression-weighted average position, from the per-query rows
    # (still useful for the top-queries view even though totals come
    # from site_totals).
    impressions_sum = 0
    weighted_sum = 0.0
    for q in queries:
        pos = q.get("position")
        imp = int(q.get("impressions", 0) or 0)
        if pos is None or imp <= 0:
            continue
        weighted_sum += float(pos) * imp
        impressions_sum += imp
    # Prefer the 0-D position (true weighted avg); fall back to the
    # per-query weighted mean if site_totals wasn't available.
    avg_position: Optional[float] = (
        round(float(totals_position), 2) if totals_position is not None
        else round(weighted_sum / impressions_sum, 2) if impressions_sum
        else None
    )

    top_queries = sorted(queries, key=lambda q: int(q.get("clicks", 0) or 0), reverse=True)[:10]
    top_pages = sorted(pages, key=lambda p: int(p.get("clicks", 0) or 0), reverse=True)[:10]

    # Indexing health = share of inspected URLs whose verdict is PASS.
    pass_count = sum(1 for i in indexing if i.get("status") == "PASS")
    indexing_health = (pass_count / len(indexing)) if indexing else None

    return {
        "available": True,
        "total_clicks": total_clicks,
        "total_impressions": total_impressions,
        "overall_ctr": round(overall_ctr, 4),
        "avg_position": avg_position,   # Optional[float] — None when no ranked data
        "inspected_count": len(indexing),
        "indexing_health": indexing_health,
        "top_queries": [
            {
                "query": q.get("query"),
                "page": q.get("page"),
                "clicks": q.get("clicks"),
                "impressions": q.get("impressions"),
                "ctr": q.get("ctr"),
                "position": q.get("position"),
            }
            for q in top_queries
        ],
        "top_pages": [
            {
                "page": p.get("page"),
                "clicks": p.get("clicks"),
                "impressions": p.get("impressions"),
                "ctr": p.get("ctr"),
                "position": p.get("position"),
            }
            for p in top_pages
        ],
    }


def summarize_traffic(ga4: Optional[dict[str, Any]]) -> dict[str, Any]:
    if not ga4:
        return {"available": False}
    acq = ga4.get("acquisition", []) or []
    pages = ga4.get("pages", []) or []
    convs = ga4.get("conversions", []) or []

    total_sessions = sum(int(r.get("sessions", 0) or 0) for r in acq)
    total_users = sum(int(r.get("totalUsers", 0) or 0) for r in acq)
    total_conversions = sum(int(r.get("eventCount", 0) or 0) for r in convs)

    channel_breakdown: dict[str, int] = defaultdict(int)
    for r in acq:
        ch = r.get("sessionDefaultChannelGroup") or "(unclassified)"
        channel_breakdown[ch] += int(r.get("sessions", 0) or 0)

    top_pages_ga = sorted(
        pages, key=lambda p: int(p.get("screenPageViews", 0) or 0), reverse=True
    )[:10]

    return {
        "available": True,
        "sessions": total_sessions,
        "users": total_users,
        "conversions": total_conversions,
        "channel_breakdown": dict(channel_breakdown),
        "top_pages_ga": [
            {
                "url": p.get("url") or p.get("pagePath"),
                "views": p.get("screenPageViews"),
                "users": p.get("totalUsers"),
            }
            for p in top_pages_ga
        ],
    }


def summarize_llm_traffic(llm: Optional[dict[str, Any]]) -> dict[str, Any]:
    if not llm:
        return {"available": False}
    return {
        "available": True,
        "sessions": llm.get("total_llm_sessions", 0),
        "users": llm.get("total_llm_users", 0),
        "top_providers": list(llm.get("by_provider", {}).keys())[:5],
        "by_provider": llm.get("by_provider", {}),
        "unclassified_referrer_count": len(llm.get("unclassified_referrers", []) or []),
    }


def summarize_geo(peec: Optional[dict[str, Any]]) -> dict[str, Any]:
    if not peec:
        return {"available": False}

    # Resolve top-level reference-nodes. Reduced daily files point
    # `context` and `coverage_integrity` at a canonical sibling file
    # (e.g. 2026-04-24.json) to avoid duplicating brand/model/topic/tag
    # dictionaries. Without this resolution, `own_brand.id` comes back
    # as None, no rows match the brand filter, and we'd report 0
    # visibility / 0 mentions for the day even though the raw data is
    # right there.
    context = _resolve_peec_reference(peec, "context") or (peec.get("context") or {})
    coverage_integrity = (
        _resolve_peec_reference(peec, "coverage_integrity")
        or peec.get("coverage_integrity")
    )

    own_brand = context.get("own_brand") or {}
    own_id = own_brand.get("id")

    # Carry forward the Peec raw file's data-quality flags so the
    # Notion report can surface e.g. "only 3 of 16 engines active" —
    # otherwise readers will mistake "0% Claude visibility" for bad
    # visibility when Claude simply wasn't scraped (playbook anti-
    # pattern §2.6).
    data_quality_flags = peec.get("_data_quality_flags", []) or []

    # Extract own-brand rows from by_model_raw for the day, using
    # positional attribution across the 3 active engines (Peec MCP bug
    # returns model_id=null — see peec-ingest.md §Known data-quality issues).
    by_model = (peec.get("brand_visibility") or {}).get("by_model_raw") or {}
    columns: list[str] = by_model.get("columns", []) or []
    rows: list[list[Any]] = by_model.get("rows", []) or []

    def col(name: str, row: list[Any]) -> Any:
        try:
            return row[columns.index(name)]
        except (ValueError, IndexError):
            return None

    own_rows = [r for r in rows if col("brand_id", r) == own_id]
    visibilities = [float(col("visibility", r) or 0) for r in own_rows]
    avg_visibility = mean(visibilities) if visibilities else 0.0
    sovs = [float(col("share_of_voice", r) or 0) for r in own_rows]
    avg_sov = mean(sovs) if sovs else 0.0
    mentions = sum(int(col("mention_count", r) or 0) for r in own_rows)
    # NOTE: include 0 sentiment values — 0 is meaningfully "very
    # negative", NOT missing data. Previously we filtered it out.
    sentiments = [float(col("sentiment", r)) for r in own_rows if col("sentiment", r) is not None]
    avg_sentiment = mean(sentiments) if sentiments else None

    # Citations — the window-aggregate top_own_urls (may be a reference).
    citations_node = _resolve_peec_reference(peec, "citations.top_own_urls")
    cit_rows = (citations_node or {}).get("rows", [])
    cit_cols = (citations_node or {}).get("columns", [])

    def cit_col(name: str, row: list[Any]) -> Any:
        try:
            return row[cit_cols.index(name)]
        except (ValueError, IndexError):
            return None

    total_citations = sum(int(cit_col("citation_count", r) or 0) for r in cit_rows[:50])

    # Top prompts — own-brand per-prompt visibility, highest non-zero.
    by_prompt = (peec.get("brand_visibility") or {}).get("own_by_prompt") or {}
    pcols = by_prompt.get("columns", []) or []
    prows = by_prompt.get("rows", []) or []

    def pcol(name: str, row: list[Any]) -> Any:
        try:
            return row[pcols.index(name)]
        except (ValueError, IndexError):
            return None

    prompts_sorted = sorted(
        prows,
        key=lambda r: (float(pcol("visibility", r) or 0), int(pcol("mention_count", r) or 0)),
        reverse=True,
    )
    uncited_prompts = [r for r in prows if float(pcol("visibility", r) or 0) == 0]

    return {
        "available": True,
        "avg_visibility": round(avg_visibility, 4),
        "avg_share_of_voice": round(avg_sov, 4),
        "total_mentions": mentions,
        "avg_sentiment": round(avg_sentiment, 2) if avg_sentiment is not None else None,
        "total_citations_window": total_citations,
        "citations_aggregation_window": (peec.get("citations") or {}).get("_aggregation_window"),
        "uncited_prompt_count": len(uncited_prompts),
        "top_cited_prompts": [
            {"prompt_id": pcol("prompt_id", r), "visibility": pcol("visibility", r), "mention_count": pcol("mention_count", r)}
            for r in prompts_sorted[:5]
        ],
        "active_engines": (context.get("models") or {}).get("active", []),
        "coverage_integrity": coverage_integrity,
        "data_quality_flags": data_quality_flags,
    }


# ---------------------------------------------------------------------
# Cross-channel joins
# ---------------------------------------------------------------------

def _is_main_domain(url: str, canonical_origin: Optional[str]) -> bool:
    """True iff ``url``'s host equals the canonical origin's host.

    Used to scope cross-channel joins to the primary marketing site —
    otherwise GSC-sourced URLs on subdomains like ``docs.acme.io`` or
    ``app.acme.io`` (both covered by the ``sc-domain:acme.io``
    property) get joined against GA4 + Peec which are main-site only,
    producing a phantom mismatch. If ``canonical_origin`` is empty we
    can't judge and keep the URL (degrades gracefully).
    """
    if not canonical_origin or not url:
        return True
    target = extract_host(canonical_origin)
    host = extract_host(url)
    return bool(target) and host == target


def cross_channel_pages(
    gsc: Optional[dict[str, Any]],
    ga4: Optional[dict[str, Any]],
    llm: Optional[dict[str, Any]],
    peec: Optional[dict[str, Any]],
    canonical_origin: Optional[str],
    top_n: int = 200,
) -> list[dict[str, Any]]:
    """Union top-URL sets across sources and aggregate per URL.

    The default `top_n=200` is generous — the dashboard's Top Pages
    table has a client-side page-size selector and can handle it. If
    the daily JSON ever becomes too large, lower here rather than
    adding server-side pagination. Note this is the POST-union cap on
    the composite-scored list; `cross_channel_url_coverage` uses its
    own smaller `top_n_per_source` for the diagnostic coverage metric.
    """
    agg: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"url": None, "seo_clicks": 0, "seo_impressions": 0, "ga_sessions": 0,
                 "llm_sessions": 0, "peec_citations": 0, "sources": set()}
    )

    # GSC pages — scope to primary marketing domain so docs/app subdomain
    # URLs don't show up as "cross-channel" when they were never tracked
    # in GA4/Peec to begin with.
    if gsc:
        for p in gsc.get("pages", []) or []:
            url = normalize_url(p.get("page") or "", canonical_origin=canonical_origin)
            if not url or not _is_main_domain(url, canonical_origin):
                continue
            row = agg[url]
            row["url"] = url
            row["seo_clicks"] += int(p.get("clicks", 0) or 0)
            row["seo_impressions"] += int(p.get("impressions", 0) or 0)
            row["sources"].add("gsc")

    # GA4 pages
    if ga4:
        for p in ga4.get("pages", []) or []:
            url = p.get("url") or normalize_url(p.get("pagePath") or "", canonical_origin=canonical_origin)
            url = normalize_url(url, canonical_origin=canonical_origin)
            if not url or not _is_main_domain(url, canonical_origin):
                continue
            row = agg[url]
            row["url"] = url
            # GA4 doesn't carry sessions per page in our schema — use views
            row["ga_sessions"] += int(p.get("screenPageViews", 0) or 0)
            row["sources"].add("ga4")

    # LLM-traffic per-landing-page (currently empty in our schema; kept for future)
    if llm:
        for lp in llm.get("by_landing_page", []) or []:
            url = normalize_url(lp.get("url") or "", canonical_origin=canonical_origin)
            if not url:
                continue
            row = agg[url]
            row["url"] = url
            row["llm_sessions"] += int(lp.get("sessions", 0) or 0)
            row["sources"].add("llm_traffic")

    # Peec citations (own-URLs, window-aggregate) — filter to primary
    # marketing domain so external press coverage and related sites
    # don't pollute the join. They're still counted in the GEO
    # summary's total_citations_window, just not in the per-URL
    # cross-channel join.
    if peec:
        cit = _resolve_peec_reference(peec, "citations.top_own_urls") or {}
        cols = cit.get("columns", []) or []
        rows = cit.get("rows", []) or []
        url_i = cols.index("url") if "url" in cols else None
        cc_i = cols.index("citation_count") if "citation_count" in cols else None
        if url_i is not None:
            for r in rows:
                url = normalize_url(r[url_i] or "", canonical_origin=canonical_origin)
                if not url or not _is_main_domain(url, canonical_origin):
                    continue
                row = agg[url]
                row["url"] = url
                if cc_i is not None:
                    row["peec_citations"] += int(r[cc_i] or 0)
                row["sources"].add("peec")

    # Freeze sources to sorted list and compute composite score.
    out = []
    for row in agg.values():
        row["sources"] = sorted(row["sources"])
        # Simple composite: 40% clicks + 30% sessions + 20% citations + 10% llm.
        row["composite_score"] = (
            0.40 * min(row["seo_clicks"] / 100.0, 1.0)
            + 0.30 * min(row["ga_sessions"] / 200.0, 1.0)
            + 0.20 * min(row["peec_citations"] / 50.0, 1.0)
            + 0.10 * min(row["llm_sessions"] / 20.0, 1.0)
        )
        out.append(row)

    out.sort(key=lambda r: r["composite_score"], reverse=True)
    return out[:top_n]


def cross_channel_url_coverage(
    gsc: Optional[dict[str, Any]],
    ga4: Optional[dict[str, Any]],
    peec: Optional[dict[str, Any]],
    canonical_origin: Optional[str],
    top_n_per_source: int = 20,
) -> dict[str, Any]:
    """Return the share of top URLs from each source that appear in ≥1
    other source.

    This measures **cross-channel URL coverage**, NOT normalization
    correctness. Each source has a different top-N universe by design
    (GSC ranks by impressions, GA4 by views, Peec by citations — these
    reward different content). For multi-channel B2B, 50-70% coverage
    is normal. Higher coverage = more convergence between what ranks,
    what gets visited, and what gets cited by AI.

    Normalization correctness is verified separately — see the
    ``normalization_duplicates`` field on the daily output, which
    surfaces URL pairs that look like duplicates but weren't joined.
    A clean run returns an empty list there.
    """
    def _top_urls(
        source_name: str, source: Optional[dict[str, Any]]
    ) -> set[str]:
        """Return the top-N UNIQUE normalized URLs from a source.

        Deduping must happen BEFORE slicing: GSC returns many rows per
        page (one per country × device combination). Slicing the raw
        rows to [:top_n] before deduping collapses to just a handful
        of unique URLs — which is exactly the 7/20 bug we were
        hitting on real data.
        """
        if not source:
            return set()
        seen: set[str] = set()
        ordered: list[str] = []

        def _push(u: str) -> bool:
            """Add if new; return True if we've hit the target count."""
            if not u or u in seen:
                return False
            seen.add(u)
            ordered.append(u)
            return len(ordered) >= top_n_per_source

        if source_name == "gsc":
            # GSC API returns rows sorted by clicks-DESC. For a low-traffic
            # B2B site with ~10 daily clicks, this collapses the "top 20"
            # into whichever pages tied at 0 clicks happened to be returned
            # first — usually subdomain admin pages. Re-rank by impressions
            # (the stable-signal metric for URL prominence on a low-click
            # site) and filter to the primary marketing domain.
            pages_ranked = sorted(
                source.get("pages") or [],
                key=lambda p: (
                    int(p.get("impressions", 0) or 0),
                    int(p.get("clicks", 0) or 0),
                ),
                reverse=True,
            )
            for p in pages_ranked:
                u = normalize_url(p.get("page") or "", canonical_origin=canonical_origin)
                if not _is_main_domain(u, canonical_origin):
                    continue
                if _push(u):
                    break
        elif source_name == "ga4":
            for p in source.get("pages") or []:
                u = p.get("url") or normalize_url(p.get("pagePath") or "", canonical_origin=canonical_origin)
                u = normalize_url(u, canonical_origin=canonical_origin)
                if not _is_main_domain(u, canonical_origin):
                    continue
                if _push(u):
                    break
        elif source_name == "peec":
            cit = _resolve_peec_reference(source, "citations.top_own_urls") or {}
            cols = cit.get("columns", []) or []
            rows = cit.get("rows") or []
            if "url" in cols:
                i = cols.index("url")
                for r in rows:
                    u = normalize_url(r[i] or "", canonical_origin=canonical_origin)
                    if not _is_main_domain(u, canonical_origin):
                        continue
                    if _push(u):
                        break
        return set(ordered)

    sets = {
        "gsc": _top_urls("gsc", gsc),
        "ga4": _top_urls("ga4", ga4),
        "peec": _top_urls("peec", peec),
    }
    available = {name: s for name, s in sets.items() if s}
    if len(available) < 2:
        return {"coverage_ratio": None, "reason": "need ≥2 sources with URLs", "sizes": {k: len(v) for k, v in sets.items()}}

    matched = 0
    total = 0
    for name, urls in available.items():
        others: set[str] = set().union(*(s for n, s in available.items() if n != name))
        for u in urls:
            total += 1
            if u in others:
                matched += 1
    coverage = matched / total if total else 0.0
    return {
        "coverage_ratio": round(coverage, 4),
        "top_n_per_source": top_n_per_source,
        "sizes": {k: len(v) for k, v in sets.items()},
    }


def cross_channel_topics(
    gsc: Optional[dict[str, Any]],
    ga4: Optional[dict[str, Any]],
    llm: Optional[dict[str, Any]],
    peec: Optional[dict[str, Any]],
    topic_config: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    peec_topic_viz: dict[str, float] = {}
    peec_topic_mentions: dict[str, int] = {}
    if peec:
        by_topic = (peec.get("brand_visibility") or {}).get("own_by_topic") or {}
        cols = by_topic.get("columns", []) or []
        for r in by_topic.get("rows", []) or []:
            try:
                tid = r[cols.index("topic_id")]
                peec_topic_viz[tid] = float(r[cols.index("visibility")] or 0)
                peec_topic_mentions[tid] = int(r[cols.index("mention_count")] or 0)
            except (ValueError, IndexError):
                continue

    for topic in topic_config:
        name = topic.get("name")
        cluster = topic.get("cluster")
        lang = topic.get("lang")
        peec_ids = topic.get("peec_topic_ids", []) or []
        query_patterns = [re.compile(p) for p in topic.get("gsc_query_patterns", []) or []]
        path_patterns = [re.compile(p) for p in topic.get("ga4_path_patterns", []) or []]

        # SEO: sum clicks + impressions on matching queries.
        seo_clicks = seo_impressions = 0
        if gsc:
            for q in gsc.get("queries", []) or []:
                qtext = q.get("query") or ""
                if any(p.search(qtext) for p in query_patterns):
                    seo_clicks += int(q.get("clicks", 0) or 0)
                    seo_impressions += int(q.get("impressions", 0) or 0)

        # GA4: sum screenPageViews on matching paths.
        ga_views = 0
        if ga4:
            for p in ga4.get("pages", []) or []:
                path = p.get("pagePath") or ""
                if any(pp.search(path) for pp in path_patterns):
                    ga_views += int(p.get("screenPageViews", 0) or 0)

        # GEO: average visibility across the matched Peec topic IDs.
        # Note: same peec_ids for both lang rows (Peec prompts are
        # language-mixed), so the `geo_*` numbers are identical for the
        # en + de row of a given cluster. The UI should render them
        # once per cluster, not twice. That's a presentation concern;
        # the data here stays faithful to per-row aggregation.
        geo_viz_values = [peec_topic_viz.get(tid, 0.0) for tid in peec_ids]
        geo_viz = mean(geo_viz_values) if geo_viz_values else 0.0
        geo_mentions = sum(peec_topic_mentions.get(tid, 0) for tid in peec_ids)

        out.append(
            {
                "topic": name,
                "cluster": cluster,
                "lang": lang,
                "seo_clicks": seo_clicks,
                "seo_impressions": seo_impressions,
                "ga_views": ga_views,
                "geo_visibility": round(geo_viz, 4),
                "geo_mentions": geo_mentions,
                "peec_topic_ids": peec_ids,
            }
        )
    return out


# ---------------------------------------------------------------------
# Composite scores (0-100)
# ---------------------------------------------------------------------

def compute_seo_score(seo: dict[str, Any]) -> Optional[float]:
    """Composite SEO score, 0-100. Weighted sum of four clamped components:

        40 clicks      (clicks / SEO_CLICKS_CAP, capped at 1)
        30 impressions (impressions / SEO_IMPRESSIONS_CAP, capped at 1)
        20 position    (1 - impression_weighted_avg_position/20, floor 0);
                        neutral 0.5 if position is None (no ranked data)
        10 indexing    (% of top inspected URLs with verdict=PASS);
                        neutral 0.5 if no inspection data

    Caps tuned for early-stage B2B SaaS / infrastructure daily volume.
    As the brand grows the score will saturate faster; re-calibrate
    quarterly by checking whether the 90th-percentile day reaches cap,
    and bumping if so.

    Returns None when no GSC data at all.
    """
    SEO_CLICKS_CAP = 50.0
    SEO_IMPRESSIONS_CAP = 2500.0
    if not seo.get("available"):
        return None
    clicks = seo.get("total_clicks", 0) or 0
    impressions = seo.get("total_impressions", 0) or 0
    position = seo.get("avg_position")  # may be None
    health = seo.get("indexing_health")

    clicks_c = min(clicks / SEO_CLICKS_CAP, 1.0)
    imp_c = min(impressions / SEO_IMPRESSIONS_CAP, 1.0)
    if position is None:
        pos_c = 0.5   # neutral — we have no ranked data to judge
    else:
        pos_c = max(0.0, 1.0 - (float(position) / 20.0))
    health_c = float(health) if health is not None else 0.5

    score = (0.40 * clicks_c + 0.30 * imp_c + 0.20 * pos_c + 0.10 * health_c) * 100
    return round(score, 1)


def compute_geo_score(geo: dict[str, Any]) -> Optional[float]:
    """Weights: 40 visibility, 20 share-of-voice, 20 sentiment, 20 citations.
    Clamped + weighted-sum ×100.

    The citation cap scales with the citations window length so the
    score stays comparable as the Peec window changes. Without this,
    a 7-day window would saturate the citation component twice as
    fast as a 3-day window for the same per-day citation rate.
    """
    if not geo.get("available"):
        return None
    viz = float(geo.get("avg_visibility", 0) or 0)            # already 0-1
    sov = float(geo.get("avg_share_of_voice", 0) or 0)        # 0-1 (tiny in practice)
    sentiment = geo.get("avg_sentiment")
    citations = geo.get("total_citations_window", 0) or 0

    # Resolve the citations window — defaults to 3 days (the skill's
    # default aggregation window) if the field is missing.
    citations_window_days = 3
    cit_window = geo.get("citations_aggregation_window")
    if isinstance(cit_window, dict) and "start" in cit_window and "end" in cit_window:
        try:
            from datetime import date
            start = date.fromisoformat(cit_window["start"])
            end = date.fromisoformat(cit_window["end"])
            citations_window_days = max(1, (end - start).days + 1)
        except (ValueError, TypeError):
            pass

    viz_c = min(viz, 1.0)
    sov_c = min(sov * 2.0, 1.0)  # SoV is typically 0-0.5; scale up
    sent_c = (float(sentiment) / 100.0) if sentiment is not None else 0.5
    # ~166 citations/day saturates — calibrated for early-stage scale.
    # Scaled by window length for window-comparability.
    cit_c = min(citations / (166.0 * citations_window_days), 1.0)

    score = (0.40 * viz_c + 0.20 * sov_c + 0.20 * sent_c + 0.20 * cit_c) * 100
    return round(score, 1)


# ---------------------------------------------------------------------
# Deltas
# ---------------------------------------------------------------------

def compute_deltas(
    today_summary: dict[str, Any], baseline_summary: Optional[dict[str, Any]]
) -> dict[str, Any]:
    """Per-metric percentage deltas of today vs baseline.

    Baseline may be ``None`` (no prior data) → returns ``{available: False}``.
    ``None``/zero baselines for a specific metric are handled by emitting
    ``null`` for that metric rather than dividing by zero.
    """
    if not baseline_summary:
        return {"available": False}
    deltas: dict[str, Any] = {"available": True}
    for domain, summary in today_summary.items():
        if not isinstance(summary, dict) or not summary.get("available"):
            continue
        base = baseline_summary.get(domain) or {}
        if not base.get("available"):
            continue
        domain_deltas: dict[str, Any] = {}
        # Per-domain metric keys that can be compared to a baseline.
        # IMPORTANT: these are the flat keys ON the per-domain summary
        # (summarize_seo / summarize_traffic / summarize_llm_traffic /
        # summarize_geo). If a key isn't in the given domain's summary
        # it's simply skipped — don't invent a cross-domain key like
        # "total_llm_sessions" (the LLM summary calls that field
        # simply "sessions"). That silent mismatch hid the LLM-traffic
        # delta bug until the Phase-4 sanity audit.
        for key in ("total_clicks", "total_impressions", "sessions", "users",
                    "conversions", "total_mentions", "avg_visibility"):
            t = summary.get(key)
            b = base.get(key)
            if t is None or b is None:
                continue
            if b == 0:
                domain_deltas[key] = {"today": t, "prior": b, "pct_change": None}
            else:
                domain_deltas[key] = {
                    "today": t,
                    "prior": b,
                    "pct_change": round(((t - b) / b) * 100, 2),
                }
        if domain_deltas:
            deltas[domain] = domain_deltas
    return deltas


def _load_prior_processed(date_iso: str) -> Optional[dict[str, Any]]:
    path = _OUT_DIR / f"{date_iso}.json"
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError:
        return None


def _prior_n_avg(date_iso: str, n: int) -> Optional[dict[str, Any]]:
    """Return a summary-shaped dict averaging the prior N days' processed files.
    If fewer than ceil(n/2) prior days exist, returns None."""
    target = parse_date(date_iso)
    files = []
    for i in range(1, n + 1):
        d = (target - timedelta(days=i)).isoformat()
        data = _load_prior_processed(d)
        if data and data.get("summary"):
            files.append(data["summary"])
    if len(files) < max(1, n // 2):
        return None

    # Average numeric fields per domain.
    avg: dict[str, Any] = {}
    for domain in ("seo", "traffic", "geo", "llm_traffic"):
        buckets: dict[str, list[float]] = defaultdict(list)
        any_avail = False
        for f in files:
            dom = f.get(domain) or {}
            if not dom.get("available"):
                continue
            any_avail = True
            for k, v in dom.items():
                if isinstance(v, (int, float)):
                    buckets[k].append(float(v))
        if not any_avail:
            avg[domain] = {"available": False}
            continue
        avg[domain] = {"available": True}
        for k, vals in buckets.items():
            avg[domain][k] = round(mean(vals), 4) if vals else 0
    return avg


# ---------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------

def aggregate(date_iso: str, canonical_origin: Optional[str] = None) -> dict[str, Any]:
    gsc = _load_raw("gsc", date_iso)
    ga4 = _load_raw("ga4", date_iso)
    llm = _load_raw("llm_traffic", date_iso)
    peec = _load_raw("peec", date_iso)

    import os
    if canonical_origin is None:
        canonical_origin = os.environ.get("SITE_CANONICAL_ORIGIN", "").strip() or None

    sources_included: list[str] = []
    sources_missing: list[str] = []
    for name, src in (("gsc", gsc), ("ga4", ga4), ("llm_traffic", llm), ("peec", peec)):
        (sources_included if src else sources_missing).append(name)

    summary = {
        "seo": summarize_seo(gsc),
        "traffic": summarize_traffic(ga4),
        "llm_traffic": summarize_llm_traffic(llm),
        "geo": summarize_geo(peec),
    }

    topic_cfg = _load_topic_config()

    # Sort top_topics by a composite activity score so "top" actually
    # means top. The composite is intentionally simple:
    #   activity = seo_clicks + ga_views + geo_mentions
    # — all roughly "user-facing touches". A topic that ranks, draws
    # traffic, and gets cited will lead the list; silent topics sink.
    topics_sorted = cross_channel_topics(gsc, ga4, llm, peec, topic_cfg)
    topics_sorted.sort(
        key=lambda t: (t.get("seo_clicks", 0) or 0)
                       + (t.get("ga_views", 0) or 0)
                       + (t.get("geo_mentions", 0) or 0),
        reverse=True,
    )

    top_pages = cross_channel_pages(
        gsc, ga4, llm, peec, canonical_origin=canonical_origin
    )
    # Run the stricter normalization-duplicate check against the
    # cross-channel output. Any non-empty groups mean normalize_url
    # missed a case (www prefix, path case, etc.) — surface it so we
    # don't silently accumulate split rows for the same page.
    norm_dupes = find_normalization_duplicates(r["url"] for r in top_pages)

    cross = {
        "top_pages_all_channels": top_pages,
        "top_topics": topics_sorted,
        "url_coverage": cross_channel_url_coverage(
            gsc, ga4, peec, canonical_origin=canonical_origin
        ),
        "normalization_duplicates": norm_dupes,
    }

    scores = {
        "seo_score": compute_seo_score(summary["seo"]),
        "geo_score": compute_geo_score(summary["geo"]),
    }

    prior_day = _load_prior_processed((parse_date(date_iso) - timedelta(days=1)).isoformat())
    prior_summary = (prior_day or {}).get("summary")
    prior_7_avg = _prior_n_avg(date_iso, 7)

    deltas_vs_prior_day = compute_deltas(summary, prior_summary)
    deltas_vs_prior_7 = compute_deltas(summary, prior_7_avg)

    return {
        "date": date_iso,
        "generated_at": datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
        "sources_included": sources_included,
        "sources_missing": sources_missing,
        "summary": summary,
        "scores": scores,
        "cross_channel": cross,
        "deltas_vs_prior_day": deltas_vs_prior_day,
        "deltas_vs_prior_7_avg": deltas_vs_prior_7,
    }


# ---------------------------------------------------------------------
# IO
# ---------------------------------------------------------------------

def write_output(date_iso: str, payload: dict[str, Any]) -> Path:
    _OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = _OUT_DIR / f"{date_iso}.json"
    tmp = out.with_suffix(out.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, sort_keys=False)
    tmp.replace(out)
    return out


# ---------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Join GSC + GA4 + LLM + Peec into data/processed/daily/<date>.json"
    )
    p.add_argument("--date", help="Target date YYYY-MM-DD (default: yesterday).")
    p.add_argument(
        "--days-back",
        type=int,
        default=None,
        help=(
            "Rebuild N days ending yesterday (or ending --date if given). "
            "Useful after a config change — e.g. --days-back 30 rewrites "
            "the full dashboard window with the current topic_clusters.yaml."
        ),
    )
    return p


def _daterange_back(end_iso: str, days: int) -> list[str]:
    """Return `days` ISO dates ending on `end_iso` (inclusive), oldest first."""
    from datetime import date, timedelta

    y, m, d = (int(x) for x in end_iso.split("-"))
    end = date(y, m, d)
    out: list[str] = []
    for i in range(days - 1, -1, -1):
        out.append((end - timedelta(days=i)).isoformat())
    return out


def main(argv: Optional[list[str]] = None) -> int:
    load_dotenv()
    args = build_parser().parse_args(argv)
    end_iso = (parse_date(args.date) if args.date else yesterday()).isoformat()

    # Decide the list of dates to process.
    if args.days_back is not None:
        if args.days_back < 1:
            log.error("--days-back must be ≥ 1")
            return 1
        dates_to_run = _daterange_back(end_iso, args.days_back)
    else:
        dates_to_run = [end_iso]

    total = len(dates_to_run)
    failures = 0
    for i, date_iso in enumerate(dates_to_run, 1):
        try:
            payload = aggregate(date_iso)
        except Exception as e:  # noqa: BLE001
            log.error(
                "aggregate failed",
                extra={"date": date_iso, "error": str(e), "progress": f"{i}/{total}"},
            )
            failures += 1
            continue

        out = write_output(date_iso, payload)
        log.info(
            "wrote daily aggregate",
            extra={
                "date": date_iso,
                "progress": f"{i}/{total}",
                "path": str(out),
                "sources_included": payload["sources_included"],
                "sources_missing": payload["sources_missing"],
                "seo_score": payload["scores"]["seo_score"],
                "geo_score": payload["scores"]["geo_score"],
                "url_coverage": payload["cross_channel"]["url_coverage"],
                "normalization_duplicates_found": len(
                    payload["cross_channel"]["normalization_duplicates"]
                ),
            },
        )

    if total > 1:
        log.info(
            "backfill complete",
            extra={
                "total": total,
                "succeeded": total - failures,
                "failed": failures,
            },
        )

    return 1 if failures == total else 0


if __name__ == "__main__":
    sys.exit(main())

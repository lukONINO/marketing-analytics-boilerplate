"""Produce the AI Visibility Improvements panel data for the Insights page.

What it does
------------
Joins three data sources into a ranked, per-cluster, per-page improvement
list surfaced on the new Insights page:

  1. Latest daily aggregate   (data/processed/daily/<latest>.json)
     → GSC top_queries + top_pages, GA4 top pages, cross_channel topics
  2. Page cluster assignments (data/processed/page_clusters.json)
     → which cluster + lang each URL belongs to, plus content signals
  3. Scraped page inventory   (data/raw/content/<latest>/_inventory.json)
     → read for freshness check; individual page records provide the
       numeric_claims / schema_types drilled-down into already by
       assign_clusters.py, so we don't re-read them here.

Rules (each one emits an opportunity row — highest-value first)
---------------------------------------------------------------
  R1. RANK_WITHOUT_SCHEMA
      Page has ≥50 GSC impressions in the window AND is not in any
      Article / FAQPage / HowTo / BlogPosting schema type.
      → Fix: add JSON-LD Article schema.
  R2. RANKER_WITHOUT_CLAIMS
      Page has ≥50 GSC impressions AND zero numeric_claims.
      → Fix: insert 3+ quantified proof points.
  R3. THIN_BUT_TRAFFICKED
      Page has ≥30 GA sessions in window AND word_count < 500.
      → Fix: expand to 1500+ words.
  R4. LOW_CTR_WEAK_META
      Page has ≥200 impressions AND CTR < 1% AND (missing meta OR
      title too short OR title lacks cluster keywords).
      → Fix: rewrite title/meta with quantified promise.
  R5. BILINGUAL_GAP
      Cluster has EN page_count ≥ 3 AND DE page_count == 0
      (or reverse). → Fix: translation backlog.
  R6. CLUSTER_VISIBILITY_LAG
      Cluster's Peec visibility < 0.3 AND geo_mentions < 5 over window.
      → Fix: pillar-page + internal linking campaign.
  R7. ORPHAN_LONGFORM
      Page has word_count > 1000 AND internal_links < 5.
      → Fix: add internal links from related cluster pages.

Each opportunity has a severity (high | medium | low) based on how
much GSC traffic / AI visibility is at stake. The Insights UI shows
high-severity opportunities at the top.

Output
------
    data/processed/visibility_improvements.json
    {
      "generated_at": "...",
      "window_days": 30,
      "source_daily": "data/processed/daily/2026-04-23.json",
      "opportunities": [
        {
          "id": "viz_2026_04_23_001",
          "rule": "RANK_WITHOUT_SCHEMA",
          "severity": "high",
          "cluster": "whitelabel",
          "lang": "en",
          "url": "https://acme.io/...",
          "title": "...",
          "evidence": {
            "gsc_impressions": 842, "gsc_clicks": 12, "position": 8.4,
            "schema_types": ["Organization"], "word_count": 1578
          },
          "fix": "Add Article or BlogPosting JSON-LD...",
          "estimated_lift": "+15-30% AI citation probability"
        },
        ...
      ],
      "by_cluster_summary": {
        "whitelabel::en": { "opportunities": 4, "high": 1, ... },
        ...
      }
    }

CLI:
    python scripts/compute_visibility_improvements.py
    python scripts/compute_visibility_improvements.py --window 14
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

_DAILY_DIR = _ROOT / "data" / "processed" / "daily"
_PROCESSED_DIR = _ROOT / "data" / "processed"
_OUT_PATH = _PROCESSED_DIR / "visibility_improvements.json"

log = logging.getLogger("visibility_improvements")
log.addHandler(logging.StreamHandler())
log.setLevel(logging.INFO)


# ---------------------------------------------------------------------
# Thresholds — tuned for early-stage daily volume (~50 GSC clicks/day).
# ---------------------------------------------------------------------

T_GSC_IMPRESSIONS_MIN = 50
T_LOW_CTR_IMPRESSIONS = 200
T_LOW_CTR_PCT = 0.01
T_GA_SESSIONS_MIN = 30
T_THIN_WORDS = 500
T_LONGFORM_WORDS = 1000
T_ORPHAN_LINKS = 5
T_CLUSTER_VIZ_LAG = 0.3
T_CLUSTER_MENTIONS_LAG = 5
SCHEMA_ARTICLE_TYPES = {"Article", "BlogPosting", "NewsArticle", "TechArticle"}
SCHEMA_STRUCTURED_TYPES = SCHEMA_ARTICLE_TYPES | {"FAQPage", "HowTo", "Report"}


# ---------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------

def _load_json(path: Path) -> Optional[dict[str, Any]]:
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        log.warning("bad JSON at %s: %s", path, e)
        return None


def _latest_daily_path() -> Optional[Path]:
    if not _DAILY_DIR.exists():
        return None
    files = sorted(_DAILY_DIR.glob("*.json"))
    return files[-1] if files else None


def _window_daily_payloads(window: int) -> list[dict[str, Any]]:
    if not _DAILY_DIR.exists():
        return []
    files = sorted(_DAILY_DIR.glob("*.json"))[-window:]
    out = []
    for f in files:
        d = _load_json(f)
        if d:
            out.append(d)
    return out


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------

def _sum_gsc_impressions_per_page(daily_payloads: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    """Per-URL sum of clicks + impressions across the window.

    Emits:
        {
          "https://acme.io/foo": {
             "clicks": 12, "impressions": 842,
             "ctr": 0.014, "position_weighted": 8.4
          },
          ...
        }

    CTR is recomputed from summed clicks/impressions (not averaged from
    daily CTRs — that would overweight low-volume days). Position is
    impression-weighted to give more credence to days where the page
    actually ranked.
    """
    acc: dict[str, dict[str, float]] = {}
    for p in daily_payloads:
        for row in (p.get("summary", {}).get("seo", {}) or {}).get("top_pages", []) or []:
            url = row.get("page") or ""
            if not url:
                continue
            entry = acc.setdefault(url, {"clicks": 0.0, "impressions": 0.0,
                                          "position_x_imp": 0.0, "imp_count": 0.0})
            clicks = float(row.get("clicks") or 0)
            impr = float(row.get("impressions") or 0)
            pos = float(row.get("position") or 0)
            entry["clicks"] += clicks
            entry["impressions"] += impr
            if impr > 0 and pos > 0:
                entry["position_x_imp"] += pos * impr
                entry["imp_count"] += impr
    out: dict[str, dict[str, float]] = {}
    for url, e in acc.items():
        ctr = e["clicks"] / e["impressions"] if e["impressions"] > 0 else 0.0
        pos_w = e["position_x_imp"] / e["imp_count"] if e["imp_count"] > 0 else 0.0
        out[url] = {
            "clicks": e["clicks"],
            "impressions": e["impressions"],
            "ctr": round(ctr, 4),
            "position_weighted": round(pos_w, 2),
        }
    return out


def _sum_ga_sessions_per_page(daily_payloads: list[dict[str, Any]]) -> dict[str, int]:
    acc: dict[str, int] = {}
    for p in daily_payloads:
        for row in (p.get("summary", {}).get("traffic", {}) or {}).get("top_pages_ga", []) or []:
            url = row.get("url") or ""
            if not url:
                continue
            acc[url] = acc.get(url, 0) + int(row.get("views") or 0)
    return acc


def _cluster_window_metrics(
    daily_payloads: list[dict[str, Any]],
) -> dict[str, dict[str, float]]:
    """Sum SEO + mentions across the window, averaged visibility."""
    acc: dict[str, dict[str, float]] = {}
    for p in daily_payloads:
        for row in (p.get("cross_channel") or {}).get("top_topics") or []:
            cluster = row.get("cluster")
            lang = row.get("lang")
            if not cluster or not lang:
                continue
            key = f"{cluster}::{lang}"
            entry = acc.setdefault(key, {
                "seo_clicks": 0.0, "seo_impressions": 0.0, "ga_views": 0.0,
                "geo_mentions": 0.0, "viz_sum": 0.0, "viz_n": 0.0,
            })
            entry["seo_clicks"] += float(row.get("seo_clicks") or 0)
            entry["seo_impressions"] += float(row.get("seo_impressions") or 0)
            entry["ga_views"] += float(row.get("ga_views") or 0)
            entry["geo_mentions"] += float(row.get("geo_mentions") or 0)
            viz = row.get("geo_visibility")
            if isinstance(viz, (int, float)):
                entry["viz_sum"] += float(viz)
                entry["viz_n"] += 1
    out: dict[str, dict[str, float]] = {}
    for k, e in acc.items():
        avg_viz = (e["viz_sum"] / e["viz_n"]) if e["viz_n"] else 0.0
        out[k] = {
            "seo_clicks": e["seo_clicks"],
            "seo_impressions": e["seo_impressions"],
            "ga_views": e["ga_views"],
            "geo_mentions": e["geo_mentions"],
            "avg_geo_visibility": round(avg_viz, 4),
        }
    return out


# ---------------------------------------------------------------------
# Opportunity rules
# ---------------------------------------------------------------------

def _mk_opp(
    ids: list[str], rule: str, severity: str,
    cluster: str, lang: str, url: str, title: Optional[str],
    evidence: dict[str, Any], fix: str, estimated_lift: str,
) -> dict[str, Any]:
    idx = len(ids) + 1
    today = datetime.now(tz=timezone.utc).strftime("%Y_%m_%d")
    opp_id = f"viz_{today}_{idx:03d}"
    ids.append(opp_id)
    return {
        "id": opp_id,
        "rule": rule,
        "severity": severity,
        "cluster": cluster,
        "lang": lang,
        "url": url,
        "title": title,
        "evidence": evidence,
        "fix": fix,
        "estimated_lift": estimated_lift,
    }


def rule_rank_without_schema(
    assignments: list[dict[str, Any]],
    gsc_per_page: dict[str, dict[str, float]],
    ids: list[str],
) -> list[dict[str, Any]]:
    out = []
    for a in assignments:
        url = a["url"]
        g = gsc_per_page.get(url)
        if not g or g["impressions"] < T_GSC_IMPRESSIONS_MIN:
            continue
        schema_types = set(a.get("schema_types") or [])
        if schema_types & SCHEMA_STRUCTURED_TYPES:
            continue
        # Severity: impressions > 500 → high; 200-500 → medium; 50-200 → low
        impr = g["impressions"]
        sev = "high" if impr >= 500 else ("medium" if impr >= 200 else "low")
        out.append(_mk_opp(
            ids, "RANK_WITHOUT_SCHEMA", sev, a["cluster"], a["lang"], url, a.get("title"),
            {
                "gsc_impressions": int(g["impressions"]),
                "gsc_clicks": int(g["clicks"]),
                "position": g["position_weighted"],
                "schema_types": sorted(schema_types),
                "word_count": a.get("word_count"),
            },
            fix="Add Article or BlogPosting JSON-LD with headline, author, datePublished, and image. For how-to content, add HowTo schema; for Q&A sections, add FAQPage.",
            estimated_lift="+15–30% AI citation probability; marginal SEO lift via rich results eligibility.",
        ))
    return out


def rule_ranker_without_claims(
    assignments: list[dict[str, Any]],
    gsc_per_page: dict[str, dict[str, float]],
    ids: list[str],
) -> list[dict[str, Any]]:
    out = []
    for a in assignments:
        url = a["url"]
        g = gsc_per_page.get(url)
        if not g or g["impressions"] < T_GSC_IMPRESSIONS_MIN:
            continue
        if (a.get("numeric_claims_count") or 0) > 0:
            continue
        impr = g["impressions"]
        sev = "high" if impr >= 500 else ("medium" if impr >= 150 else "low")
        out.append(_mk_opp(
            ids, "RANKER_WITHOUT_CLAIMS", sev, a["cluster"], a["lang"], url, a.get("title"),
            {
                "gsc_impressions": int(g["impressions"]),
                "gsc_clicks": int(g["clicks"]),
                "numeric_claims_count": 0,
                "word_count": a.get("word_count"),
            },
            fix="Insert 3+ quantified proof points relevant to this cluster (market size, time-to-launch, cost delta, regulatory limits). Pull from data/knowledge/proof-points.json or commission new stats.",
            estimated_lift="Quoted-in-AI-answer probability jumps ~2x when a page contains at least one hard number inside a paragraph the answer-engine can lift.",
        ))
    return out


# THIN_BUT_TRAFFICKED rule retired 2026-04-26.
#
# Word count alone is too crude a signal: a 415-word homepage gets the
# same "expand to 1500+ words" template as a 415-word category index,
# even though the right action is wildly different. The rule emitted
# noise more often than signal.
#
# This class of judgment ("is this page actually thin given its job?")
# is now Claude's responsibility — see `dashboard-sync.md` and
# `visibility-lift.md` skills. Claude can read the page, check the
# cluster's other URLs, weigh in on what role this page is supposed
# to play, and write a finding that the dashboard surfaces in the
# action stream alongside (and prioritized over) the remaining
# rule-based items.
#
# The other rules below stay — they trigger on multi-signal patterns
# that don't suffer the same fragility (missing schema on a ranking
# page, missing claims on a high-impression page, EN/DE asymmetry,
# orphan long-form, cluster-level visibility lag). If word count is
# part of the pattern alongside another signal, that's fine; the
# disqualifying case was word-count-as-the-only-signal.


def rule_low_ctr_weak_meta(
    assignments: list[dict[str, Any]],
    gsc_per_page: dict[str, dict[str, float]],
    ids: list[str],
) -> list[dict[str, Any]]:
    out = []
    for a in assignments:
        url = a["url"]
        g = gsc_per_page.get(url)
        if not g or g["impressions"] < T_LOW_CTR_IMPRESSIONS:
            continue
        if g["ctr"] >= T_LOW_CTR_PCT:
            continue
        title = (a.get("title") or "").strip()
        has_meta = a.get("has_meta_description")
        reasons = []
        if not has_meta:
            reasons.append("no meta description")
        if len(title) < 35:
            reasons.append(f"title too short ({len(title)} chars)")
        if not reasons:
            continue  # low CTR but meta + title look fine; different problem
        impr = g["impressions"]
        sev = "high" if impr >= 1000 else "medium"
        out.append(_mk_opp(
            ids, "LOW_CTR_WEAK_META", sev, a["cluster"], a["lang"], url, title or None,
            {
                "gsc_impressions": int(g["impressions"]),
                "ctr": g["ctr"],
                "position": g["position_weighted"],
                "issues": reasons,
            },
            fix="Rewrite title as a concrete quantified promise (≥50 chars, includes cluster term + an outcome number). Add meta description with 1 claim + 1 CTA.",
            estimated_lift="CTR on top-10 rankings typically doubles from 1% → 2% with a tightened title. At current impression volume, that's real incremental traffic.",
        ))
    return out


def rule_bilingual_gap(
    by_cluster_content: dict[str, dict[str, Any]],
    ids: list[str],
) -> list[dict[str, Any]]:
    out = []
    # Group by cluster_slug → {en_count, de_count}
    clusters: dict[str, dict[str, int]] = {}
    for key, stats in by_cluster_content.items():
        if "::" not in key:
            continue
        slug, lang = key.split("::", 1)
        clusters.setdefault(slug, {"en": 0, "de": 0})[lang] = int(stats.get("page_count", 0))
    for slug, langs in clusters.items():
        en_c, de_c = langs.get("en", 0), langs.get("de", 0)
        if en_c >= 3 and de_c == 0:
            out.append(_mk_opp(
                ids, "BILINGUAL_GAP", "medium", slug, "de", url="", title=None,
                evidence={"en_page_count": en_c, "de_page_count": 0},
                fix=f"{en_c} EN pages in this cluster have no DE counterpart. Translate the top 3 by traffic first.",
                estimated_lift="DE versions of high-performing EN pages typically pick up 30–70% of the EN page's search traffic within 60 days when targeting a DACH market.",
            ))
        elif de_c >= 3 and en_c == 0:
            out.append(_mk_opp(
                ids, "BILINGUAL_GAP", "low", slug, "en", url="", title=None,
                evidence={"en_page_count": 0, "de_page_count": de_c},
                fix=f"{de_c} DE pages in this cluster have no EN counterpart. EN pages serve the international distribution layer (Peec, LLM training data).",
                estimated_lift="EN content compounds AI-citation probability — English is overrepresented in LLM training corpora.",
            ))
    return out


def rule_cluster_visibility_lag(
    cluster_window: dict[str, dict[str, float]],
    ids: list[str],
) -> list[dict[str, Any]]:
    out = []
    for key, m in cluster_window.items():
        slug, lang = key.split("::", 1) if "::" in key else (key, "en")
        viz = m.get("avg_geo_visibility", 0) or 0
        mentions = m.get("geo_mentions", 0) or 0
        if viz >= T_CLUSTER_VIZ_LAG or mentions >= T_CLUSTER_MENTIONS_LAG:
            continue
        # Only flag clusters that have any SEO footprint — otherwise
        # "visibility lag" is just "cluster is dormant".
        if (m.get("seo_impressions") or 0) < 100:
            continue
        sev = "high" if viz < 0.15 else "medium"
        out.append(_mk_opp(
            ids, "CLUSTER_VISIBILITY_LAG", sev, slug, lang, url="", title=None,
            evidence={
                "avg_geo_visibility": viz,
                "geo_mentions": int(mentions),
                "seo_impressions": int(m.get("seo_impressions") or 0),
                "seo_clicks": int(m.get("seo_clicks") or 0),
            },
            fix="Stand up a pillar page covering the cluster's top query intent with ≥1 FAQPage schema block and 5+ numeric claims. Cross-link from every cluster leaf page.",
            estimated_lift="Pillar-page + claim injection typically lifts cluster AI visibility from <20% → 40-50% over 4-6 weeks in Peec.",
        ))
    return out


def rule_orphan_longform(
    assignments: list[dict[str, Any]],
    ids: list[str],
) -> list[dict[str, Any]]:
    out = []
    for a in assignments:
        wc = a.get("word_count") or 0
        links = a.get("internal_links") or 0
        if wc < T_LONGFORM_WORDS or links >= T_ORPHAN_LINKS:
            continue
        out.append(_mk_opp(
            ids, "ORPHAN_LONGFORM", "low", a["cluster"], a["lang"], a["url"], a.get("title"),
            {"word_count": wc, "internal_links": links},
            fix=f"Add internal links from related cluster pages. Target ≥5 inbound internal links on any 1000+ word page. Currently has {links}.",
            estimated_lift="Internal-linking density correlates strongly with indexing frequency and LLM re-ingestion cadence.",
        ))
    return out


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

def run(window: int = 30) -> dict[str, Any]:
    latest_daily = _latest_daily_path()
    if not latest_daily:
        log.error("no daily payloads under %s — run aggregate_daily.py first", _DAILY_DIR)
        return {}

    assignments_doc = _load_json(_PROCESSED_DIR / "page_clusters.json")
    if not assignments_doc:
        log.error("page_clusters.json missing — run scripts/assign_clusters.py first")
        return {}
    assignments = assignments_doc.get("assignments", [])
    by_cluster_content = assignments_doc.get("by_cluster", {})

    window_payloads = _window_daily_payloads(window)
    gsc_per_page = _sum_gsc_impressions_per_page(window_payloads)
    ga_per_page = _sum_ga_sessions_per_page(window_payloads)
    cluster_window = _cluster_window_metrics(window_payloads)

    ids: list[str] = []
    opps: list[dict[str, Any]] = []
    opps += rule_rank_without_schema(assignments, gsc_per_page, ids)
    opps += rule_ranker_without_claims(assignments, gsc_per_page, ids)
    # rule_thin_but_trafficked retired 2026-04-26 — word count alone is
    # too crude a signal. Claude writes thin-content findings now.
    opps += rule_low_ctr_weak_meta(assignments, gsc_per_page, ids)
    opps += rule_bilingual_gap(by_cluster_content, ids)
    opps += rule_cluster_visibility_lag(cluster_window, ids)
    opps += rule_orphan_longform(assignments, ids)

    # Sort: severity (high > medium > low) → rule priority → URL
    sev_rank = {"high": 0, "medium": 1, "low": 2}
    rule_priority = {
        "RANK_WITHOUT_SCHEMA": 0,
        "CLUSTER_VISIBILITY_LAG": 1,
        "RANKER_WITHOUT_CLAIMS": 2,
        "THIN_BUT_TRAFFICKED": 3,
        "LOW_CTR_WEAK_META": 4,
        "BILINGUAL_GAP": 5,
        "ORPHAN_LONGFORM": 6,
    }
    opps.sort(key=lambda o: (sev_rank.get(o["severity"], 3), rule_priority.get(o["rule"], 99)))

    by_cluster_summary: dict[str, dict[str, int]] = {}
    for o in opps:
        key = f"{o['cluster']}::{o['lang']}"
        entry = by_cluster_summary.setdefault(key, {"opportunities": 0, "high": 0, "medium": 0, "low": 0})
        entry["opportunities"] += 1
        entry[o["severity"]] += 1

    payload = {
        "generated_at": datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
        "window_days": window,
        "source_daily": str(latest_daily.relative_to(_ROOT)),
        "opportunities": opps,
        "by_cluster_summary": by_cluster_summary,
        "rule_definitions": {
            "RANK_WITHOUT_SCHEMA": "Page has ≥50 GSC impressions AND no Article/FAQPage/HowTo schema.",
            "RANKER_WITHOUT_CLAIMS": "Page has ≥50 GSC impressions AND zero numeric claims in body.",
            "THIN_BUT_TRAFFICKED": "Page has ≥30 GA sessions AND word count <500.",
            "LOW_CTR_WEAK_META": "Page has ≥200 impressions, CTR <1%, and missing meta OR short title.",
            "BILINGUAL_GAP": "Cluster has EN content but 0 DE pages (or reverse).",
            "CLUSTER_VISIBILITY_LAG": "Cluster AI visibility <30% AND <5 mentions in window AND has SEO footprint.",
            "ORPHAN_LONGFORM": "Page has >1000 words but <5 internal links.",
        },
    }

    _PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    tmp = _OUT_PATH.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    tmp.replace(_OUT_PATH)
    log.info(
        "wrote %s — %d opportunities (%d high, %d medium, %d low)",
        _OUT_PATH.relative_to(_ROOT),
        len(opps),
        sum(1 for o in opps if o["severity"] == "high"),
        sum(1 for o in opps if o["severity"] == "medium"),
        sum(1 for o in opps if o["severity"] == "low"),
    )
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--window", type=int, default=30,
                        help="Days of daily payloads to roll up (default: 30).")
    args = parser.parse_args(argv)
    run(window=args.window)
    return 0


if __name__ == "__main__":
    sys.exit(main())

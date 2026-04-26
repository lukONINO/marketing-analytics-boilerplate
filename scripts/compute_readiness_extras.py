"""Compute the 4 Readiness dimensions that don't need new data sources.

Why this exists
---------------
The Strategy page lists 6 of Aleyda Solis's 10 Readiness dimensions as
"not yet computed". Four of those six are actually derivable from data
we already pull — this script does that derivation:

  - fresh          ← `last_modified` HTTP header captured by scrape_site.py
  - useful         ← GA4 `userEngagementDuration` per page (data/raw/ga4/)
  - differentiated ← Jaccard distance over `body_text` token sets within
                     each (cluster, lang) — pages that say the same
                     things in similar words score lower
  - transactable   ← URL/schema/body-text signals for pricing + plans

The remaining two (`consistent`, `credible`) genuinely need new data
collection (Wikipedia/G2 scrape, Ahrefs/Moz API) and stay null.

Output
------
    data/processed/readiness_extras.json
    {
      "generated_at": "2026-04-26T...",
      "window_days": 30,
      "scrape_date": "2026-04-24",
      "by_cluster": {
        "whitelabel::en": {
          "fresh": 0.78,
          "useful": 0.62,
          "differentiated": 0.55,
          "transactable": 0.40,
          "page_count": 12,
          "evidence": {
            "fresh_median_days_since_modified": 45,
            "useful_avg_seconds_per_view": 38.2,
            "differentiated_avg_jaccard_distance": 0.55,
            "transactable_pages_with_signals": 5,
            "ga4_pages_matched": 9
          }
        },
        ...
      }
    }

CLI:
    python scripts/compute_readiness_extras.py
    python scripts/compute_readiness_extras.py --window 30
    python scripts/compute_readiness_extras.py --scrape-date 2026-04-24

Reads:
    data/processed/page_clusters.json          (cluster assignments + per-page metadata)
    data/raw/content/<scrape_date>/*.json      (body_text + last_modified per URL)
    data/raw/ga4/<date>.json                   (last `--window` days)

Writes:
    data/processed/readiness_extras.json
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

_CONTENT_DIR = _ROOT / "data" / "raw" / "content"
_GA4_DIR = _ROOT / "data" / "raw" / "ga4"
_PAGE_CLUSTERS = _ROOT / "data" / "processed" / "page_clusters.json"
_OUT_PATH = _ROOT / "data" / "processed" / "readiness_extras.json"

log = logging.getLogger("readiness_extras")
log.addHandler(logging.StreamHandler())
log.setLevel(logging.INFO)


# ---------------------------------------------------------------------
# Tokenisation for "differentiated" — Jaccard over per-page vocab sets
# ---------------------------------------------------------------------
# Stopwords: minimal set covering the most-frequent EN + DE function
# words. Keeping tokenisation deterministic + dependency-free; sklearn
# isn't pulled in just for this.
EN_STOP = {
    "the", "of", "and", "to", "in", "a", "for", "is", "that", "with", "on", "this",
    "as", "by", "be", "or", "an", "are", "at", "from", "you", "we", "our", "your",
    "it", "its", "not", "but", "can", "has", "have", "will", "one", "two", "they",
    "their", "more", "most", "than", "also", "such", "each", "any", "all", "into",
    "use", "used", "using", "new", "like", "via", "make", "makes", "made", "get",
    "what", "when", "where", "which", "while", "many", "much", "some", "every",
    "based", "across", "about", "between", "without", "through", "under", "over",
    "after", "before", "other", "these", "those", "them", "there", "then", "here",
}
DE_STOP = {
    "der", "die", "das", "und", "den", "von", "mit", "ist", "sich", "auf",
    "im", "des", "ein", "eine", "einer", "für", "auch", "nicht", "oder", "aber", "als",
    "wir", "sie", "sind", "bei", "kann", "wie", "es", "aus", "durch", "über", "nur",
    "noch", "zur", "zum", "bis", "dem", "wird", "werden", "haben", "hat", "unsere",
    "unser", "unseres", "damit", "beim", "mehr", "nach", "vor", "vom", "ihre", "ihren",
    "diese", "dieser", "dieses", "diesen", "dass", "wenn", "weil", "doch", "schon",
    "ihr", "ihm", "ihnen", "alle", "allen", "anderen", "andere", "wurde", "wurden",
}
STOP = EN_STOP | DE_STOP

# Per-page vocabulary cap. The top-K most-frequent (post-stopword)
# tokens form the page's "signature". K=120 was tuned empirically — small
# enough that two near-duplicate pages overlap heavily and big enough
# that two genuinely different pages diverge.
_VOCAB_K = 120

_TOKEN_RE = re.compile(r"[a-zA-ZäöüÄÖÜß]{4,}")


def _tokenize(text: str) -> set[str]:
    """Lowercase + alpha-only + drop ≤3-char tokens + drop stopwords.

    Returns the top-K most frequent surviving tokens as a set so
    Jaccard can compare two pages. Deterministic for a given input.
    """
    if not text:
        return set()
    raw = (w.lower() for w in _TOKEN_RE.findall(text))
    counts = Counter(w for w in raw if w not in STOP)
    return {w for w, _ in counts.most_common(_VOCAB_K)}


def _jaccard(a: set[str], b: set[str]) -> float:
    """Standard Jaccard similarity. Returns 0.0 if both sets empty."""
    if not a and not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union > 0 else 0.0


# ---------------------------------------------------------------------
# Transactability signals
# ---------------------------------------------------------------------
# We're not trying to detect "is this a pricing page" precisely. We're
# detecting "does AI have something concrete enough to answer 'which
# plan should I pick' from this page". So we look for monetary patterns,
# plan/tier vocabulary, and explicit comparison cues — any of these
# moves the score, two of them is a confident yes.
_PRICING_RE = re.compile(
    r"(?:€|\$|EUR|USD)\s*\d|"
    r"\d+[\s,.\d]*\s*(?:€|\$|EUR|USD)|"
    r"\b(?:starts?\s*at|ab\s+\d|preise?|pricing|monthly|pro\s*monat|per\s*month|jährlich|yearly|setup\s*fee)\b",
    re.IGNORECASE,
)
_PLAN_RE = re.compile(
    r"\b(?:plan|tier|subscription|paket|basic|starter|premium|business|enterprise|professional)\b",
    re.IGNORECASE,
)
_COMPARE_RE = re.compile(
    r"\b(?:vs\.?|versus|compare[ds]?|comparison|vergleich(?:en)?|alternative[ns]?|wettbewerb)\b",
    re.IGNORECASE,
)
_TXN_SCHEMA = {"Offer", "PriceSpecification", "Product"}
# URL slugs that strongly signal a transactional page even when body
# is thin (e.g. a JS-shell pricing page).
_TXN_URL_TOKENS = ("pricing", "plans", "preise", "preisliste", "tarife", "buy", "kaufen", "subscribe")


def _is_transactable(url: str, body_text: str, schema_types: list[str]) -> bool:
    """Per-page boolean: does this page give AI something concrete to
    quote when asked 'which plan fits me?'."""
    score = 0
    if any(t in (url or "").lower() for t in _TXN_URL_TOKENS):
        score += 2  # strong signal
    if any(s in _TXN_SCHEMA for s in (schema_types or [])):
        score += 2
    body = body_text or ""
    if _PRICING_RE.search(body):
        score += 1
    if _PLAN_RE.search(body):
        score += 1
    if _COMPARE_RE.search(body):
        score += 1
    return score >= 2


# ---------------------------------------------------------------------
# Score-band helpers — keep the bucket logic in one place so tweaks
# don't drift between dimensions.
# ---------------------------------------------------------------------

def _band(value: float, *thresholds: tuple[float, float]) -> float:
    """Map `value` to a 0-1 score using ascending (threshold, score)
    pairs. The first threshold the value beats wins.

    `_band(45, (90, 1.0), (180, 0.7), (365, 0.4))` → 1.0 (≤90 → top band)
    """
    for thr, score in thresholds:
        if value <= thr:
            return score
    return 0.1  # below the worst band — penalise mildly, don't 0-out


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


def _latest_scrape_dir() -> Optional[Path]:
    if not _CONTENT_DIR.exists():
        return None
    dirs = sorted(
        d for d in _CONTENT_DIR.iterdir()
        if d.is_dir() and re.fullmatch(r"\d{4}-\d{2}-\d{2}", d.name)
    )
    return dirs[-1] if dirs else None


def _load_scrape_records(scrape_dir: Path) -> dict[str, dict[str, Any]]:
    """Return per-URL scrape records, keyed by URL.

    Skips _inventory.json + .debug.html files — only per-URL JSONs.
    """
    out: dict[str, dict[str, Any]] = {}
    for f in scrape_dir.glob("*.json"):
        if f.name == "_inventory.json":
            continue
        rec = _load_json(f)
        if not rec or "url" not in rec:
            continue
        out[rec["url"]] = rec
    return out


def _parse_last_modified(raw: Any) -> Optional[datetime]:
    """Parse Last-Modified HTTP header (RFC 2822 date). Returns UTC."""
    if not raw or not isinstance(raw, str):
        return None
    try:
        dt = parsedate_to_datetime(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def _load_ga4_pageviews(window: int) -> dict[str, dict[str, float]]:
    """Sum GA4 page-level metrics over the last `window` days.

    Returns:
        {
          "https://acme.io/foo": {
            "screenPageViews": 230, "userEngagementDuration": 4830,
            "totalUsers": 180
          },
          ...
        }
    """
    if not _GA4_DIR.exists():
        return {}
    files = sorted(_GA4_DIR.glob("*.json"))[-window:]
    acc: dict[str, dict[str, float]] = defaultdict(
        lambda: {"screenPageViews": 0.0, "userEngagementDuration": 0.0, "totalUsers": 0.0},
    )
    for f in files:
        d = _load_json(f) or {}
        for row in d.get("pages") or []:
            url = (row.get("url") or "").rstrip("/")
            if not url:
                continue
            acc[url]["screenPageViews"] += float(row.get("screenPageViews") or 0)
            acc[url]["userEngagementDuration"] += float(row.get("userEngagementDuration") or 0)
            acc[url]["totalUsers"] += float(row.get("totalUsers") or 0)
    return dict(acc)


# ---------------------------------------------------------------------
# Per-dimension cluster scorers
# ---------------------------------------------------------------------

def _score_fresh(scrape_records: list[dict[str, Any]]) -> tuple[Optional[float], Optional[float]]:
    """Median days-since-Last-Modified → 0-1 freshness band.

    Returns (score, median_days). Score is None if no page has a
    last_modified header (we don't fake a fresh score).
    """
    now = datetime.now(timezone.utc)
    days: list[float] = []
    for rec in scrape_records:
        dt = _parse_last_modified(rec.get("last_modified"))
        if dt is None:
            continue
        delta = (now - dt).total_seconds() / 86400.0
        if delta < 0:  # bad clock — skip rather than poison the median
            continue
        days.append(delta)
    if not days:
        return None, None
    days.sort()
    median = days[len(days) // 2]
    score = _band(
        median,
        (90, 1.0),    # ≤3 months → fresh
        (180, 0.7),   # ≤6 months → ok
        (365, 0.4),   # ≤1 year → stale-ish
    )  # > 1 year → 0.1
    return score, median


def _score_useful(
    cluster_pages: list[str],
    ga4_pageviews: dict[str, dict[str, float]],
) -> tuple[Optional[float], Optional[float], int]:
    """Average GA4 engagement seconds per pageview, banded.

    Returns (score, weighted_avg_seconds, ga4_pages_matched). A page
    counts only if it received any GA4 traffic in the window — the
    score reflects engagement quality among pages users actually
    visited, which is the metric we care about ("of the pages people
    landed on, how engaging were they?").
    """
    total_views = 0.0
    total_seconds = 0.0
    matched = 0
    for url in cluster_pages:
        u = url.rstrip("/")
        ga = ga4_pageviews.get(u)
        if not ga or ga["screenPageViews"] <= 0:
            continue
        total_views += ga["screenPageViews"]
        total_seconds += ga["userEngagementDuration"]
        matched += 1
    if total_views <= 0:
        return None, None, 0
    avg = total_seconds / total_views
    # Engagement-per-view bands. _band's ≤ semantics don't fit "higher
    # is better" so we use explicit if/else here.
    if avg >= 60:
        score = 1.0
    elif avg >= 30:
        score = 0.7
    elif avg >= 10:
        score = 0.4
    elif avg > 0:
        score = 0.15
    else:
        score = 0.0
    return score, avg, matched


def _score_differentiated(scrape_records: list[dict[str, Any]]) -> tuple[Optional[float], Optional[float]]:
    """Mean pairwise Jaccard *distance* over per-page token signatures.

    More overlap between pages → less differentiation. Returns
    (score, mean_similarity). Single-page clusters trivially return
    1.0 (a page that's the only one in its cluster can't be a
    duplicate of itself — though it could still be generic, which is
    the next dimension we don't yet model).
    """
    sigs = []
    for rec in scrape_records:
        body = rec.get("body_text") or ""
        if len(body) < 200:  # too thin to score reliably
            continue
        sig = _tokenize(body)
        if len(sig) >= 30:  # need enough vocab to compare
            sigs.append(sig)
    if not sigs:
        return None, None
    if len(sigs) == 1:
        return 1.0, 0.0  # trivially differentiated
    sims: list[float] = []
    for i in range(len(sigs)):
        for j in range(i + 1, len(sigs)):
            sims.append(_jaccard(sigs[i], sigs[j]))
    if not sims:
        return None, None
    mean_sim = sum(sims) / len(sims)
    # Distance is the score; clamp to 0-1.
    score = max(0.0, min(1.0, 1.0 - mean_sim))
    return score, mean_sim


def _score_transactable(
    cluster_pages: list[str],
    scrape_records_by_url: dict[str, dict[str, Any]],
) -> tuple[float, int]:
    """% of pages in the cluster that hit the transactability bar."""
    if not cluster_pages:
        return 0.0, 0
    hits = 0
    counted = 0
    for url in cluster_pages:
        rec = scrape_records_by_url.get(url)
        if not rec:
            continue
        counted += 1
        if _is_transactable(
            rec.get("url") or url,
            rec.get("body_text") or "",
            rec.get("schema_types") or [],
        ):
            hits += 1
    if counted == 0:
        return 0.0, 0
    return hits / counted, hits


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--window", type=int, default=30, help="GA4 window in days")
    parser.add_argument(
        "--scrape-date",
        default=None,
        help="YYYY-MM-DD scrape directory under data/raw/content/. Defaults to latest.",
    )
    args = parser.parse_args()

    page_clusters = _load_json(_PAGE_CLUSTERS)
    if not page_clusters or "assignments" not in page_clusters:
        log.error("page_clusters.json missing or empty — run assign_clusters.py first.")
        return 1

    if args.scrape_date:
        scrape_dir = _CONTENT_DIR / args.scrape_date
        if not scrape_dir.exists():
            log.error("scrape dir not found: %s", scrape_dir)
            return 1
    else:
        scrape_dir = _latest_scrape_dir()
        if scrape_dir is None:
            log.error("no scrape directory in %s", _CONTENT_DIR)
            return 1

    log.info("scrape_dir=%s window=%dd", scrape_dir, args.window)

    scrape_records = _load_scrape_records(scrape_dir)
    log.info("loaded %d scrape records", len(scrape_records))

    ga4_pageviews = _load_ga4_pageviews(args.window)
    log.info("loaded GA4 metrics for %d distinct URLs over %d days", len(ga4_pageviews), args.window)

    # Group assignments by (cluster, lang).
    by_key: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for a in page_clusters["assignments"]:
        cluster = a.get("cluster")
        lang = a.get("lang")
        if not cluster or not lang:
            continue
        by_key[f"{cluster}::{lang}"].append(a)

    out_clusters: dict[str, dict[str, Any]] = {}
    for key, assignments in by_key.items():
        urls = [a["url"] for a in assignments if a.get("url")]
        recs = [scrape_records[u] for u in urls if u in scrape_records]

        fresh_score, fresh_median = _score_fresh(recs)
        useful_score, useful_avg, ga4_matched = _score_useful(urls, ga4_pageviews)
        diff_score, diff_sim = _score_differentiated(recs)
        txn_score, txn_hits = _score_transactable(urls, scrape_records)

        out_clusters[key] = {
            "page_count": len(urls),
            "fresh": fresh_score,
            "useful": useful_score,
            "differentiated": diff_score,
            "transactable": txn_score,
            "evidence": {
                "fresh_median_days_since_modified": (
                    round(fresh_median, 1) if fresh_median is not None else None
                ),
                "useful_avg_seconds_per_view": (
                    round(useful_avg, 1) if useful_avg is not None else None
                ),
                "differentiated_avg_jaccard_similarity": (
                    round(diff_sim, 3) if diff_sim is not None else None
                ),
                "transactable_pages_with_signals": txn_hits,
                "ga4_pages_matched": ga4_matched,
                "scrape_records_matched": len(recs),
            },
        }

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "window_days": args.window,
        "scrape_date": scrape_dir.name,
        "by_cluster": out_clusters,
    }

    _OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _OUT_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(_OUT_PATH)
    log.info("wrote %s (%d clusters)", _OUT_PATH, len(out_clusters))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Assign every scraped site URL to exactly one topic cluster + language.

Why this exists
---------------
Once scrape_site.py has run, we have rich per-page content (title, H1,
body_text, schema, numeric_claims). The dashboard's new Topic Clusters
view groups metrics by (cluster, lang), and the Insights page's
"AI Visibility Improvements" panel needs to know which pages belong
to which cluster so it can flag content gaps inside each one.

This script writes a single join table:

    data/processed/page_clusters.json
    {
      "generated_at": "...",
      "source_inventory": "data/raw/content/2026-04-23/_inventory.json",
      "assignments": [
        {
          "url": "https://acme.io/blog/build-vs-buy-...",
          "cluster": "whitelabel",
          "lang": "en",
          "confidence": "url_pattern" | "body_keyword" | "default",
          "title": "...",
          "word_count": 1578,
          "schema_types": ["Article", ...],
          "numeric_claims_count": 6,
          "has_meta_description": true,
          "has_h1": true,
          "internal_links": 119,
          "external_links": 12
        },
        ...
      ],
      "unassigned": ["url1", "url2", ...],
      "by_cluster": {                    # precomputed rollup by (cluster, lang)
        "whitelabel::en": { "page_count": 6, "avg_word_count": 1420,
                            "schema_article_pct": 0.83, "pages_with_claims_pct": 1.0,
                            "pages_missing_meta_pct": 0.17, "thin_pages_pct": 0.17 },
        ...
      }
    }

Assignment algorithm (in order, first match wins):
  1. URL path match against cluster.ga4_path_patterns for the detected lang
     (regex, case-insensitive). This is the highest-confidence signal —
     we wrote the patterns to match real URLs.
  2. URL path match against *any* lang's patterns (sometimes a page is
     bilingual-ambiguous — e.g. /pricing with no /de prefix).
  3. Body-text keyword match against cluster.gsc_query_patterns[lang]:
     count pattern hits in the body; cluster with highest hit count wins.
     Used for /blog pages the URL doesn't signal strongly.
  4. Fallback: assign to "company-clients-proof" — the catch-all for
     ambiguous corporate pages. Logged as `confidence: "default"`.

Language detection:
  - Primary: URL path. /de/ prefix → "de", else "en".
  - Fallback: the scraped <html lang> attribute when URL path is
    ambiguous.

CLI:
    python scripts/assign_clusters.py                      # latest scrape
    python scripts/assign_clusters.py --date 2026-04-23    # specific date
    python scripts/assign_clusters.py --dry-run            # print, don't write
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

import yaml

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

_CLUSTERS_CONFIG = _ROOT / "config" / "topic_clusters.yaml"
_CONTENT_DIR = _ROOT / "data" / "raw" / "content"
_OUT_DIR = _ROOT / "data" / "processed"
_DEFAULT_CLUSTER = "company-clients-proof"

log = logging.getLogger("assign_clusters")
log.addHandler(logging.StreamHandler())
log.setLevel(logging.INFO)


# ---------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------

@dataclass
class CompiledCluster:
    slug: str
    name_en: str
    name_de: str
    peec_topic_ids: list[str]
    # Precompiled regexes per lang so we don't re-compile on every URL.
    ga4_paths: dict[str, list[re.Pattern[str]]] = field(default_factory=dict)
    gsc_queries: dict[str, list[re.Pattern[str]]] = field(default_factory=dict)


def load_clusters(path: Path = _CLUSTERS_CONFIG) -> list[CompiledCluster]:
    if not path.exists():
        raise FileNotFoundError(
            f"{path} missing — cluster config required. "
            "Expected topic_clusters.yaml at config root."
        )
    with path.open("r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    out: list[CompiledCluster] = []
    for c in raw.get("clusters", []) or []:
        out.append(
            CompiledCluster(
                slug=c["slug"],
                name_en=c.get("names", {}).get("en") or c["slug"],
                name_de=c.get("names", {}).get("de") or c["slug"],
                peec_topic_ids=c.get("peec_topic_ids", []) or [],
                ga4_paths={
                    "en": [re.compile(p) for p in (c.get("ga4_path_patterns", {}) or {}).get("en", []) or []],
                    "de": [re.compile(p) for p in (c.get("ga4_path_patterns", {}) or {}).get("de", []) or []],
                },
                gsc_queries={
                    "en": [re.compile(p) for p in (c.get("gsc_query_patterns", {}) or {}).get("en", []) or []],
                    "de": [re.compile(p) for p in (c.get("gsc_query_patterns", {}) or {}).get("de", []) or []],
                },
            )
        )
    if not out:
        raise ValueError("topic_clusters.yaml loaded but no clusters defined.")
    return out


# ---------------------------------------------------------------------
# Inventory loading
# ---------------------------------------------------------------------

def find_latest_inventory() -> Path:
    """Walk data/raw/content/<date>/_inventory.json and return the newest."""
    if not _CONTENT_DIR.exists():
        raise FileNotFoundError(
            f"{_CONTENT_DIR} missing — run scripts/scrape_site.py first."
        )
    dates = sorted(
        (p for p in _CONTENT_DIR.iterdir() if p.is_dir()),
        key=lambda p: p.name,
        reverse=True,
    )
    for d in dates:
        inv = d / "_inventory.json"
        if inv.exists():
            return inv
    raise FileNotFoundError("No _inventory.json found under data/raw/content/.")


def load_inventory(inv_path: Path) -> tuple[list[dict[str, Any]], Path]:
    """Return (per-page records, dir). Per-page files live next to _inventory."""
    with inv_path.open("r", encoding="utf-8") as f:
        inv = json.load(f)
    date_dir = inv_path.parent
    # Expand each page in the inventory to the full per-URL record so we
    # can read body_text for keyword matching. The inventory itself only
    # has a summary projection.
    pages_full: list[dict[str, Any]] = []
    for p in inv.get("pages", []) or []:
        url = p.get("url")
        if not url:
            continue
        slug = _slug_for(url)
        record_path = date_dir / f"{slug}.json"
        if not record_path.exists():
            log.warning("missing per-page record: %s", record_path)
            continue
        try:
            with record_path.open("r", encoding="utf-8") as f:
                pages_full.append(json.load(f))
        except json.JSONDecodeError as e:
            log.warning("bad JSON in %s: %s", record_path, e)
    return pages_full, date_dir


def _slug_for(url: str) -> str:
    """Mirror scrape_site.py's slug rule so we find per-page files."""
    u = urlparse(url)
    path = (u.path or "/").strip("/")
    if not path:
        path = "index"
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "_", path)
    return slug[:120]


# ---------------------------------------------------------------------
# Language + cluster detection
# ---------------------------------------------------------------------

def detect_lang(record: dict[str, Any]) -> str:
    """Return 'en' or 'de'. URL prefix is authoritative for bilingual sites.

    Previously: preferred the scraped <html lang> attribute. Bug: when
    the CDN returns the JS shell instead of the rendered page (see
    scrape_site.py _looks_like_shell), the shell's <html> declares
    `lang="en-US"` regardless of the target URL — so DE pages scraped
    during a cold-cache window got mis-classified as EN.

    Fix: trust the URL prefix. `/de/*` is always DE on bilingual sites
    that use a /de/ subpath convention. The HTML lang attribute is only
    consulted as a backup when the URL path is ambiguous (e.g.
    /legal/imprint with no /de/ prefix but the page is actually a DE
    variant — rare).
    """
    url = record.get("url") or ""
    u = urlparse(url)
    if u.path.startswith("/de/") or u.path == "/de":
        return "de"
    # No /de/ prefix — use the HTML lang as a secondary signal, but it's
    # unusual for a non-/de/ URL to be German on a /de/-convention site.
    lang_raw = (record.get("lang") or "").lower()
    if lang_raw.startswith("de"):
        return "de"
    return "en"


def assign_cluster(
    record: dict[str, Any],
    lang: str,
    clusters: list[CompiledCluster],
) -> tuple[str, str]:
    """Return (cluster_slug, confidence). See algorithm in module docstring."""
    url = record.get("url") or ""
    path = urlparse(url).path or "/"
    body = (record.get("body_text") or "").lower()

    # 1. URL path match against same-lang patterns.
    for c in clusters:
        for p in c.ga4_paths.get(lang, []):
            if p.search(path):
                return c.slug, "url_pattern"

    # 2. URL path match against *any* lang's patterns (handles /pricing etc).
    for c in clusters:
        for other_lang in ("en", "de"):
            if other_lang == lang:
                continue
            for p in c.ga4_paths.get(other_lang, []):
                if p.search(path):
                    return c.slug, "url_pattern_cross_lang"

    # 3. Body-text keyword match — count hits per cluster, pick max.
    if body:
        hits: Counter[str] = Counter()
        for c in clusters:
            for p in c.gsc_queries.get(lang, []):
                n = len(p.findall(body))
                if n:
                    hits[c.slug] += n
        if hits:
            top_slug, top_count = hits.most_common(1)[0]
            # Require at least 3 hits so a single incidental mention doesn't
            # drag a page into the wrong cluster.
            if top_count >= 3:
                return top_slug, "body_keyword"

    # 4. Fallback.
    return _DEFAULT_CLUSTER, "default"


# ---------------------------------------------------------------------
# Rollup
# ---------------------------------------------------------------------

def rollup_by_cluster(
    assignments: list[dict[str, Any]],
) -> dict[str, dict[str, float | int]]:
    """Aggregate page-level content signals by (cluster, lang).

    Fields produced per cluster::lang key:
      - page_count
      - avg_word_count
      - schema_article_pct (fraction with Article or BlogPosting)
      - pages_with_claims_pct (fraction with ≥1 numeric_claim)
      - pages_missing_meta_pct
      - pages_missing_h1_pct
      - thin_pages_pct (<300 words, same threshold as inventory)

    These feed the "AI Visibility Improvements" panel — each % answers
    a concrete content-quality question the panel surfaces.
    """
    by_key: dict[str, list[dict[str, Any]]] = {}
    for a in assignments:
        key = f"{a['cluster']}::{a['lang']}"
        by_key.setdefault(key, []).append(a)

    out: dict[str, dict[str, float | int]] = {}
    for key, rows in by_key.items():
        n = len(rows)
        if n == 0:
            continue
        total_words = sum(r.get("word_count", 0) or 0 for r in rows)
        with_article = sum(
            1
            for r in rows
            if any(
                t in (r.get("schema_types") or [])
                for t in ("Article", "BlogPosting", "NewsArticle")
            )
        )
        with_claims = sum(1 for r in rows if (r.get("numeric_claims_count") or 0) > 0)
        missing_meta = sum(1 for r in rows if not r.get("has_meta_description"))
        missing_h1 = sum(1 for r in rows if not r.get("has_h1"))
        thin = sum(1 for r in rows if (r.get("word_count") or 0) < 300)
        out[key] = {
            "page_count": n,
            "avg_word_count": round(total_words / n) if n else 0,
            "schema_article_pct": round(with_article / n, 3),
            "pages_with_claims_pct": round(with_claims / n, 3),
            "pages_missing_meta_pct": round(missing_meta / n, 3),
            "pages_missing_h1_pct": round(missing_h1 / n, 3),
            "thin_pages_pct": round(thin / n, 3),
        }
    return out


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

def run(inv_path: Path, dry_run: bool = False) -> dict[str, Any]:
    clusters = load_clusters()
    pages, _date_dir = load_inventory(inv_path)
    log.info("loaded %d pages from %s", len(pages), inv_path.name)

    assignments: list[dict[str, Any]] = []
    unassigned: list[str] = []
    confidence_counts: Counter[str] = Counter()

    for rec in pages:
        url = rec.get("url")
        if not url:
            continue
        # Pages that errored out during scrape have word_count 0 and no body.
        # Still assign them (URL pattern can classify even empty pages) so
        # the dashboard sees them, but mark confidence honestly.
        lang = detect_lang(rec)
        cluster, conf = assign_cluster(rec, lang, clusters)
        confidence_counts[conf] += 1

        # Pair URL from hreflang alternates when available. The page's
        # lang tells us which *other* alternate is its counterpart
        # (i.e. if this page is EN, the pair URL is the DE alternate).
        alternates = rec.get("hreflang_alternates") or {}
        pair_url: Optional[str] = None
        if lang == "en" and alternates.get("de"):
            pair_url = alternates["de"]
        elif lang == "de" and alternates.get("en"):
            pair_url = alternates["en"]

        assignments.append(
            {
                "url": url,
                "cluster": cluster,
                "lang": lang,
                "confidence": conf,
                "title": rec.get("title"),
                "word_count": rec.get("word_count") or 0,
                "schema_types": rec.get("schema_types") or [],
                "numeric_claims_count": len(rec.get("numeric_claims") or []),
                "has_meta_description": bool(rec.get("meta_description")),
                "has_h1": bool(rec.get("h1")),
                "internal_links": rec.get("internal_links") or 0,
                "external_links": rec.get("external_links") or 0,
                "translation_pair_url": pair_url,
            }
        )
        if conf == "default":
            unassigned.append(url)

    by_cluster = rollup_by_cluster(assignments)
    payload = {
        "generated_at": datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
        "source_inventory": str(inv_path.relative_to(_ROOT)),
        "confidence_counts": dict(confidence_counts),
        "assignments": assignments,
        "unassigned": unassigned,
        "by_cluster": by_cluster,
    }

    log.info(
        "assigned %d pages — url_pattern=%d, cross_lang=%d, body_keyword=%d, default=%d",
        len(assignments),
        confidence_counts["url_pattern"],
        confidence_counts["url_pattern_cross_lang"],
        confidence_counts["body_keyword"],
        confidence_counts["default"],
    )
    if unassigned:
        log.info("defaulted (review): %d URLs → first few: %s",
                 len(unassigned), unassigned[:5])

    if dry_run:
        log.info("dry-run: not writing output")
        return payload

    _OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = _OUT_DIR / "page_clusters.json"
    tmp = out_path.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    tmp.replace(out_path)
    log.info("wrote %s", out_path.relative_to(_ROOT))
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--date",
        help="YYYY-MM-DD — specific scrape date (default: latest).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print assignments; skip writing page_clusters.json.",
    )
    args = parser.parse_args(argv)

    if args.date:
        inv_path = _CONTENT_DIR / args.date / "_inventory.json"
        if not inv_path.exists():
            log.error("no inventory at %s", inv_path)
            return 1
    else:
        inv_path = find_latest_inventory()

    run(inv_path, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())

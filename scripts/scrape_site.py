"""Scrape every page on the site (sitemap-driven) and save per-URL content + metadata.

Why this exists
---------------
The dashboard already shows cross-channel traffic + AI-visibility signals
per URL, but nothing about the content ON those URLs. For GEO work
we need to know:

  - Which pages have schema markup (FAQPage, HowTo, Article, etc.)
  - Which pages have quantified proof points ($N processed, N customers)
  - Which pages are thin (< 300 words)
  - What the full body text looks like so Claude can analyze it later

This script writes:

    data/raw/content/<YYYY-MM-DD>/<slug>.json   — one file per URL
    data/raw/content/<YYYY-MM-DD>/_inventory.json — window rollup

Output schema per URL
---------------------
{
  "url":              "https://acme.io/de/produkt/whitelabel",
  "fetched_at":       "2026-04-24T...",
  "status":           200,
  "title":            "White-Label-Plattform…",
  "meta_description": "...",
  "h1":               "...",
  "lang":             "de",
  "word_count":       1824,
  "heading_count":    { "h1": 1, "h2": 6, "h3": 12 },
  "schema_types":     ["Organization", "BreadcrumbList"],
  "numeric_claims":   [ { "pattern": "monetary", "text": "$32B processed", "context": "..." }, ... ],
  "internal_links":   12,
  "external_links":    3,
  "last_modified":    null,
  "body_text":        "The full extracted main-content text (via trafilatura) …",
  "raw_html_size":    142_337
}

Configuration
-------------
The site origin is read from the ``SITE_CANONICAL_ORIGIN`` env var
(default: ``https://acme.io``). The default sitemap path is
``<origin>/sitemap.xml``; override with ``--sitemap``.

CLI:
    python scripts/scrape_site.py
    python scripts/scrape_site.py --sitemap https://acme.io/sitemap.xml
    python scripts/scrape_site.py --url https://acme.io/de/produkt/whitelabel  # single URL
    python scripts/scrape_site.py --max 10                                       # cap pages
    python scripts/scrape_site.py --dry-run                                      # list URLs only
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional
from urllib.parse import urljoin, urlparse

import requests
import trafilatura
from bs4 import BeautifulSoup

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


def _site_origin() -> str:
    """Return the configured site canonical origin (no trailing slash)."""
    return os.environ.get("SITE_CANONICAL_ORIGIN", "https://acme.io").rstrip("/")


def _default_sitemap() -> str:
    """Return the default sitemap URL for the configured origin."""
    return _site_origin() + "/sitemap.xml"


_CONTENT_DIR = _ROOT / "data" / "raw" / "content"
# Some CMS / CDN combos (Webflow + Cloudflare, Framer + Vercel edge)
# serve a lean "shell" HTML without the main content when the UA looks
# like a bot. They only inline the body content for User-Agent strings
# that look like real browsers. Since this is your own site and you
# explicitly want the full rendered content, spoof a current Chrome UA.
# We also accept gzip so large HTML bodies don't get truncated on wire.
_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
_HEADERS = {
    "User-Agent": _UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,de;q=0.8",
    # NOTE: do NOT advertise "br" (Brotli) here. The `requests` library only
    # decodes gzip + deflate out of the box; if we claim Brotli support and
    # the CDN (Cloudflare) picks it, we get back raw Brotli bytes that
    # resp.text decodes as garbage — every parser then silently extracts
    # nothing.
    "Accept-Encoding": "gzip, deflate",
    "Cache-Control": "no-cache",
}
# Some sites are SSR'd through a CDN that falls back to a CSR shell when
# the cache is cold. Hitting too fast (~0.3s per request) can trip into
# shell-page responses. 1.0s is empirically reliable. If you see lots of
# shell-page warnings in the log, bump this to 2.0 or lower the --max flag.
_POLITE_DELAY = 1.0
# Max retries when we detect a shell page (page has 200 OK but zero
# extractable content). Exponential-ish backoff — first retry waits 3s,
# second waits 6s — giving the CDN time to warm the SSR cache for that URL.
_SHELL_RETRY_MAX = 2
_SHELL_RETRY_BASE_DELAY = 3.0

# Generic site-wide <title> + meta_description that signal the CDN
# returned the bare app shell instead of the rendered page. Override
# via the SITE_GENERIC_TITLE env var if your site's shell title is
# different from the default below.
_GENERIC_SITE_TITLE = os.environ.get(
    "SITE_GENERIC_TITLE", "Acme - Tokenized Financing Platform"
)
# Page-level schema types. Their presence means the HTML was rendered
# properly; their absence on a /blog/ URL is a strong shell signal.
_PAGE_SCHEMA_TYPES = frozenset(
    {"Article", "BlogPosting", "NewsArticle", "TechArticle", "WebPage"}
)

log = logging.getLogger("scrape_site")
log.addHandler(logging.StreamHandler())
log.setLevel(logging.INFO)


# ---------------------------------------------------------------------
# Data shape
# ---------------------------------------------------------------------

@dataclass
class ContentRecord:
    url: str
    fetched_at: str
    status: int
    title: Optional[str] = None
    meta_description: Optional[str] = None
    h1: Optional[str] = None
    lang: Optional[str] = None
    word_count: int = 0
    heading_count: dict[str, int] = field(default_factory=dict)
    schema_types: list[str] = field(default_factory=list)
    numeric_claims: list[dict[str, str]] = field(default_factory=list)
    internal_links: int = 0
    external_links: int = 0
    last_modified: Optional[str] = None
    body_text: Optional[str] = None
    raw_html_size: int = 0
    error: Optional[str] = None
    # Map of hreflang code ("en", "de", "x-default", etc.) → absolute URL
    # extracted from <link rel="alternate" hreflang="..." href="..."> tags
    # in the HTML <head>. The translated counterpart (for this page's lang)
    # is the pair used by the dashboard's cluster-override UI to auto-move
    # EN↔DE blog pages together. Empty dict when no alternates declared.
    hreflang_alternates: dict[str, str] = field(default_factory=dict)


# ---------------------------------------------------------------------
# Sitemap
# ---------------------------------------------------------------------

def fetch_sitemap_urls(sitemap_url: str) -> list[str]:
    """Parse a sitemap (or sitemap index) and return unique page URLs.

    Handles both <sitemapindex> (links to other sitemaps) and <urlset>
    (actual page list). Recursion depth is capped at 3 — deeper nesting
    is never seen in practice.
    """
    return sorted(set(_walk_sitemap(sitemap_url, depth=0, max_depth=3)))


def _walk_sitemap(sitemap_url: str, depth: int, max_depth: int) -> Iterable[str]:
    if depth > max_depth:
        return
    log.info("fetching sitemap: %s", sitemap_url)
    try:
        resp = requests.get(sitemap_url, headers=_HEADERS, timeout=20)
        resp.raise_for_status()
    except Exception as e:  # noqa: BLE001
        log.warning("sitemap fetch failed: %s (%s)", sitemap_url, e)
        return

    soup = BeautifulSoup(resp.content, "xml")

    # Sitemap index — yields sub-sitemap URLs to recurse into.
    for sm in soup.find_all("sitemap"):
        loc = sm.find("loc")
        if loc and loc.text:
            yield from _walk_sitemap(loc.text.strip(), depth + 1, max_depth)

    # URL set — actual page URLs.
    for u in soup.find_all("url"):
        loc = u.find("loc")
        if loc and loc.text:
            yield loc.text.strip()


# ---------------------------------------------------------------------
# Page scraping
# ---------------------------------------------------------------------

# Patterns that catch the kinds of quantified claims AI summarizers weight
# heavily. Kept narrow — we want real proof points, not arbitrary numbers.
# The regulatory pattern is intentionally generic (common security/data
# certifications); customize for your industry's regulators if needed.
_CLAIM_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("monetary", re.compile(r"\$\s?\d[\d,.]*\s?(?:billion|million|B|M|k|K)?|\€\s?\d[\d,.]*\s?(?:billion|million|B|M|k|K)?|\d[\d,.]*\s?(?:Mio|Mrd|Milliarden|Millionen)", re.IGNORECASE)),
    ("percentage", re.compile(r"\d+(?:\.\d+)?\s?%")),
    ("count", re.compile(r"\b(?:over|more than|mehr als|über)\s+\d[\d,.]*\+?\b", re.IGNORECASE)),
    ("regulatory", re.compile(r"\b(?:GDPR|MiFID|ISO\s?\d+|SOC\s?\d+|HIPAA|PCI[-\s]?DSS|FedRAMP)[\w\-]*\b")),
    ("timeframe", re.compile(r"\b\d+\s?(?:hour|hours|day|days|week|weeks|Stunden|Tage|Wochen)\b", re.IGNORECASE)),
]

_CONTEXT_CHARS = 90  # around each claim, for human review


def _looks_like_shell(record: ContentRecord, url: str) -> bool:
    """Detect the CDN-served JS shell (no rendered page content).

    Returns True when:
      - status is 200 (clean HTTP response), AND
      - word_count is 0 (nothing extractable), AND
      - title is missing OR matches the site-wide default, AND
      - no page-level schema (Article / BlogPosting / WebPage) present.

    We don't want to retry genuinely-thin pages (e.g. a /demo booking
    form that's legitimately 50 words), hence the title + schema check.
    Thin content pages still have page-specific titles and BlogPosting
    schema; shell responses have the generic site title and only the
    site-wide Organization / WebSite schema.
    """
    if record.status != 200:
        return False
    if record.word_count > 0:
        return False
    title_is_generic = (
        record.title is None
        or record.title.strip() == _GENERIC_SITE_TITLE
    )
    if not title_is_generic:
        return False
    has_page_schema = any(t in _PAGE_SCHEMA_TYPES for t in record.schema_types)
    return not has_page_schema


def scrape_url(url: str, session: requests.Session) -> tuple[ContentRecord, Optional[str]]:
    """Wrapper around `_scrape_once` with shell-page retry.

    If the CDN returns the JS shell (detected via `_looks_like_shell`),
    wait a few seconds and try again — the second hit usually catches
    the URL once the SSR cache has warmed. Logs a warning for each
    retry so batch runs make the flakiness visible.
    """
    attempts = 0
    last_record, last_html = _scrape_once(url, session)
    while _looks_like_shell(last_record, url) and attempts < _SHELL_RETRY_MAX:
        attempts += 1
        delay = _SHELL_RETRY_BASE_DELAY * attempts
        log.warning(
            "shell response for %s (attempt %d/%d) — waiting %.1fs and retrying",
            url,
            attempts,
            _SHELL_RETRY_MAX,
            delay,
        )
        time.sleep(delay)
        last_record, last_html = _scrape_once(url, session)
    if attempts > 0 and not _looks_like_shell(last_record, url):
        log.info("recovered from shell response for %s after %d retr%s",
                 url, attempts, "y" if attempts == 1 else "ies")
    return last_record, last_html


def _scrape_once(url: str, session: requests.Session) -> tuple[ContentRecord, Optional[str]]:
    """Single-attempt fetch + parse. Callers should use `scrape_url` instead
    (wraps this with shell-page retry). Split out so the retry loop can
    re-dispatch cleanly without re-entering the public entry point.

    Returns (record, raw_html). raw_html is None when the request failed
    before we got a body; otherwise it's the decoded HTML string used for
    parsing. Callers pass raw_html into write_record so the diagnostic
    dump can fire when extraction yields nothing.
    """
    record = ContentRecord(
        url=url,
        fetched_at=datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
        status=0,
    )
    html: Optional[str] = None
    try:
        resp = session.get(url, headers=_HEADERS, timeout=20, allow_redirects=True)
        record.status = resp.status_code
        record.raw_html_size = len(resp.content)

        if resp.status_code >= 400:
            record.error = f"HTTP {resp.status_code}"
            return record, None

        # Force UTF-8 decoding. `requests` falls back to ISO-8859-1 when the
        # HTTP Content-Type doesn't declare a charset, which mangles em-dashes
        # (18–36 → 18â36) and quotes on many UTF-8 sites. Most modern sites
        # are UTF-8 everywhere, and this is a local scraper for known content,
        # so forcing is safe and cleaner than chardet guessing.
        resp.encoding = "utf-8"
        html = resp.text
        soup = BeautifulSoup(html, "lxml")

        # <html lang="xx">
        html_tag = soup.find("html")
        if html_tag and html_tag.get("lang"):
            record.lang = html_tag["lang"]

        # <title>
        if soup.title and soup.title.string:
            record.title = soup.title.string.strip()

        # <meta name="description">
        meta = soup.find("meta", attrs={"name": "description"})
        if meta and meta.get("content"):
            record.meta_description = meta["content"].strip()

        # Fallback: open graph description
        if not record.meta_description:
            og = soup.find("meta", attrs={"property": "og:description"})
            if og and og.get("content"):
                record.meta_description = og["content"].strip()

        # Heading counts + first H1
        heading_count: dict[str, int] = {}
        for level in ("h1", "h2", "h3", "h4", "h5", "h6"):
            tags = soup.find_all(level)
            if tags:
                heading_count[level] = len(tags)
                if level == "h1" and not record.h1:
                    record.h1 = tags[0].get_text(strip=True)
        record.heading_count = heading_count

        # Schema types from JSON-LD blocks.
        schema_types: list[str] = []
        for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
            try:
                data = json.loads(script.string or "{}")
            except json.JSONDecodeError:
                continue
            # @type may be on a single object or a list of objects, or nested
            schema_types.extend(_extract_types(data))
        record.schema_types = sorted(set(schema_types))

        # hreflang alternates — <link rel="alternate" hreflang="..." href="...">
        # in <head>. Gives the dashboard's translation-pair detection an
        # exact EN↔DE URL mapping, replacing the fuzzy title-match
        # heuristic. Bilingual sites typically declare at least "en" and
        # "de" alternates (plus optionally "x-default"). Self-referential
        # alternates (lang = this page's lang) are included; the consumer
        # filters them out.
        hreflang_alternates: dict[str, str] = {}
        for link in soup.find_all("link", attrs={"rel": "alternate"}):
            href = link.get("href")
            hreflang = link.get("hreflang")
            if not href or not hreflang:
                continue
            # Normalize "en-US" → "en", leave "x-default" alone.
            hreflang_lower = hreflang.lower().strip()
            code = (
                hreflang_lower.split("-")[0]
                if hreflang_lower != "x-default"
                else "x-default"
            )
            hreflang_alternates[code] = urljoin(url, href)
        record.hreflang_alternates = hreflang_alternates

        # Internal vs external link count.
        page_host = urlparse(url).hostname or ""
        int_count = 0
        ext_count = 0
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if href.startswith("#") or href.startswith("mailto:") or href.startswith("tel:"):
                continue
            absolute = urljoin(url, href)
            host = urlparse(absolute).hostname or ""
            if host == page_host or host.endswith(f".{page_host.split('.', 1)[-1]}") if "." in page_host else host == page_host:
                int_count += 1
            else:
                ext_count += 1
        record.internal_links = int_count
        record.external_links = ext_count

        # Last-Modified header (may or may not be set; Webflow/Framer
        # typically don't set it, but worth capturing when present).
        if "last-modified" in resp.headers:
            record.last_modified = resp.headers["last-modified"]

        # Main body text via trafilatura — strips nav, footer, scripts.
        body = trafilatura.extract(
            html,
            include_comments=False,
            include_tables=False,
            favor_precision=True,
            url=url,
        ) or ""
        record.body_text = body.strip() or None
        record.word_count = len(body.split()) if body else 0

        # Numeric claims — scan the body text (not raw HTML) so we don't
        # match inside scripts/CSS or boilerplate.
        if record.body_text:
            record.numeric_claims = _extract_claims(record.body_text)

    except requests.RequestException as e:
        record.error = f"request failed: {e}"
    except Exception as e:  # noqa: BLE001 — we record and continue
        record.error = f"parse failed: {e}"
    return record, html


def _extract_types(node: Any) -> list[str]:
    """Walk a JSON-LD value and collect all @type strings."""
    out: list[str] = []
    if isinstance(node, dict):
        t = node.get("@type")
        if isinstance(t, str):
            out.append(t)
        elif isinstance(t, list):
            out.extend(x for x in t if isinstance(x, str))
        for v in node.values():
            out.extend(_extract_types(v))
    elif isinstance(node, list):
        for v in node:
            out.extend(_extract_types(v))
    return out


def _extract_claims(text: str) -> list[dict[str, str]]:
    """Find numeric / regulatory claims plus a small context window.

    Dedupes identical matches on the same page so we don't drown in
    repeated regulator hits — one per unique match string per page.
    """
    seen: set[tuple[str, str]] = set()
    out: list[dict[str, str]] = []
    for label, pattern in _CLAIM_PATTERNS:
        for m in pattern.finditer(text):
            match_text = m.group(0).strip()
            key = (label, match_text.lower())
            if key in seen:
                continue
            seen.add(key)
            start = max(0, m.start() - _CONTEXT_CHARS)
            end = min(len(text), m.end() + _CONTEXT_CHARS)
            ctx = text[start:end].replace("\n", " ").strip()
            out.append({"pattern": label, "text": match_text, "context": ctx})
    return out


# ---------------------------------------------------------------------
# Disk IO
# ---------------------------------------------------------------------

def _slug_for(url: str) -> str:
    """Turn a URL into a filesystem-safe slug for the per-URL file."""
    u = urlparse(url)
    path = (u.path or "/").strip("/")
    if not path:
        path = "index"
    # Replace slashes + unsafe chars.
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "_", path)
    return slug[:120]  # cap length


def write_record(out_dir: Path, record: ContentRecord, raw_html: Optional[str] = None) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{_slug_for(record.url)}.json"
    tmp = path.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(asdict(record), f, ensure_ascii=False, indent=2)
    tmp.replace(path)

    # Diagnostic: if the page returned 200 but extraction yielded nothing,
    # dump the raw HTML next to the JSON so we can inspect *why*. This
    # distinguishes a Cloudflare challenge (no <title>, no <h1>, ~40 KB JS
    # scaffold) from a CSR shell (<div id="root"></div>) from a parser bug.
    # Silent when extraction succeeds.
    if (
        raw_html is not None
        and record.status == 200
        and record.word_count == 0
    ):
        debug_path = out_dir / f"{_slug_for(record.url)}.debug.html"
        debug_path.write_text(raw_html, encoding="utf-8")

    return path


def write_inventory(out_dir: Path, records: list[ContentRecord]) -> Path:
    """Summary rollup — used by the dashboard and the drafts skill."""
    total = len(records)
    ok = [r for r in records if r.status == 200]
    schema_coverage: dict[str, int] = {}
    for r in ok:
        for t in r.schema_types:
            schema_coverage[t] = schema_coverage.get(t, 0) + 1
    thin_pages = [r.url for r in ok if r.word_count < 300]
    pages_with_claims = [r.url for r in ok if r.numeric_claims]

    inventory = {
        "generated_at": datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
        "total_urls": total,
        "ok_count": len(ok),
        "error_count": total - len(ok),
        "total_words": sum(r.word_count for r in ok),
        "avg_word_count": (sum(r.word_count for r in ok) // len(ok)) if ok else 0,
        "schema_coverage": dict(sorted(schema_coverage.items(), key=lambda kv: -kv[1])),
        "pages_thin_lt_300_words": thin_pages,
        "pages_with_numeric_claims": pages_with_claims,
        "pages_without_claims": [r.url for r in ok if not r.numeric_claims],
        "pages_missing_meta_description": [r.url for r in ok if not r.meta_description],
        "pages_missing_h1": [r.url for r in ok if not r.h1],
        "pages": [
            {
                "url": r.url,
                "status": r.status,
                "title": r.title,
                "word_count": r.word_count,
                "schema_types": r.schema_types,
                "numeric_claims_count": len(r.numeric_claims),
                "lang": r.lang,
                "error": r.error,
            }
            for r in sorted(records, key=lambda x: x.url)
        ],
    }
    path = out_dir / "_inventory.json"
    tmp = path.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(inventory, f, ensure_ascii=False, indent=2)
    tmp.replace(path)
    return path


def _latest_inventory_dir() -> Optional[Path]:
    """Return the most recent date-stamped dir under data/raw/content/
    that has an _inventory.json file, or None if nothing's been scraped
    yet. Used by --retry-shells to locate the inventory to update.
    """
    if not _CONTENT_DIR.exists():
        return None
    candidates = sorted(
        (p for p in _CONTENT_DIR.iterdir() if p.is_dir()),
        key=lambda p: p.name,
        reverse=True,
    )
    for d in candidates:
        if (d / "_inventory.json").exists():
            return d
    return None


def _load_all_records_in_dir(out_dir: Path) -> list[ContentRecord]:
    """Load every per-URL JSON record in `out_dir` back into ContentRecord
    instances. Used by --retry-shells to rebuild the inventory from the
    current on-disk state (our retry pass only touches a subset of URLs,
    but the inventory should still reflect the complete catalog).
    """
    out: list[ContentRecord] = []
    for rec_path in sorted(out_dir.glob("*.json")):
        if rec_path.name.startswith("_"):
            continue  # skip inventory, tmp files
        try:
            with rec_path.open("r", encoding="utf-8") as f:
                data = json.load(f)
        except json.JSONDecodeError:
            log.warning("skipping unreadable record: %s", rec_path.name)
            continue
        try:
            out.append(
                ContentRecord(
                    url=data.get("url") or "",
                    fetched_at=data.get("fetched_at") or "",
                    status=int(data.get("status") or 0),
                    title=data.get("title"),
                    meta_description=data.get("meta_description"),
                    h1=data.get("h1"),
                    lang=data.get("lang"),
                    word_count=int(data.get("word_count") or 0),
                    heading_count=data.get("heading_count") or {},
                    schema_types=list(data.get("schema_types") or []),
                    numeric_claims=list(data.get("numeric_claims") or []),
                    internal_links=int(data.get("internal_links") or 0),
                    external_links=int(data.get("external_links") or 0),
                    last_modified=data.get("last_modified"),
                    body_text=data.get("body_text"),
                    raw_html_size=int(data.get("raw_html_size") or 0),
                    error=data.get("error"),
                    hreflang_alternates=dict(data.get("hreflang_alternates") or {}),
                )
            )
        except (TypeError, ValueError) as e:
            log.warning("skipping malformed record %s: %s", rec_path.name, e)
    return out


def _shell_urls_from_latest_inventory() -> list[str]:
    """Walk the most recent _inventory.json + per-URL JSON records, return
    URLs whose record matches the shell-response signature (word_count=0,
    title=generic or missing, no page-level schema). Used by
    --retry-shells to re-scrape only the flaky URLs.

    Returns empty list when nothing has been scraped yet.
    """
    if not _CONTENT_DIR.exists():
        return []
    dates = sorted(
        (p for p in _CONTENT_DIR.iterdir() if p.is_dir()),
        key=lambda p: p.name,
        reverse=True,
    )
    for date_dir in dates:
        inv_path = date_dir / "_inventory.json"
        if not inv_path.exists():
            continue
        try:
            with inv_path.open("r", encoding="utf-8") as f:
                inv = json.load(f)
        except json.JSONDecodeError:
            continue

        shells: list[str] = []
        for summary in inv.get("pages", []) or []:
            url = summary.get("url")
            if not url:
                continue
            # Use per-URL file (it has schema_types + title, unlike the
            # summary which only has counts).
            slug = _slug_for(url)
            rec_path = date_dir / f"{slug}.json"
            if not rec_path.exists():
                continue
            try:
                with rec_path.open("r", encoding="utf-8") as f:
                    rec_data = json.load(f)
            except json.JSONDecodeError:
                continue
            pseudo = ContentRecord(
                url=url,
                fetched_at=rec_data.get("fetched_at") or "",
                status=int(rec_data.get("status") or 0),
                title=rec_data.get("title"),
                word_count=int(rec_data.get("word_count") or 0),
                schema_types=list(rec_data.get("schema_types") or []),
            )
            if _looks_like_shell(pseudo, url):
                shells.append(url)
        return shells
    return []


# ---------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--sitemap",
        default=None,
        help=(
            "Sitemap URL (default: <SITE_CANONICAL_ORIGIN>/sitemap.xml; "
            "SITE_CANONICAL_ORIGIN defaults to https://acme.io)."
        ),
    )
    parser.add_argument("--url", help="Single URL to scrape (skips sitemap).")
    parser.add_argument(
        "--max",
        type=int,
        default=None,
        help="Max number of URLs to scrape (useful for quick tests).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List URLs the sitemap returns; don't fetch them.",
    )
    parser.add_argument(
        "--retry-shells",
        action="store_true",
        help=(
            "Re-scrape only the URLs whose most recent record looks like "
            "a shell response (title=generic, word_count=0). Much faster "
            "than a full bulk re-run and targets exactly the pages that "
            "need another try after the CDN warms."
        ),
    )
    args = parser.parse_args(argv)

    sitemap_url = args.sitemap or _default_sitemap()

    # Decide URL set + output dir.
    # For `--retry-shells` we write BACK into the same dir as the
    # inventory we read from (so the re-scraped records replace the
    # shell ones), and after the run we rebuild the inventory from
    # *all* records in that dir — not just the ones we just touched.
    # Full/single-URL runs go to a fresh date-stamped dir as before.
    retry_shells_dir: Optional[Path] = None
    if args.url:
        urls = [args.url]
    elif args.retry_shells:
        urls = _shell_urls_from_latest_inventory()
        retry_shells_dir = _latest_inventory_dir()
        log.info(
            "retry-shells: found %d URL(s) with shell responses in %s",
            len(urls),
            retry_shells_dir.name if retry_shells_dir else "?",
        )
        if not urls:
            log.info("retry-shells: nothing to re-scrape — exiting clean")
            return 0
    else:
        urls = fetch_sitemap_urls(sitemap_url)

    if args.max:
        urls = urls[: args.max]

    log.info("found %d URL(s)", len(urls))
    if args.dry_run:
        for u in urls:
            print(u)
        return 0

    if retry_shells_dir is not None:
        out_dir = retry_shells_dir
    else:
        date_stamp = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")
        out_dir = _CONTENT_DIR / date_stamp
    out_dir.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    records: list[ContentRecord] = []
    for i, url in enumerate(urls, 1):
        log.info("[%d/%d] %s", i, len(urls), url)
        rec, raw_html = scrape_url(url, session)
        write_record(out_dir, rec, raw_html=raw_html)
        records.append(rec)
        time.sleep(_POLITE_DELAY)

    if retry_shells_dir is not None:
        # Rebuild the inventory from ALL per-URL records in the dir
        # (not just what we just touched) so the summary reflects the
        # full state after the targeted retry pass.
        all_records = _load_all_records_in_dir(out_dir)
        inv_path = write_inventory(out_dir, all_records)
        log.info(
            "retry-shells done. this pass: ok=%d err=%d. full inventory: %d URLs → %s",
            sum(1 for r in records if r.status == 200),
            sum(1 for r in records if r.status != 200),
            len(all_records),
            inv_path.relative_to(_ROOT),
        )
    else:
        inv_path = write_inventory(out_dir, records)
        log.info(
            "done. ok=%d err=%d → %s",
            sum(1 for r in records if r.status == 200),
            sum(1 for r in records if r.status != 200),
            inv_path.relative_to(_ROOT),
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())

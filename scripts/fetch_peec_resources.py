"""Scrape Peec AI blog + docs, diff against seen, save new markdown.

Discovery strategy (per URL tree):
  1. Try the sitemap (``<host>/sitemap.xml``) — authoritative if present.
  2. Fallback: crawl the index page once, harvest same-prefix links.

For each discovered URL not already in ``knowledge/seen.json``:
  * Fetch HTML
  * Extract main content via trafilatura (Mozilla Readability port) as
    markdown, including tables + links
  * Save to ``knowledge/peec_blog/<slug>.md`` or
    ``knowledge/peec_docs/<slug>.md`` with a provenance header
  * Record the URL + ISO fetched-at timestamp in ``seen.json``

The knowledge-refresh runbook in the skill consumes the list of
added/changed URLs printed to stdout and decides (via Claude's
reasoning) whether any of them require skill-file edits.

CLI::

    python scripts/fetch_peec_resources.py
    python scripts/fetch_peec_resources.py --force   # ignore seen.json
    python scripts/fetch_peec_resources.py --only blog
    python scripts/fetch_peec_resources.py --only docs
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from scripts.utils import get_logger  # noqa: E402

log = get_logger(__name__)


# ---------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------

PEEC_BLOG_INDEX = "https://peec.ai/blog"
PEEC_BLOG_PREFIX = "https://peec.ai/blog"
PEEC_BLOG_SITEMAP = "https://peec.ai/sitemap.xml"

PEEC_DOCS_INDEX = "https://docs.peec.ai/intro-to-peec-ai"
PEEC_DOCS_PREFIX = "https://docs.peec.ai"
PEEC_DOCS_SITEMAP = "https://docs.peec.ai/sitemap.xml"

USER_AGENT = "Acme-marketing-analytics/1.0 (+https://acme.io)"
FETCH_TIMEOUT = 15.0
CRAWL_SLEEP = 0.5  # be polite

_KNOWLEDGE = _ROOT / "knowledge"
_BLOG_DIR = _KNOWLEDGE / "peec_blog"
_DOCS_DIR = _KNOWLEDGE / "peec_docs"
_SEEN_PATH = _KNOWLEDGE / "seen.json"

# Minimum markdown length to keep — filters out redirect stubs, 404s,
# and pages where trafilatura extracts nothing meaningful.
MIN_CONTENT_CHARS = 200


# ---------------------------------------------------------------------
# Seen-set persistence
# ---------------------------------------------------------------------

def load_seen() -> dict[str, str]:
    if not _SEEN_PATH.exists():
        return {}
    try:
        with _SEEN_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return {k: str(v) for k, v in data.items()}
    except (json.JSONDecodeError, OSError) as e:
        log.warning("seen.json unreadable; starting empty",
                    extra={"error": str(e)})
    return {}


def save_seen(seen: dict[str, str]) -> None:
    _KNOWLEDGE.mkdir(parents=True, exist_ok=True)
    tmp = _SEEN_PATH.with_suffix(_SEEN_PATH.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(seen, f, ensure_ascii=False, indent=2, sort_keys=True)
    tmp.replace(_SEEN_PATH)


# ---------------------------------------------------------------------
# HTTP + discovery
# ---------------------------------------------------------------------

def _fetch(url: str, timeout: float = FETCH_TIMEOUT) -> Optional[str]:
    try:
        r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=timeout)
        r.raise_for_status()
        return r.text
    except requests.RequestException as e:
        log.warning("fetch failed", extra={"url": url, "error": str(e)})
        return None


def discover_from_sitemap(sitemap_url: str, prefix: str) -> list[str]:
    """Return URLs from ``sitemap_url`` whose URL starts with ``prefix``."""
    text = _fetch(sitemap_url)
    if not text:
        return []
    try:
        soup = BeautifulSoup(text, "xml")
    except Exception as e:  # noqa: BLE001
        log.warning("sitemap xml parse failed",
                    extra={"url": sitemap_url, "error": str(e)})
        return []
    urls = []
    for loc in soup.find_all("loc"):
        url = (loc.get_text() or "").strip()
        if url.startswith(prefix):
            urls.append(url)
    return urls


def discover_from_index(index_url: str, prefix: str) -> list[str]:
    """Crawl ``index_url`` ONCE and return same-prefix links (fragment/query stripped)."""
    text = _fetch(index_url)
    if not text:
        return []
    try:
        soup = BeautifulSoup(text, "html.parser")
    except Exception as e:  # noqa: BLE001
        log.warning("index parse failed",
                    extra={"url": index_url, "error": str(e)})
        return []
    found: set[str] = set()
    for a in soup.find_all("a", href=True):
        full = urljoin(index_url, a["href"])
        parsed = urlparse(full)
        clean = f"{parsed.scheme}://{parsed.netloc}{parsed.path}".rstrip("/")
        if clean.startswith(prefix) and clean != prefix:
            found.add(clean)
    # Always include the index itself too if it matches the prefix
    if index_url.startswith(prefix):
        found.add(index_url.rstrip("/"))
    return sorted(found)


def discover_urls(source: str) -> list[str]:
    """Union sitemap + index crawl for a given source ('blog' or 'docs')."""
    if source == "blog":
        sitemap, index, prefix = PEEC_BLOG_SITEMAP, PEEC_BLOG_INDEX, PEEC_BLOG_PREFIX
    elif source == "docs":
        sitemap, index, prefix = PEEC_DOCS_SITEMAP, PEEC_DOCS_INDEX, PEEC_DOCS_PREFIX
    else:
        raise ValueError(f"unknown source {source!r}")

    all_urls = set(discover_from_sitemap(sitemap, prefix))
    if not all_urls:
        log.info("no sitemap URLs; falling back to index crawl",
                 extra={"source": source, "index": index})
    all_urls |= set(discover_from_index(index, prefix))
    return sorted(all_urls)


# ---------------------------------------------------------------------
# Slug + extraction
# ---------------------------------------------------------------------

def slug_from_url(url: str) -> str:
    """Produce a filesystem-safe slug for an URL.

    Uses the last path segment when present, falls back to the full
    path with slashes turned into dashes. Trims to 100 chars and
    replaces dots with dashes to avoid false file extensions.
    """
    parsed = urlparse(url)
    path = parsed.path.strip("/")
    tail = path.split("/")[-1] if path else ""
    slug = tail or path.replace("/", "-") or "index"
    slug = slug.replace(".", "-")[:100]
    return slug or "index"


def _extract_markdown(url: str, html: str) -> Optional[str]:
    """Use trafilatura to pull the main article text as markdown."""
    try:
        import trafilatura  # lazy import — not needed by unit tests
    except ImportError:
        log.error("trafilatura not installed; run `pip install trafilatura`")
        return None

    md = trafilatura.extract(
        html,
        output_format="markdown",
        include_links=True,
        include_tables=True,
        include_formatting=True,
        url=url,
    )
    if not md or len(md) < MIN_CONTENT_CHARS:
        log.warning(
            "extracted content too short",
            extra={"url": url, "length": len(md) if md else 0},
        )
        return None
    return md


def fetch_and_save(url: str, out_dir: Path) -> Optional[Path]:
    """Fetch ``url``, extract markdown, save with provenance header. Returns path."""
    html = _fetch(url)
    if not html:
        return None
    md = _extract_markdown(url, html)
    if not md:
        return None
    slug = slug_from_url(url)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{slug}.md"
    header = (
        f"<!-- Source: {url} -->\n"
        f"<!-- Fetched: {datetime.now(tz=timezone.utc).isoformat(timespec='seconds')} -->\n"
        f"<!-- By: scripts/fetch_peec_resources.py -->\n\n"
        f"# {url}\n\n"
    )
    tmp = out_path.with_suffix(out_path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        f.write(header + md)
    tmp.replace(out_path)
    return out_path


# ---------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------

def refresh(
    sources: Optional[list[str]] = None,
    force: bool = False,
    sleep: float = CRAWL_SLEEP,
) -> dict:
    sources = sources or ["blog", "docs"]
    seen = {} if force else load_seen()
    now_iso = datetime.now(tz=timezone.utc).isoformat(timespec="seconds")

    summary: dict = {
        "run_at": now_iso,
        "sources": {},
        "added_or_changed": [],
    }

    for source in sources:
        out_dir = _BLOG_DIR if source == "blog" else _DOCS_DIR
        urls = discover_urls(source)
        summary["sources"][source] = {"discovered": len(urls)}
        new_count = 0
        for url in urls:
            if url in seen:
                continue
            path = fetch_and_save(url, out_dir)
            if path:
                seen[url] = now_iso
                summary["added_or_changed"].append(
                    {"source": source, "url": url, "path": str(path)}
                )
                new_count += 1
                time.sleep(sleep)
        summary["sources"][source]["new"] = new_count

    save_seen(seen)
    return summary


# ---------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Fetch Peec AI blog + docs; diff vs seen.json; save new markdown."
    )
    p.add_argument(
        "--only",
        choices=["blog", "docs"],
        help="Limit to a single source. Default: both.",
    )
    p.add_argument(
        "--force",
        action="store_true",
        help="Ignore seen.json and re-fetch everything.",
    )
    p.add_argument(
        "--sleep",
        type=float,
        default=CRAWL_SLEEP,
        help=f"Seconds between fetches (default: {CRAWL_SLEEP}).",
    )
    return p


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    sources = [args.only] if args.only else ["blog", "docs"]
    try:
        summary = refresh(sources=sources, force=args.force, sleep=args.sleep)
    except Exception as e:  # noqa: BLE001
        log.error("refresh failed", extra={"error": str(e)})
        return 1

    log.info(
        "refresh complete",
        extra={
            "sources": summary["sources"],
            "added_or_changed": len(summary["added_or_changed"]),
        },
    )
    # Stdout list for the knowledge-refresh runbook to consume.
    for item in summary["added_or_changed"]:
        print(f"{item['source']:5s}  {item['url']}  ->  {item['path']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

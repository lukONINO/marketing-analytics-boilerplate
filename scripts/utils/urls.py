"""URL normalization + referrer matching.

Every source (GSC, GA4, Peec citations, LLM-Referrer list) represents
URLs slightly differently:

- GSC returns full URLs with scheme (``https://acme.io/about/``)
- GA4 returns bare page paths (``/about``) — no host, no scheme
- Peec citation URLs may include UTM params and tracking
- LLM-Referrer entries are bare hosts (``chatgpt.com``)

``normalize_url`` produces a stable canonical form so joins across
sources line up. The join-coverage test in Phase 4 asserts ≥80% of
top URLs match across GSC/GA4/Peec after normalization.

The canonical-origin used to attach to bare paths is read from the
``SITE_CANONICAL_ORIGIN`` env var by callers; this module itself
remains pure and accepts the value as an explicit argument.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Iterable, Optional
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit


# Tracking parameters stripped during normalization. Matching is
# case-insensitive.
_TRACKING_PARAMS = frozenset({
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_id",
    "utm_name",
    "fbclid",
    "gclid",
    "gclsrc",
    "dclid",
    "msclkid",
    "yclid",
    "twclid",
    "ttclid",
    "mc_cid",
    "mc_eid",
    "_ga",
    "_gl",
    "hsctatracking",
    "__hstc",
    "__hssc",
    "__hsfp",
    "ref",
    "referrer",
    "igshid",
    "vero_id",
    "vero_conv",
    "piwik_campaign",
    "piwik_kwd",
    "mkt_tok",
})


# Default ports that should be stripped when they match the scheme.
_DEFAULT_PORTS = {"http": "80", "https": "443"}


def normalize_url(url: str, canonical_origin: Optional[str] = None) -> str:
    """Canonicalize a URL for cross-source joins.

    Rules:
      * lowercase scheme and host
      * drop default ports (:80 for http, :443 for https)
      * drop URL fragments (``#foo``)
      * drop tracking query params (UTM, gclid, fbclid, etc.)
      * sort remaining query params alphabetically
      * collapse trailing slash on non-root paths (``/about/`` → ``/about``)
      * if the URL is bare-path (``/about``) and ``canonical_origin`` is
        supplied, prefix it to produce a full URL
      * if the URL is schemeless but host-like (``acme.io/about``),
        assume https

    Returns the original string if it cannot be parsed at all — never
    raises. Empty / None input returns empty string.
    """
    if not url:
        return ""

    url = url.strip()
    if not url:
        return ""

    # Bare page path → attach canonical origin if provided.
    if url.startswith("/") and canonical_origin:
        url = canonical_origin.rstrip("/") + url

    # Schemeless host-like input ("acme.io/foo") → assume https.
    if "://" not in url and not url.startswith("/"):
        url = "https://" + url

    try:
        parts = urlsplit(url)
    except ValueError:
        return url  # give up gracefully

    scheme = parts.scheme.lower()
    host = parts.hostname.lower() if parts.hostname else ""
    port = parts.port
    # Drop default ports
    netloc = host
    if port is not None and _DEFAULT_PORTS.get(scheme) != str(port):
        netloc = f"{host}:{port}"

    # Path normalization:
    # 1. Bare host (no path component) canonicalizes to "/" — so
    #    "https://acme.io" and "https://acme.io/" end up identical.
    # 2. Percent-decode so "/de/l%C3%B6sungen" and "/de/lösungen"
    #    join across sources (GSC + GA4 send decoded; Peec sends
    #    percent-encoded — this was causing ~60% URL-join miss-rate).
    # 3. Collapse trailing slash on non-root paths only.
    path = parts.path or "/"
    try:
        path = unquote(path, encoding="utf-8", errors="strict")
    except UnicodeDecodeError:
        pass  # leave partially-decoded or as-is if input isn't valid UTF-8
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")

    # Query: drop tracking params, sort the rest (stable join key)
    kept = [
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if k.lower() not in _TRACKING_PARAMS
    ]
    kept.sort()
    query = urlencode(kept, doseq=True)

    # Drop fragment entirely (``#foo`` never affects ranking/analytics joins)
    return urlunsplit((scheme, netloc, path, query, ""))


def extract_host(url: str) -> str:
    """Return the lowercased hostname of ``url``, or '' if it has none."""
    if not url:
        return ""
    url = url.strip()
    if "://" not in url and not url.startswith("/"):
        url = "https://" + url
    try:
        return (urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""


def is_same_host(url_a: str, url_b: str) -> bool:
    """True iff both URLs resolve to the same hostname (case-insensitive)."""
    a = extract_host(url_a)
    b = extract_host(url_b)
    return bool(a) and a == b


def _strict_canonical(url: str) -> str:
    """Stricter canonicalization used ONLY to detect URLs that slipped
    past :func:`normalize_url` but probably refer to the same page.

    Catches cases ``normalize_url`` intentionally leaves alone (lest it
    be too aggressive for real URL handling):
      * case differences in the path (``/About`` vs ``/about``)
      * ``www.`` prefix (``www.acme.io`` vs ``acme.io``)
      * any root-path trailing slash drift that somehow remains

    NOT for actual URL handling — downstream code should always use
    :func:`normalize_url`. This helper exists only to power
    :func:`find_normalization_duplicates`, which surfaces suspected
    normalization gaps in the daily aggregator output.
    """
    if not url:
        return ""
    u = url.lower()
    u = u.replace("://www.", "://", 1)
    u = u.rstrip("/")
    return u


def find_normalization_duplicates(urls: Iterable[str]) -> list[list[str]]:
    """Return groups of URLs that share a stricter canonical form.

    Each returned list contains 2+ distinct URLs that appear to be the
    same page but weren't joined by :func:`normalize_url`. Empty list
    means no suspected duplicates — a clean join graph.

    The aggregator runs this against ``top_pages_all_channels`` and
    surfaces any non-empty groups in the daily output so normalization
    drift is caught on every run, not just via pytest.
    """
    groups: dict[str, set[str]] = defaultdict(set)
    for u in urls:
        key = _strict_canonical(u)
        if key:
            groups[key].add(u)
    return [sorted(urls) for urls in groups.values() if len(urls) > 1]


def match_llm_referrer(
    referrer_host: str, llm_domains: Iterable[str]
) -> Optional[str]:
    """Return the matched LLM domain, or ``None``.

    Matching strategy:
      1. Exact host match (case-insensitive).
      2. Suffix match against ``.<domain>`` — so ``chat.openai.com``
         matches ``openai.com`` and ``www.perplexity.ai`` matches
         ``perplexity.ai``. Prevents ``notopenai.com`` from matching
         ``openai.com`` (the leading dot rules that out).

    The returned value is the entry from ``llm_domains`` (not the
    input host) so the caller can look up provider/type metadata.
    """
    if not referrer_host:
        return None

    host = referrer_host.strip().lower()
    # Strip port if present
    if ":" in host:
        host = host.split(":", 1)[0]

    # Build two lookups: exact and suffix (both lowercased).
    domains = [(d, d.lower().strip(".")) for d in llm_domains if d]

    # Exact
    for original, lowered in domains:
        if lowered == host:
            return original

    # Suffix
    for original, lowered in domains:
        if host.endswith("." + lowered):
            return original

    return None

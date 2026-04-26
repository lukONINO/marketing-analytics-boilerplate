"""Join GA4 referrer data against the LLM referrer list.

Reads:
  * ``data/raw/ga4/<date>.json`` — the ``referrers`` block (1-D) plus
    the ``referrers_by_page`` block (2-D: landingPage × sessionSource)
  * ``knowledge/llm_referrer_list.json``

Writes ``data/raw/llm_traffic/<date>.json`` with:

  * total sessions / users classified as LLM-origin
  * roll-up by provider (OpenAI, Anthropic, Perplexity, ...)
  * roll-up by domain (chatgpt.com, chat.openai.com, ...)
  * ``by_landing_page`` — per-URL attribution derived from
    ``referrers_by_page``. Empty only if GA4 didn't return the 2-D
    slice (older pull, API failure). Each row: ``{url, sessions,
    users, providers, domains}``. Consumed by aggregate_daily.py
    to populate ``llm_sessions`` on the cross-channel Top Pages table.
  * ``unclassified_referrers`` — non-``(not set)`` referrers that
    didn't match any LLM domain. Surface these in weekly reports so
    the provider mapping in ``refresh_llm_list.py`` can be extended.

Idempotent: overwrites for the same date. Exits non-zero only on
hard failures (missing inputs); empty-output days exit 0.

CLI::

    python scripts/parse_llm_traffic.py --date 2026-04-20
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from scripts.utils import (  # noqa: E402
    extract_host,
    get_logger,
    match_llm_referrer,
    parse_date,
    yesterday,
)

log = get_logger(__name__)

_GA4_DIR = _ROOT / "data" / "raw" / "ga4"
_LLM_DIR = _ROOT / "data" / "raw" / "llm_traffic"
_LIST_PATH = _ROOT / "knowledge" / "llm_referrer_list.json"


# ---------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------

def _load_ga4(date_iso: str) -> dict[str, Any]:
    path = _GA4_DIR / f"{date_iso}.json"
    if not path.exists():
        raise FileNotFoundError(
            f"GA4 raw file not found at {path}. Run pull_ga4.py first."
        )
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _load_llm_list() -> dict[str, Any]:
    if not _LIST_PATH.exists():
        raise FileNotFoundError(
            f"LLM referrer list not found at {_LIST_PATH}. "
            "Run refresh_llm_list.py first."
        )
    with _LIST_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------

def classify(
    referrers: list[dict[str, Any]], llm_list: dict[str, Any]
) -> dict[str, Any]:
    """Roll up the GA4 referrers block into LLM-classified slices.

    ``referrers`` rows look like::

        {"pageReferrer": "https://chatgpt.com/...", "sessions": 3, "totalUsers": 3}

    GA4 emits ``(not set)`` for direct traffic and some bot traffic —
    we explicitly drop those rather than letting them count as
    "unclassified" (they'd drown out the real unclassified signal).
    """
    domains_meta = {
        d["domain"]: d
        for d in llm_list.get("domains", [])
        if d.get("domain")
    }
    lookup = list(domains_meta.keys())

    total_sessions = 0
    total_users = 0
    by_provider: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"sessions": 0, "users": 0, "domains": set()}
    )
    by_domain: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"sessions": 0, "users": 0, "provider": None, "type": None}
    )
    unclassified: dict[str, int] = defaultdict(int)

    for row in referrers or []:
        raw_ref = (row.get("pageReferrer") or "").strip()
        sessions = int(row.get("sessions", 0) or 0)
        users = int(row.get("totalUsers", 0) or 0)

        # Drop direct / bots / literal "(not set)" — not actionable here.
        if not raw_ref or raw_ref in {"(not set)", "(direct)", "$direct"}:
            continue

        host = extract_host(raw_ref)
        if not host:
            continue

        matched = match_llm_referrer(host, lookup)
        if not matched:
            unclassified[host] += sessions
            continue

        meta = domains_meta.get(matched, {})
        provider = meta.get("provider") or "Unknown"

        total_sessions += sessions
        total_users += users

        bp = by_provider[provider]
        bp["sessions"] += sessions
        bp["users"] += users
        bp["domains"].add(matched)

        bd = by_domain[matched]
        bd["sessions"] += sessions
        bd["users"] += users
        bd["provider"] = provider
        bd["type"] = meta.get("type") or "unknown"

    # Freeze sets to sorted lists for JSON serializability.
    by_provider_out = {
        provider: {
            "sessions": vals["sessions"],
            "users": vals["users"],
            "domains": sorted(vals["domains"]),
        }
        for provider, vals in sorted(
            by_provider.items(),
            key=lambda kv: kv[1]["sessions"],
            reverse=True,
        )
    }
    by_domain_out = [
        {
            "domain": dom,
            "provider": vals["provider"],
            "type": vals["type"],
            "sessions": vals["sessions"],
            "users": vals["users"],
        }
        for dom, vals in sorted(
            by_domain.items(),
            key=lambda kv: kv[1]["sessions"],
            reverse=True,
        )
    ]
    unclassified_out = [
        {"host": h, "sessions": s}
        for h, s in sorted(
            unclassified.items(), key=lambda kv: kv[1], reverse=True
        )
    ]

    return {
        "total_llm_sessions": total_sessions,
        "total_llm_users": total_users,
        "by_provider": by_provider_out,
        "by_domain": by_domain_out,
        "unclassified_referrers": unclassified_out,
    }


def classify_by_landing_page(
    referrers_by_page: list[dict[str, Any]], llm_list: dict[str, Any]
) -> list[dict[str, Any]]:
    """Roll up the 2-D (landingPage × sessionSource) cross into per-URL
    LLM attribution.

    Input rows look like::

        {"landingPage": "/blog/X", "url": "https://acme.io/blog/X",
         "sessionSource": "chatgpt.com", "sessions": 3, "totalUsers": 3}

    Output rows::

        {"url": "https://acme.io/blog/X", "sessions": 3, "users": 3,
         "providers": ["OpenAI"], "domains": ["chatgpt.com"]}

    Only sessions whose ``sessionSource`` matches the LLM list are kept;
    everything else (organic, direct, social) is dropped — the 1-D
    ``classify`` pass already handles unclassified reporting.
    """
    domains_meta = {
        d["domain"]: d
        for d in llm_list.get("domains", [])
        if d.get("domain")
    }
    lookup = list(domains_meta.keys())

    by_url: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "sessions": 0,
            "users": 0,
            "providers": set(),
            "domains": set(),
        }
    )

    for row in referrers_by_page or []:
        url = (row.get("url") or "").strip()
        source = (row.get("sessionSource") or "").strip()
        sessions = int(row.get("sessions", 0) or 0)
        users = int(row.get("totalUsers", 0) or 0)

        # Drop rows we can't attribute to a URL (shouldn't happen after
        # pull_ga4 normalization, but belt-and-suspenders).
        if not url:
            continue
        # Drop direct / (not set) / bots — they're not LLM traffic.
        if not source or source in {"(not set)", "(direct)", "$direct"}:
            continue

        host = extract_host(source) or source.lower()
        matched = match_llm_referrer(host, lookup)
        if not matched:
            continue

        meta = domains_meta.get(matched, {})
        provider = meta.get("provider") or "Unknown"

        bucket = by_url[url]
        bucket["sessions"] += sessions
        bucket["users"] += users
        bucket["providers"].add(provider)
        bucket["domains"].add(matched)

    # Sort by sessions desc and freeze sets to sorted lists.
    out = [
        {
            "url": url,
            "sessions": vals["sessions"],
            "users": vals["users"],
            "providers": sorted(vals["providers"]),
            "domains": sorted(vals["domains"]),
        }
        for url, vals in by_url.items()
    ]
    out.sort(key=lambda r: (-r["sessions"], r["url"]))
    return out


# ---------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------

def parse_for_date(date_iso: str) -> dict[str, Any]:
    ga4 = _load_ga4(date_iso)
    llm_list = _load_llm_list()
    summary = classify(ga4.get("referrers", []), llm_list)
    # referrers_by_page was added to pull_ga4.py on 2026-04-23. Older
    # raw files won't have it — default to [] so we keep parsing instead
    # of failing. Re-run pull_ga4.py for the target date to backfill.
    by_landing_page = classify_by_landing_page(
        ga4.get("referrers_by_page", []) or [], llm_list
    )
    return {
        "date": date_iso,
        "generated_at": datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
        "ga4_property_id": ga4.get("property_id"),
        "llm_list_fetched_at": llm_list.get("fetched_at"),
        "llm_list_commit": llm_list.get("source_commit"),
        "by_landing_page": by_landing_page,
        **summary,
    }


def write_output(date_iso: str, payload: dict[str, Any]) -> Path:
    _LLM_DIR.mkdir(parents=True, exist_ok=True)
    out = _LLM_DIR / f"{date_iso}.json"
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
        description=(
            "Classify GA4 referrers as LLM traffic using the enriched "
            "LLM referrer list. Writes data/raw/llm_traffic/<date>.json."
        )
    )
    p.add_argument("--date", help="Target date YYYY-MM-DD (default: yesterday).")
    return p


def main(argv: Optional[list[str]] = None) -> int:
    load_dotenv()
    args = build_parser().parse_args(argv)
    date_iso = (parse_date(args.date) if args.date else yesterday()).isoformat()

    try:
        payload = parse_for_date(date_iso)
    except FileNotFoundError as e:
        log.error("input missing", extra={"error": str(e)})
        return 2
    except Exception as e:  # noqa: BLE001
        log.error("parse failed", extra={"date": date_iso, "error": str(e)})
        return 1

    out = write_output(date_iso, payload)
    log.info(
        "wrote LLM traffic summary",
        extra={
            "date": date_iso,
            "path": str(out),
            "total_llm_sessions": payload["total_llm_sessions"],
            "providers": list(payload["by_provider"].keys()),
            "unclassified_hosts": len(payload["unclassified_referrers"]),
            "landing_pages_attributed": len(payload["by_landing_page"]),
        },
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

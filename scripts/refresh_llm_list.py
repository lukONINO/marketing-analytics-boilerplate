"""Refresh the LLM-referrer classification list.

Upstream: https://github.com/MalteBerlin/LLM-Referrer — a plain-text,
one-domain-per-line list (no provider/type metadata). We fetch the
raw file from GitHub, extract the ``main`` branch commit SHA for
provenance, and enrich each domain with a provider + type lookup
baked into this script. Unknown domains are tagged ``"Unknown"`` so
downstream reports can surface them for review.

Why we enrich locally instead of expecting the upstream list to have
metadata: the list is maintained by a single person and changes
infrequently. Our enrichment is the weekly moving part — when a new
AI product launches we add the mapping here, not upstream.

Output: ``knowledge/llm_referrer_list.json``. Called **weekly** by
the daily runbook (it checks file age and refreshes if >7 days old).

CLI::

    python scripts/refresh_llm_list.py
    python scripts/refresh_llm_list.py --max-age-days 0   # force refresh
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import requests
from dotenv import load_dotenv

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from scripts.utils import get_logger  # noqa: E402

log = get_logger(__name__)


# ---------------------------------------------------------------------
# Upstream
# ---------------------------------------------------------------------

REPO_OWNER = "MalteBerlin"
REPO_NAME = "LLM-Referrer"
LIST_PATH = "llm-referrer.txt"
LIST_RAW_URL = (
    f"https://raw.githubusercontent.com/"
    f"{REPO_OWNER}/{REPO_NAME}/main/{LIST_PATH}"
)
COMMIT_API_URL = (
    f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/commits/main"
)

# Where we persist the enriched list.
_OUT = _ROOT / "knowledge" / "llm_referrer_list.json"


# ---------------------------------------------------------------------
# Provider / type enrichment
# ---------------------------------------------------------------------

# Canonical provider + type per domain. "type" values:
#   chat    — a conversational LLM product (ChatGPT, Claude.ai, ...)
#   search  — an AI answer engine that cites sources (Perplexity, ...)
#   meta    — an LLM-answer surface inside a larger product (Google AI
#             Overview inside regular search results, Microsoft Copilot,
#             Brave AI, ...). Treat as LLM traffic even though the user
#             didn't go to a dedicated chat UI.
#   agent   — LLM-driven browsers / operators (ChatGPT Operator, etc.)
#
# Keep this mapping sorted alphabetically to make diffs reviewable.
DOMAIN_TO_PROVIDER: dict[str, dict[str, str]] = {
    "adot.ai":                {"provider": "A.dot",               "type": "chat"},
    "agent.minimax.io":       {"provider": "MiniMax",             "type": "agent"},
    "ai.ionos.de":            {"provider": "IONOS AI",            "type": "chat"},
    "alexaplus.com":          {"provider": "Amazon Alexa+",       "type": "meta"},
    "andisearch.com":         {"provider": "Andi",                "type": "search"},
    "anthropic.com":          {"provider": "Anthropic",           "type": "meta"},
    "app.sigmabrowser.com":   {"provider": "Sigma Browser",       "type": "meta"},
    "aria.opera.com":         {"provider": "Opera Aria",          "type": "meta"},
    "askgpt.app":             {"provider": "AskGPT",              "type": "chat"},
    "bagoodex.io":            {"provider": "Bagoodex",            "type": "search"},
    "bard.google.com":        {"provider": "Google Gemini",       "type": "chat"},
    "blackbox.ai":            {"provider": "Blackbox AI",         "type": "chat"},
    "brave.com":              {"provider": "Brave",               "type": "meta"},
    "bsearch.app":            {"provider": "Brave Search",        "type": "search"},
    "character.ai":           {"provider": "Character.ai",        "type": "chat"},
    "chat.baidu.com":         {"provider": "Baidu ERNIE",         "type": "chat"},
    "chat.deepseek.com":      {"provider": "DeepSeek",            "type": "chat"},
    "chat.mistral.ai":        {"provider": "Mistral",             "type": "chat"},
    "chat.openai.com":        {"provider": "OpenAI",              "type": "chat"},
    "chat.qwenlm.ai":         {"provider": "Alibaba Qwen",        "type": "chat"},
    "chat.z.ai":              {"provider": "Zhipu Z.ai",          "type": "chat"},
    "chatbotapp.ai":          {"provider": "Chatbot App",         "type": "chat"},
    "chatglm.cn":             {"provider": "Zhipu ChatGLM",       "type": "chat"},
    "chatgpt.com":            {"provider": "OpenAI",              "type": "chat"},
    "chathub.gg":             {"provider": "ChatHub",             "type": "chat"},
    "claude.ai":              {"provider": "Anthropic",           "type": "chat"},
    "consensus.app":          {"provider": "Consensus",           "type": "search"},
    "console.anthropic.com":  {"provider": "Anthropic",           "type": "chat"},
    "copilot.cloud.microsoft":{"provider": "Microsoft Copilot",   "type": "meta"},
    "copilot.microsoft.com":  {"provider": "Microsoft Copilot",   "type": "meta"},
    "deepseek.com":           {"provider": "DeepSeek",            "type": "chat"},
    "doubao.com":             {"provider": "ByteDance Doubao",    "type": "chat"},
    "duck.ai":                {"provider": "DuckDuckGo AI",       "type": "chat"},
    "duckduckgo.com":         {"provider": "DuckDuckGo AI",       "type": "meta"},
    "easemate.ai":            {"provider": "EaseMate",            "type": "chat"},
    "ecosia.org":             {"provider": "Ecosia AI",           "type": "meta"},
    "edgeservices.bing.com":  {"provider": "Microsoft Copilot",   "type": "meta"},
    "exa.ai":                 {"provider": "Exa",                 "type": "search"},
    "felo.ai":                {"provider": "Felo",                "type": "search"},
    "galaxy.ai":              {"provider": "Galaxy AI",           "type": "chat"},
    "geeky.chat":             {"provider": "Geeky",               "type": "chat"},
    "gemini.google.com":      {"provider": "Google Gemini",       "type": "chat"},
    "genspark.ai":            {"provider": "Genspark",            "type": "search"},
    "getliner.com":           {"provider": "Liner",               "type": "search"},
    "getmerlin.in":           {"provider": "Merlin",              "type": "meta"},
    "glbgpt.com":             {"provider": "GLBGPT",              "type": "chat"},
    "globe.engineer":         {"provider": "Globe Explorer",      "type": "search"},
    "go.welt.de":             {"provider": "Welt AI Assistant",   "type": "meta"},
    "google.com":             {"provider": "Google AI Overview",  "type": "meta"},
    "grok.com":               {"provider": "xAI Grok",            "type": "chat"},
    "grok.x.ai":              {"provider": "xAI Grok",            "type": "chat"},
    "groq.com":               {"provider": "Groq",                "type": "chat"},
    "hailuo.ai":              {"provider": "Hailuo",              "type": "chat"},
    "hey.bild.de":            {"provider": "Bild AI Assistant",   "type": "meta"},
    "hey.pi.ai":              {"provider": "Inflection Pi",       "type": "chat"},
    "heygen.ai":              {"provider": "HeyGen",              "type": "chat"},
    "huggingface.co":         {"provider": "HuggingChat",         "type": "chat"},
    "iask.ai":                {"provider": "iAsk",                "type": "search"},
    "instagram.com":          {"provider": "Meta AI",             "type": "meta"},
    "intric.ai":              {"provider": "Intric",              "type": "chat"},
    "jan.ai":                 {"provider": "Jan",                 "type": "chat"},
    "kagi.com":               {"provider": "Kagi",                "type": "meta"},
    "kimi.ai":                {"provider": "Moonshot Kimi",       "type": "chat"},
    "kimi.com":               {"provider": "Moonshot Kimi",       "type": "chat"},
    "komo.ai":                {"provider": "Komo",                "type": "search"},
    "lechat.mistral.ai":      {"provider": "Mistral",             "type": "chat"},
    "lmarena.ai":             {"provider": "LMSYS Chatbot Arena", "type": "chat"},
    "magai.co":               {"provider": "MagAI",               "type": "chat"},
    "mammouth.ai":            {"provider": "Mammouth",            "type": "chat"},
    "messenger.com":          {"provider": "Meta AI",             "type": "meta"},
    "meta.ai":                {"provider": "Meta AI",             "type": "chat"},
    "metaphor.systems":       {"provider": "Exa",                 "type": "search"},
    "mistral.ai":             {"provider": "Mistral",             "type": "chat"},
    "monica.im":              {"provider": "Monica",              "type": "chat"},
    "moshi.chat":             {"provider": "Moshi",               "type": "chat"},
    "ninjachat.ai":           {"provider": "NinjaChat",           "type": "chat"},
    "notion.so":              {"provider": "Notion AI",           "type": "meta"},
    "openai.com":             {"provider": "OpenAI",              "type": "meta"},
    "openrouter.ai":          {"provider": "OpenRouter",          "type": "chat"},
    "operator.chatgpt.com":   {"provider": "ChatGPT Operator",    "type": "agent"},
    "perplexity.ai":          {"provider": "Perplexity",          "type": "search"},
    "phind.com":              {"provider": "Phind",               "type": "search"},
    "pi.ai":                  {"provider": "Inflection Pi",       "type": "chat"},
    "poe.com":                {"provider": "Poe",                 "type": "chat"},
    "qianwen.com":            {"provider": "Alibaba Qwen",        "type": "chat"},
    "quillbot.com":           {"provider": "QuillBot",            "type": "chat"},
    "qwen.ai":                {"provider": "Alibaba Qwen",        "type": "chat"},
    "rogo.ai":                {"provider": "Rogo",                "type": "chat"},
    "scout.yahoo.com":        {"provider": "Yahoo Scout",         "type": "search"},
    "search.brave.com":       {"provider": "Brave Search",        "type": "search"},
    "searchgpt.com":          {"provider": "OpenAI",              "type": "search"},
    "sider.ai":               {"provider": "Sider",               "type": "meta"},
    "snapchat.com":           {"provider": "My AI (Snap)",        "type": "meta"},
    "tako.ai":                {"provider": "Tako",                "type": "search"},
    "teamai.com":             {"provider": "TeamAI",              "type": "chat"},
    "thinkany.ai":            {"provider": "ThinkAny",            "type": "search"},
    "threads.net":            {"provider": "Meta AI",             "type": "meta"},
    "tongyi.aliyun.com":      {"provider": "Alibaba Qwen",        "type": "chat"},
    "tongyi.com":             {"provider": "Alibaba Qwen",        "type": "chat"},
    "typingmind.com":         {"provider": "TypingMind",          "type": "chat"},
    "venice.ai":              {"provider": "Venice AI",           "type": "chat"},
    "vercel.ai":              {"provider": "v0 (Vercel)",         "type": "chat"},
    "waldo.fyi":              {"provider": "Waldo",               "type": "search"},
    "whatsapp.com":           {"provider": "Meta AI",             "type": "meta"},
    "writesonic.com":         {"provider": "Writesonic",          "type": "chat"},
    "writingmate.ai":         {"provider": "WritingMate",         "type": "chat"},
    "yep.com":                {"provider": "Yep",                 "type": "search"},
    "yeschat.ai":             {"provider": "YesChat",             "type": "chat"},
    "ying.baichuan-ai.com":   {"provider": "Baichuan",            "type": "chat"},
    "yiyan.baidu.com":        {"provider": "Baidu ERNIE",         "type": "chat"},
    "you.com":                {"provider": "You.com",             "type": "search"},
    "yuanbao.tencent.com":    {"provider": "Tencent Yuanbao",     "type": "chat"},
}


def enrich_domain(domain: str) -> dict[str, str]:
    """Return ``{"domain": ..., "provider": ..., "type": ...}`` for one
    domain. Unknown domains are tagged ``Unknown`` so the first
    weekly report can flag them for review."""
    key = domain.strip().lower().rstrip(".")
    record = DOMAIN_TO_PROVIDER.get(key)
    if record:
        return {"domain": key, "provider": record["provider"], "type": record["type"]}
    return {"domain": key, "provider": "Unknown", "type": "unknown"}


# ---------------------------------------------------------------------
# Fetchers
# ---------------------------------------------------------------------

def _fetch_list(url: str = LIST_RAW_URL, timeout: float = 10.0) -> str:
    log.info("fetching LLM referrer list", extra={"url": url})
    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    return resp.text


def _fetch_main_sha(
    url: str = COMMIT_API_URL, timeout: float = 10.0
) -> Optional[str]:
    """Return the main-branch commit SHA for provenance. Returns ``None``
    if the GitHub API is rate-limited or unreachable — the list fetch
    itself is the source of truth; SHA is just a bonus.
    """
    try:
        resp = requests.get(
            url,
            timeout=timeout,
            headers={"Accept": "application/vnd.github+json"},
        )
        resp.raise_for_status()
        return (resp.json() or {}).get("sha")
    except Exception as e:  # noqa: BLE001
        log.warning(
            "couldn't fetch main-branch SHA; continuing without it",
            extra={"error": str(e)},
        )
        return None


# ---------------------------------------------------------------------
# Core
# ---------------------------------------------------------------------

def parse_txt_list(text: str) -> list[str]:
    """Extract unique lowercase domains from the raw .txt file.

    The upstream file has a header section with title / description
    before the domain list. We skip lines that aren't plausibly
    domain-shaped (must contain a dot and no whitespace in the middle).
    """
    domains: list[str] = []
    seen: set[str] = set()
    for raw in text.splitlines():
        line = raw.strip().lower()
        if not line or line.startswith("#"):
            continue
        # Heuristic: looks like a domain if it has a dot and no spaces/tabs.
        if " " in line or "\t" in line:
            continue
        if "." not in line:
            continue
        # Guard against accidental protocol prefixes (defensive, the
        # upstream file has never included them).
        if line.startswith(("http://", "https://")):
            line = line.split("://", 1)[1]
        line = line.strip("/")
        if line in seen:
            continue
        seen.add(line)
        domains.append(line)
    return domains


def build_payload(
    domains: list[str], source_commit: Optional[str]
) -> dict[str, Any]:
    """Return the final enriched payload written to disk."""
    return {
        "fetched_at": datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
        "source_url": LIST_RAW_URL,
        "source_commit": source_commit,
        "domain_count": len(domains),
        "domains": [enrich_domain(d) for d in sorted(domains)],
    }


def _is_fresh_enough(path: Path, max_age_days: int) -> bool:
    """True if the file exists and is younger than ``max_age_days``.
    ``max_age_days=0`` forces a refresh."""
    if not path.exists() or max_age_days <= 0:
        return False
    age = time.time() - path.stat().st_mtime
    return age < max_age_days * 86400


def refresh(
    out_path: Path = _OUT, max_age_days: int = 7, force: bool = False
) -> Path:
    """Fetch + enrich + write. Returns the written path.

    If ``max_age_days > 0`` and the file is fresh enough, returns the
    existing path without hitting the network. ``force=True`` bypasses
    the freshness check.
    """
    if not force and _is_fresh_enough(out_path, max_age_days):
        log.info(
            "LLM referrer list is fresh; skipping network fetch",
            extra={"path": str(out_path), "max_age_days": max_age_days},
        )
        return out_path

    text = _fetch_list()
    domains = parse_txt_list(text)
    if not domains:
        raise RuntimeError(
            "Parsed 0 domains from upstream list — format may have "
            "changed. Inspect the raw file before trusting the pipeline."
        )
    sha = _fetch_main_sha()
    payload = build_payload(domains, source_commit=sha)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(out_path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, sort_keys=False)
    tmp.replace(out_path)

    known = sum(1 for d in payload["domains"] if d["provider"] != "Unknown")
    log.info(
        "wrote LLM referrer list",
        extra={
            "path": str(out_path),
            "total_domains": payload["domain_count"],
            "known_providers": known,
            "unknown": payload["domain_count"] - known,
            "source_commit": sha,
        },
    )
    return out_path


# ---------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=(
            "Fetch + enrich the LLM referrer list to "
            "knowledge/llm_referrer_list.json"
        )
    )
    p.add_argument(
        "--max-age-days",
        type=int,
        default=7,
        help=(
            "Skip the fetch if the local file is younger than this many "
            "days. 0 = force refresh. Default: 7."
        ),
    )
    p.add_argument(
        "--force",
        action="store_true",
        help="Fetch regardless of local file age.",
    )
    return p


def main(argv: Optional[list[str]] = None) -> int:
    load_dotenv()
    args = build_parser().parse_args(argv)
    try:
        refresh(max_age_days=args.max_age_days, force=args.force)
    except Exception as e:  # noqa: BLE001
        log.error("refresh failed", extra={"error": str(e)})
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

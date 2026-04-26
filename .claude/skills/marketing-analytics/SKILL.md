---
name: marketing-analytics
description: Runs a daily and weekly marketing analytics workflow for any SaaS that has a website, Peec AI, Google Search Console, and Google Analytics 4. Pulls GSC + GA4 + Peec AI + LLM-referrer data, joins everything across four channels, and writes narrative reports to a "Marketing Reports" database in Notion. Also refreshes Peec knowledge from their blog and docs, runs cluster audits, computes AI-visibility opportunity lists, fills source-gap analysis from Peec MCP, creates custom clusters, bulk-assigns pages to clusters, and runs Malte Landwehr's 4-state GEO citation audit. TRIGGER this skill when the user says "run daily marketing report", "run the daily analytics", "generate marketing report", "weekly marketing deep-dive", "run weekly report", "marketing weekly", "refresh peec knowledge", "update marketing analytics", "update peec knowledge", "<your brand> marketing report", "cluster audit", "source gap refresh", "visibility lift", "analyze cluster", "create cluster", "assign pages to cluster", "bulk assign", "geo debug", "citation audit", "why isn't <your brand> being cited", or when a scheduled agent invokes the daily / weekly / knowledge-refresh cron.
---

# Marketing Analytics Workflow

Claude-native marketing analytics pipeline for **your brand**. This skill is the
orchestrator — Python scripts in `scripts/` are atomic building blocks
(pull / parse / aggregate), MCP calls handle the pieces that need MCPs
(Peec AI, Notion), and Claude's reasoning between script calls is what
turns raw data into an analytical report.

**Workflow home:** `<repo-root>`

---

## Decision tree — "I need to…"

```
Run today's marketing report (or yesterday's / specific date)
    → daily-routine.md   (≤10 minutes, single Notion page as output)

Run the weekly deep-dive (previous ISO week or specified)
    → weekly-routine.md  (≤15 minutes, longer narrative Notion page)

Refresh Peec knowledge — scrape their blog/docs for new content and
decide whether to edit this skill
    → knowledge-refresh.md  (weekly; may edit peec-ingest.md or seo-principles.md)

Pull Peec data specifically — used by the daily/weekly routines
    → peec-ingest.md  (already loaded automatically by the routines)

Set up the Notion database for the first time (runs once)
    → notion-schema.md  §"First-run bootstrap"

Apply the SEO + GEO analytical framework to data we just aggregated
    → seo-principles.md  (analytical rubric, always loaded before report generation)

Deep-dive a single topic cluster (all signals: SEO, AI, content, competitors)
    → cluster-audit.md   ("analyze cluster <slug>" — one-cluster report + insights logged)

Fill data/dashboard/source_gaps.json by walking Peec prompts per cluster
    → source-gap-refresh.md   ("source gap refresh" or "/source-gap-refresh")

Act on the AI Visibility Improvements panel (rule-computed opportunities)
    → visibility-lift.md   ("visibility lift <cluster>" or "act on top 5 visibility opportunities")

Create a new custom cluster or bulk-assign pages into a cluster
    → cluster-manage.md   ("create cluster ...", "assign all blogs about X to cluster Y")

Run Malte Landwehr's 4-state GEO citation audit across every Peec prompt
    → geo-debug.md   ("run geo debug", "citation audit", "why isn't [your brand] being cited")
```

---

## Pre-flight — every routine

Before invoking any Python script:

1. **Working directory**: `cd "<repo-root>"`
2. **Virtualenv active**: `source .venv/bin/activate` (create via `python3 -m venv .venv` if missing)
3. **Env vars loaded**: scripts auto-load `.env` via `python-dotenv`. Verify the SA credentials load cleanly with:
   ```zsh
   python -c "import os; from dotenv import load_dotenv; load_dotenv(); print('PATH set:', bool(os.environ.get('GSC_SERVICE_ACCOUNT_JSON_PATH') or os.environ.get('GSC_SERVICE_ACCOUNT_JSON_B64'))); print('GA4:', bool(os.environ.get('GA4_PROPERTY_ID')))"
   ```
4. **Invocation pattern for all scripts**: `python scripts/<name>.py --date YYYY-MM-DD` (or `--week YYYY-Www` for the weekly aggregator). Use `python -m pytest -q` for tests.

---

## File map

| File | When Claude loads it |
|---|---|
| `daily-routine.md` | The user says "run daily marketing report" or equivalent |
| `weekly-routine.md` | The user says "weekly deep-dive" or "run weekly report" |
| `peec-ingest.md` | Always — every daily and weekly run needs the Peec pull sequence |
| `notion-schema.md` | Always — report generation must know the DB shape + page template |
| `seo-principles.md` | Always during report generation — the analytical framework |
| `knowledge-refresh.md` | The user says "refresh peec knowledge" or the cron fires |
| `dashboard-sync.md` | Always — every routine must keep the localhost dashboard in sync (insights + tasks files) |
| `cluster-audit.md` | The user asks for a cluster deep-dive ("analyze cluster product-features") |
| `cluster-manage.md` | The user asks to create a custom cluster or bulk-assign pages |
| `source-gap-refresh.md` | The user asks to refresh source-gap analysis or runs `/source-gap-refresh` |
| `visibility-lift.md` | The user asks to act on the AI Visibility Improvements panel |
| `geo-debug.md` | The user asks to run Malte Landwehr's 4-state GEO citation audit |

**`peec-ingest.md`**, **`notion-schema.md`**, and **`seo-principles.md`** are always-loaded regardless of which routine is running. The routines themselves are the procedural spine; these three are the knowledge they depend on.

---

## Critical rules

1. **Never hardcode brand IDs or engine IDs.** Resolve via `list_brands` (filter `is_own=true`) and `list_models` (filter `is_active=true`) at the start of every run. Playbook anti-pattern §2.5.
2. **Never treat `visibility_count=0, visibility_total=0` as "0% visibility".** `visibility_total=0` means the engine didn't run — flag as coverage gap, do NOT report as weak performance. Playbook anti-pattern §2.6.
3. **Every destructive MCP call requires explicit user confirmation.** The Peec MCP's `delete_*`, `update_brand`, `update_prompt` tools are never called silently. Daily/weekly routines are READ-ONLY on Peec.
4. **Cross-channel framing is the point.** Every report must surface the SEO × GEO × LLM-traffic interactions — not four siloed sections. This is what distinguishes these reports from generic analytics dumps.
5. **Apply `seo-principles.md` before writing.** The framework (E-E-A-T, GEO/AEO rubric, cross-channel opportunity quadrants) is loaded on every report run. Don't rewrite analysis heuristics inline; reference the framework.
6. **Log every run to `knowledge/changelog.md`.** Timestamp, routine name, sources included/missing, Notion page URL, any errors. Makes debugging and historical audits trivial.
7. **Use Notion MCP for all Notion operations.** No direct `notion-api-python` calls. `notion-search`, `notion-fetch`, `notion-create-database`, `notion-create-pages`, `notion-update-page` — always via MCP.

---

## External references

This skill extends two external playbooks:

| External | What it contributes | Path |
|---|---|---|
| **Peec MCP** | 27-tool reference, 11 query recipes, daily/weekly workflow call budgets, anti-patterns, ICP prompt taxonomy. | <https://github.com/peec-ai/peec-mcp> |
| **Agentic SEO Skill** | E-E-A-T framework, CWV thresholds, schema-type validity, GEO/AEO principles, LLM-audit rubric. | `Agentic-SEO-Skill-main/` at the repo root |
| **Your brand knowledgebase** | ICPs, sales process, competitive set, positioning. [describe your product positioning so Claude classifies content correctly] | (your own skill or doc) |

`seo-principles.md` distills these three into a single actionable analytical framework, but for depth on a specific topic (e.g., Peec MCP edge cases) always follow the link back to the source.

---

## Changelog

Append every run to `knowledge/changelog.md`. Example entry template:

```
## 2026-04-21 — Daily report
- Routine: daily-routine
- Target date: 2026-04-20
- Sources included: gsc, ga4, llm_traffic, peec
- Sources missing: (none)
- SEO score: 26.6  |  GEO score: 54.2  |  LLM sessions: 0  |  Organic clicks: 10
- Data quality flags: inactive_engines_majority (high), tag_case_duplicates (low)
- Notion page: https://notion.so/<workspace>/Daily-Report-2026-04-20-<id>
- Notes: brand-driven click profile, 10 of 10 clicks from `<brand>*` queries.
```

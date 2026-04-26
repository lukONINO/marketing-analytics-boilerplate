# marketing-analytics-boilerplate

A Claude-native marketing analytics pipeline for any SaaS that wants to track AI-search visibility (via Peec AI) alongside Google Search Console, GA4, and LLM-referrer traffic — with a localhost dashboard and a set of Claude skills that turn raw data into narrative reports.

This is an open-source boilerplate. Fork it, swap the placeholder brand (`Acme` / `acme.io`) for yours, fill `.env`, and you have a complete weekly + daily AI-visibility analytics workflow.

---

## What's in here

```
marketing-analytics-boilerplate/
├── dashboard/              Next.js 15 + React 19 dashboard (localhost-only, read-only)
├── scripts/                Python 3.10+ data-pull + aggregation scripts
├── .claude/skills/         Claude skill files (workflow orchestration)
├── .agents/skills/         Mirror of skill files for the Claude Agent SDK
├── config/                 YAML configs (topic clusters, Notion schema)
├── data/                   Empty data tree — populated by scripts + skills on first run
├── tests/                  Python unit tests
├── docs/                   Setup guides (Google API credentials, Notion, scheduled agents)
├── .env.example            Env template
├── pyproject.toml          Python project metadata
└── LICENSE                 MIT
```

The dashboard reads **only** the JSON files Claude + the Python scripts produce. There's no DB, no API server, no auth — it's a localhost analytics console you spin up to read your own data.

---

## Architecture

```
                ┌──────────────────────────────────────┐
                │   Claude (with marketing-analytics)  │
                │   skill loaded                       │
                └──────────────────────────────────────┘
                  │                │              │
                  │                │              │
        invokes Python   reads/writes JSON   talks to MCPs
                  │                │              │
                  ▼                ▼              ▼
         ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
         │  scripts/    │  │ data/        │  │  Peec MCP    │
         │  pull_gsc.py │  │ raw/...      │  │  Notion MCP  │
         │  pull_ga4.py │  │ processed/.. │  │  (others)    │
         │  aggregate.. │  │ dashboard/.. │  └──────────────┘
         └──────────────┘  └──────────────┘         │
                  │                │                │
                  └────────────────┴────────────────┘
                            │
                            ▼
                ┌──────────────────────────┐
                │  dashboard/  (Next.js)   │
                │  http://localhost:3000   │
                └──────────────────────────┘
```

Three loops in the system:

1. **Daily / weekly routines** — Claude runs `daily-routine.md` or `weekly-routine.md`, which orchestrates Python scripts (GSC + GA4 + LLM traffic pulls) and Peec MCP calls, joins the four channels, and writes a Notion page + dashboard JSON.
2. **Cluster / GEO debug routines** — `cluster-audit.md`, `geo-debug.md`, `source-gap-refresh.md`, `visibility-lift.md` — deep-dives into one cluster or one analytical angle. Each writes findings into `data/dashboard/insights.json` + `tasks.json`.
3. **Knowledge refresh** — `knowledge-refresh.md` keeps the skill itself up to date by scraping Peec's blog/docs.

---

## Prerequisites

- **Node 18+** (for the dashboard)
- **Python 3.10+** (for the scripts)
- **Peec AI account** — sign up at <https://peec.ai/>; install the peec ai MCP into your Claude Code session
- **Google Cloud service account** with read access to your Search Console + GA4 properties (see `docs/google-credentials-setup.md`)
- **Notion account** with the Notion MCP installed (see `docs/notion-setup.md`) — only needed if you want auto-generated weekly report pages

---

## First-run setup

### 1. Brand the boilerplate

The codebase uses `Acme` / `acme.io` as placeholders. **Most branding is env-var-driven** — set values in `.env` and the dashboard + scripts pick them up without code edits:

```bash
# .env
BRAND_DISPLAY_NAME=YourBrand                  # sidebar wordmark, page titles
BRAND_REGEX=yourbrand                         # branded-query matcher (case-insensitive)
SITE_CANONICAL_ORIGIN=https://yourbrand.com   # base URL + sitemap host
SITE_GENERIC_TITLE=YourBrand — Tagline        # homepage <title> for scrape sanity
NEXT_PUBLIC_OPERATOR_EMAIL=hello@yourbrand.com
GSC_SITE_URL=sc-domain:yourbrand.com
```

For the few places where `Acme` / `acme.io` are still baked into prose (sample data, comments, docstrings), do a one-shot sed:

```bash
cd marketing-analytics-boilerplate
grep -rl "Acme" . --exclude-dir=node_modules --exclude-dir=.venv \
  | xargs sed -i '' 's/Acme/YourBrand/g'    # macOS — drop '' on Linux
grep -rl "acme\.io" . --exclude-dir=node_modules --exclude-dir=.venv \
  | xargs sed -i '' 's/acme\.io/yourbrand.com/g'
```

Skim the resulting diff before committing.

### 2. Fill `.env`

```bash
cp .env.example .env
# Then edit .env and set:
#   GSC_SERVICE_ACCOUNT_JSON_PATH or GSC_SERVICE_ACCOUNT_JSON_B64
#   GSC_SITE_URL=sc-domain:yourbrand.com
#   SITE_CANONICAL_ORIGIN=https://yourbrand.com
#   GA4_PROPERTY_ID=<your GA4 property id>
```

### 3. Edit `config/topic_clusters.yaml`

This file defines your topic ontology — each cluster is a coherent slice of your GTM (a product feature, an industry use-case, a buyer persona, etc.). The boilerplate ships with a 3-cluster example. Replace it with 5-15 clusters that match your business. Once Peec has tracked prompts for a few days, paste the Peec topic IDs (`to_*`) into each cluster's `peec_topic_ids` array.

### 4. Install + run

```bash
# Python side
python3 -m venv .venv
source .venv/bin/activate
pip install -e .

# Dashboard side
cd dashboard
npm install
npm run dev          # → http://localhost:3000
```

The dashboard renders empty-state UI on first run ("No data yet — run X via Claude"). Trigger a workflow:

```
# In your Claude Code session with the marketing-analytics skill loaded:
"run daily marketing report for yesterday"
"run geo debug"
"refresh peec knowledge"
```

The first run takes ~10 minutes (Claude makes ~30 MCP calls + 5 Python script invocations). Each subsequent daily run is ~2 minutes.

---

## Customization checklist

After the brand find/replace, review these files for content you may want to override:

| File | What to customize |
|---|---|
| `config/topic_clusters.yaml` | Your topic ontology — clusters, GSC query patterns, GA4 path patterns |
| `config/notion_schema.yaml` | Notion parent-page ID (Claude creates the DB on first run) |
| `.claude/skills/marketing-analytics/seo-principles.md` | Your product positioning so Claude classifies content correctly |
| `.claude/skills/marketing-analytics/SKILL.md` | The trigger phrases that load this skill |
| `dashboard/src/app/layout.tsx` | Page title, favicon, metadata |
| `dashboard/src/app/globals.css` | Brand color tokens (Tailwind theme) |

---

## Project structure (deeper dive)

### `dashboard/`

Next.js 15 App Router project. Pages:

- `/` — Overview (cross-channel trend chart, time-delta KPIs, recent anomalies, top pages)
- `/topics` — Topic Clusters (cluster ranking + funnel-stage breakdown)
- `/topics/[slug]` — One cluster (KPIs, content readiness, prompts, pages)
- `/strategy` — Strategy (content coverage matrix + things-to-fix action stream)
- `/strategy/prompts` — Prompt Improvements (Peec prompt-set health audit)
- `/strategy/findings` — Findings archive (every Claude-written insight)
- `/tasks` — Tasks board (Kanban with team assignment)
- `/settings/clusters` — Cluster management UI
- `/settings/data` — Manual data refresh + content-scrape trigger
- `/settings/onboarding` — First-run setup checklist

### `scripts/`

Atomic Python scripts (each does one thing):

- `pull_gsc.py` — GSC API → `data/raw/gsc/<date>.json`
- `pull_ga4.py` — GA4 API → `data/raw/ga4/<date>.json`
- `parse_llm_traffic.py` — extracts ChatGPT / Copilot / Perplexity referrers from GA4 → `data/raw/llm_traffic/<date>.json`
- `aggregate_daily.py` — merges all sources for one day → `data/processed/daily/<date>.json`
- `aggregate_weekly.py` — same for weeks
- `assign_clusters.py` — maps scraped URLs to clusters → `data/processed/page_clusters.json`
- `compute_visibility_improvements.py` — rule-based opportunity detection
- `compute_readiness_extras.py` — content-readiness scoring
- `scrape_site.py` — pulls your site's content + schema markup
- `fetch_peec_resources.py` + `refresh_llm_list.py` + `backfill_peec_30d.py` — Peec data utilities

### `.claude/skills/marketing-analytics/`

Workflow skill files:

- `SKILL.md` — entry point; decision tree for "I need to..."
- `daily-routine.md` / `weekly-routine.md` — main report-generation flows
- `peec-ingest.md` — Peec MCP query patterns + tool reference
- `notion-schema.md` — Notion DB shape + first-run bootstrap
- `seo-principles.md` — analytical framework Claude applies before writing
- `dashboard-sync.md` — JSON write contract for `data/dashboard/`
- `cluster-audit.md` — single-cluster deep-dive
- `cluster-manage.md` — create/edit clusters via UI or chat
- `geo-debug.md` — Malte Landwehr's 4-state citation classification
- `source-gap-refresh.md` — fills `source_gaps.json` from Peec
- `visibility-lift.md` — acts on the AI Visibility Improvements panel
- `page-drafts.md` — drafts new pages from tasks
- `knowledge-refresh.md` — keeps this skill up to date

### `.agents/skills/`

Mirror of the same skill files for the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk).

---

## Privacy + security

- The dashboard is **localhost-only**. It has no auth and no API surface beyond `/api/tasks`, `/api/insights`, and similar mutation endpoints — never expose it to the internet.
- The Python scripts read **read-only** from your Google APIs and Peec. They write only to `data/` and `reports/` on your local filesystem.
- `.env` and `data/gcp-key.json` (your service account credential) are gitignored. Don't commit them.
- All Peec MCP destructive operations (`update_prompt`, `delete_*`, etc.) require explicit user confirmation per the skill conventions.

---

## License

MIT. See `LICENSE`.

---

## Acknowledgments

- **Peec AI** — the AI-search visibility platform this pipeline is built around. <https://peec.ai/>
- **Aleyda Solis** — the 3-Layer AI Search Measurement Framework that informs the dashboard's analytical structure.
- **Malte Landwehr** — the 4-state GEO citation classification used by `geo-debug.md`.

This boilerplate is a fork of an internal production workspace, generalized for community use. Issues + PRs welcome.

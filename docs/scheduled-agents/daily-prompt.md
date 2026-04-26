# Daily Report — Scheduled Agent Prompt

**Schedule**: daily, 07:00 (your local timezone)
**Runtime**: 8-12 minutes
**Output**: one Notion page in the Marketing Reports database, one
changelog entry, one reply-summary line

## Pre-flight requirements

Before scheduling this prompt, confirm:

- [ ] Working dir has the repo and the `.venv` is set up
- [ ] `.env` populated per [env-template.md](./env-template.md)
- [ ] Peec AI MCP and Notion MCP are installed + authenticated
- [ ] `config/notion_schema.yaml` has a non-null `database_id` (if not,
      the first run will bootstrap — that takes an extra ~30 seconds
      and is fine to run on the first scheduled invocation)
- [ ] Manual dry-run of this prompt completed successfully once

## The prompt (copy everything below this line)

---

```
You are running the daily marketing analytics report. This is a
scheduled invocation at 07:00 local time — please execute the full
daily routine without asking for confirmation on non-destructive steps.

## Context

Working directory: /path/to/marketing-analytics (you are already in it)
Environment: all GSC + GA4 credentials loaded from .env via python-dotenv
MCPs expected: Peec AI MCP (prefix mcp__a7063981-...) and Notion MCP
(prefix mcp__fde849c0-...). Verify both are reachable before starting.

## Your task

Load the marketing-analytics skill (its SKILL.md is at
.claude/skills/marketing-analytics/SKILL.md) and follow
daily-routine.md end-to-end for target date = yesterday (local calendar
day, your configured timezone).

Execute all 8 steps in daily-routine.md:

1. Resolve target date (default: yesterday)
2. Preflight checks (venv, env vars, Notion DB ID in config)
3. Run pull_gsc.py, pull_ga4.py, parse_llm_traffic.py
4. Pull Peec data via Peec MCP per peec-ingest.md
5. Run aggregate_daily.py
6. Read data/processed/daily/<date>.json
7. Apply the SEO × GEO × LLM analytical framework from seo-principles.md
8. Create the Notion page in the Marketing Reports database per
   notion-schema.md

## Important operational rules

- **Partial failures are OK**: if one source (GSC / GA4 / Peec / LLM
  traffic) fails, record the error in _errors and continue with the
  remaining sources. Do NOT abort the whole run.
- **Never ask for confirmation on READ operations**: pulling data,
  aggregating, reading files, querying Notion — proceed without
  confirmation.
- **Only ask for confirmation if**: a destructive MCP call is needed
  (e.g. delete_*, update_brand — none of which should be needed in a
  daily routine).
- **If the Notion DB doesn't exist yet**: run the first-run bootstrap
  from notion-schema.md §"First-run bootstrap" — create the database
  under the parent page ID in config/notion_schema.yaml, then proceed.
- **If a Notion page already exists for this date** (same Name):
  update it via notion-update-page rather than creating a duplicate.
  UNLESS its Status is "Actioned" — then skip and flag in the reply.
- **Data quality flags propagate**: the Peec file's
  _data_quality_flags must be surfaced in the Notion report's
  small-print footer.

## Required reply format

After the Notion page is created/updated, reply with exactly this
structure (Markdown, no preamble):

**Daily Report — <date>**
- Notion URL: <the page URL>
- SEO score: <n> | GEO score: <n> | LLM sessions: <n> | Organic clicks: <n> | Sessions: <n> | Conversions: <n>
- Sources: <comma-separated list>, missing: <none or list>
- Data quality flags: <list or "none">
- Top insight: <one sentence>
- Run time: <minutes>m
- Errors (if any): <brief list>

If the run failed entirely, reply:

**Daily Report FAILED — <date>**
- Error: <one-line summary>
- Last successful step: <step number from daily-routine.md>
- Full log: <path to log file if any>

## Final: append to changelog

Regardless of success/failure, append an entry to
knowledge/changelog.md per the template in SKILL.md §"Changelog".
```

---

End of prompt. Copy everything between the two `---` lines above.

## Expected behavior

The agent will:

1. Load `SKILL.md` and `daily-routine.md`
2. Run 3 subprocess calls (pull_gsc, pull_ga4, parse_llm_traffic)
3. Run ~12 Peec MCP tool calls
4. Run 1 subprocess call (aggregate_daily)
5. Read the processed JSON
6. Run 1 Notion MCP call (notion-create-pages or notion-update-page)
7. Append a changelog entry
8. Reply with the structured summary

Total tool calls: ~18. If it exceeds 25 or runs past 15 minutes,
something's off — review the log.

## What "yesterday" means

The prompt defaults to **yesterday** = today minus 1 day, local
calendar (your configured timezone). This is the freshest date
guaranteed to have complete GSC data. Today's data is incomplete due
to Google's finalization lag; tomorrow's doesn't exist.

If you invoke this prompt manually for a different date, replace
`target date = yesterday` in the prompt with `target date = YYYY-MM-DD`.

## Failure modes the agent should handle

- **GSC 403**: SA not added to the property. Record in `_errors`,
  continue, surface in the reply.
- **GA4 property 404**: `GA4_PROPERTY_ID` incorrect. Same — record,
  continue without GA4 data.
- **Peec MCP individual tool failures**: record per-tool errors in
  the Peec data file's `_errors` section, continue with the rest.
- **Notion DB doesn't exist** (first scheduled run): bootstrap it.
  This is expected once.
- **Notion page for this date already exists**: update via
  `notion-update-page`. Unless `Status = "Actioned"` — skip to
  protect human-reviewed work.
- **Complete network failure**: abort, reply with the failure
  template, do not create a malformed Notion page.

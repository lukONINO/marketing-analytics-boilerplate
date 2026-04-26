# Weekly Deep-Dive — Scheduled Agent Prompt

**Schedule**: Sunday, 22:00 (your local timezone)
**Runtime**: 12-18 minutes (longer if daily files for the week are missing)
**Output**: one Notion page with a weekly-type deep-dive, one changelog
entry, one structured reply-summary

## Pre-flight requirements

Before scheduling:

- [ ] The daily prompt has been running for at least the 7 days of
      the target week (the weekly aggregator is self-healing, but
      running it over a week with **zero daily files** means it pulls
      all 28+ missing source files on the fly, which takes ~30 min
      instead of ~12)
- [ ] Same env + MCP requirements as the daily prompt
- [ ] `config/notion_schema.yaml` has a non-null `database_id`

## The prompt (copy everything below this line)

---

```
You are running the weekly marketing deep-dive report. This is a
scheduled invocation at 22:00 local time on Sunday — please execute
the full weekly routine without asking for confirmation on non-
destructive steps.

## Context

Working directory: /path/to/marketing-analytics (you are already in it)
Environment: all GSC + GA4 credentials loaded from .env via python-dotenv
MCPs expected: Peec AI MCP and Notion MCP, both reachable

## Your task

Load the marketing-analytics skill (at
.claude/skills/marketing-analytics/SKILL.md) and follow
weekly-routine.md end-to-end for target week = previous full ISO week.

Execute all 8 steps in weekly-routine.md:

0. Resolve target ISO week (default: the previous full Mon-Sun week
   via scripts.utils.dates.previous_full_iso_week())
1. Preflight checks
2. Ensure all 7 daily raw files exist; fill in any missing days by
   running the appropriate pull + ingest per day (tolerate failures)
3. Run aggregate_weekly.py --week <iso_week>
4. Load the processed weekly JSON into context
5. Apply the weekly analytical framework from seo-principles.md
6. Compose the deep-dive page with all 9 body sections:
   - Executive summary (3-5 bullets, commercial-impact-first)
   - Weekly metrics overview
   - Trend analysis (what moved and why)
   - Topic-level breakdown (one row per tracked topic)
   - Winners & losers (queries / pages / topics)
   - Anomalies (σ > 2 only)
   - Opportunity gaps — ALL FOUR quadrants required:
     * Rank without citation (GEO opportunity)
     * Citation without rank (SEO opportunity)
     * LLM traffic without conversion (CRO opportunity)
     * Orphan traffic
     (If a quadrant is empty, write "No items this week" explicitly)
   - Recommended actions (3-7 items, each with owner role + due + rationale)
   - Data freshness footer
7. Create the Notion page in the Marketing Reports database per
   notion-schema.md §"Weekly page body"

## Important operational rules

- **Backfill discipline**: for each day in the target week missing
  raw data, run the 4 pull scripts + Peec ingest ONCE per missing day.
  Do not re-pull days that already have raw files.
- **Cross-channel narrative is required**: the weekly report MUST
  surface SEO × GEO × LLM interactions, not four siloed sections. If
  sample size is too small to draw a cross-channel observation, write
  that explicitly — don't silently omit the section.
- **All four opportunity quadrants must appear**, each with up to
  3 ranked candidates, OR "No items this week".
- **Recommended actions must be specific**: every action has an
  owner role (e.g. "content", "engineering"), a due date
  (this week / next sprint / next month), and a one-sentence
  rationale grounded in data from the weekly aggregate.
- **Partial failures are OK**: if 1-2 days of the week have missing
  data, proceed and flag in the "Data freshness" footer. If >3 days
  are missing, abort and reply with a failure summary explaining
  which pulls failed and why.

## Required reply format

**Weekly Deep-Dive — Week NN YYYY**
- Notion URL: <the page URL>
- Period: <start_date> to <end_date>
- Days with data: <n>/7 (missing: <list or "none">)
- SEO score (avg): <n> | GEO score (avg): <n> | LLM sessions (total): <n>
- Total clicks: <n> | Total sessions: <n> | Total conversions: <n>
- Anomalies detected: <n> (top: <one-sentence descriptor>)
- Opportunity quadrants populated: <n>/4
- Top insight: <one sentence — the 'what matters most' from Exec Summary>
- Recommended actions: <n> items, all with owners
- Run time: <minutes>m

If the run failed:

**Weekly Deep-Dive FAILED — Week NN YYYY**
- Error: <one-line summary>
- Missing days: <list>
- Full log: <path if any>

## Final: append to changelog

Append a weekly entry to knowledge/changelog.md per the template in
SKILL.md §"Changelog".
```

---

End of prompt. Copy everything between the two `---` lines above.

## Expected tool-call budget

| Phase | Tool calls |
|---|---|
| Backfill missing day pulls (worst case: all 7 days) | 7 × 4 = 28 |
| Backfill Peec ingests (worst case) | 7 × ~12 = 84 |
| Weekly aggregator (1 subprocess) | 1 |
| Notion page creation | 1 |
| **Best case** (all 7 daily files present) | **~3** |
| **Typical case** (1-2 days missing) | **~20-30** |
| **Worst case** (cold start) | **~110** |

The worst case is rare — it only happens on the very first scheduled
weekly run if no daily runs preceded it. Schedule the daily prompt to
run for at least a week before enabling the weekly.

## What "previous full ISO week" means

ISO weeks run Monday → Sunday. "Previous full week" means the most
recently completed Mon-Sun span. Run on Sunday 22:00 → target week
is the one that just ended at Sunday midnight (which is approx 2
hours in the future, but the week is 100% past by 22:00). Run on
Monday → same target week (the one that ended ~22h ago).

## Cross-referenced files

- `weekly-routine.md` (skill) — the runbook this prompt executes
- `notion-schema.md` (skill) — page body structure + property mapping
- `seo-principles.md` (skill) — analytical framework
- `config/topic_clusters.yaml` — the topic universe for the
  topic-level breakdown section

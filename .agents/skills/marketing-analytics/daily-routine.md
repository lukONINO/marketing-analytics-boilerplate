# Daily Marketing Report Runbook

Target output: one Notion page in the Marketing Reports database containing
the previous day's cross-channel view + 3-5 key insights + any flagged
anomalies. Target runtime: ~10 minutes including Peec MCP calls.

## Step 0 — Resolve target date

- If the user specified a date ("for April 20"), use it.
- Otherwise default to **yesterday** (ISO date). Tomorrow's data doesn't
  exist yet; today's is typically incomplete (GSC finalization lag).

Store as `<date>` = `YYYY-MM-DD` (strict).

## Step 1 — Preflight

Run the preflight check from `SKILL.md` §"Pre-flight". If any fails:
- Missing venv → create + `pip install -r requirements.txt`
- Missing env → tell the user exactly which var is missing and point to
  `docs/google-credentials-setup.md`
- Missing Notion DB ID in `config/notion_schema.yaml` → run the first-run
  bootstrap in `notion-schema.md` §"First-run bootstrap" before continuing

## Step 2 — Run the three scripted pulls

```zsh
python scripts/pull_gsc.py --date <date>
python scripts/pull_ga4.py --date <date>
python scripts/parse_llm_traffic.py --date <date>
```

**Tolerate failures** — the aggregator handles missing sources. Capture
the error in a local `errors` dict and continue. A 403 on GSC, a GA4
property-ID typo, etc., should not abort the run.

**LLM list freshness check**: if `knowledge/llm_referrer_list.json` is
older than 7 days, prepend `python scripts/refresh_llm_list.py` to the
sequence. Check with:

```zsh
python -c "
import os, time
p = 'knowledge/llm_referrer_list.json'
if not os.path.exists(p): print('stale'); exit()
age = (time.time() - os.path.getmtime(p)) / 86400
print('stale' if age > 7 else f'fresh ({age:.1f} days)')
"
```

## Step 3 — Pull Peec data via MCP

Follow the call sequence in `peec-ingest.md`. Write the result to
`data/raw/peec/<date>.json`. Daily routine uses the same 12-call shape
as a weekly routine but with a 1-day window (start_date == end_date).

If any Peec MCP call fails for a specific brand or topic, record in
`_errors` and continue. Do not abort the whole ingest.

## Step 4 — Aggregate

```zsh
python scripts/aggregate_daily.py --date <date>
```

Reads the four raw files, produces `data/processed/daily/<date>.json`
with summaries, cross-channel joins, composite scores, and deltas vs
prior day + prior 7-day average.

**Verify the log line** before continuing. Watch for:
- `sources_missing` list — any missing source limits the report scope
- `normalization_duplicates_found: N > 0` → stop and escalate; a URL
  normalization regression needs fixing before reporting
- `url_coverage.coverage_ratio < 0.40` → possible data quality issue
  (unlikely, but log a flag for the insights section)

## Step 5 — Load the aggregate into context

```zsh
python -c "
import json
d = json.load(open('data/processed/daily/<date>.json'))
import pprint; pprint.pprint(d, width=140, sort_dicts=False)
" | head -200
```

(Or read the file directly via the Read tool. The full file is ~30-80 KB.)

## Step 6 — Apply the analytical framework

Load `seo-principles.md` into context. Walk the **daily report
checklist** from that file. For each line in the checklist, inspect
the aggregate and note observations. You are not writing the report
yet — you are building the insight list.

Specifically produce:

- **3-5 key insights** for the Notion page's "Key Insights" bullet list.
  These should lead with **what changed** and **why it matters for
  pipeline**, not with raw numbers. E.g., "Acme's share of Competitor
  Comparison prompts stayed at 100% — we own the category answer.
  SEO impressions on [your product] queries jumped 35% WoW with no click
  lift, suggesting we need to tighten metadata on those pages."
- **Cross-channel observations** — specific `<SEO × GEO × LLM>` findings.
  At least one observation that spans ≥2 channels is required. If you
  genuinely cannot find one, write "No cross-channel interaction
  detected today (sample size too small)" and explain.
- **Anomalies** surfaced by the aggregator in `deltas_vs_prior_day` or
  `deltas_vs_prior_7_avg`. Cross-reference against the 28-day baseline
  before attributing causation.
- **Data-quality flags** from `summary.geo.data_quality_flags` —
  specifically the `inactive_engines_majority` flag must be surfaced in
  the Notion page footer every single run until all engines are active.

## Step 7 — Compose the Notion page

Follow the **page body structure** defined in `notion-schema.md`
§"Daily page body". Write the page directly via the Notion MCP using
`notion-create-pages` with the parent set to the Marketing Reports
database's data source ID (stored in `config/notion_schema.yaml`).

### Properties to set on the page

All exact property keys and types are in `notion-schema.md`. Values:

| Property | Value |
|---|---|
| `Name` (title) | `Daily Report – <date>` |
| `Type` | `Daily` |
| `Period start` | `<date>` |
| `Period end` | `<date>` |
| `SEO score` | `scores.seo_score` from aggregate |
| `GEO score` | `scores.geo_score` from aggregate |
| `LLM traffic sessions` | `summary.llm_traffic.sessions` |
| `Total organic clicks` | `summary.seo.total_clicks` |
| `Total sessions` | `summary.traffic.sessions` |
| `Conversions` | `summary.traffic.conversions` |
| `Key insights` | 3-5 bullets — one paragraph per bullet |
| `Anomalies` | multi-select tags drawn from the anomalies list |
| `Status` | `Generated` |
| `Generated by` | `claude-daily` (or `manual` if user invoked directly) |
| `Source data file` | `data/processed/daily/<date>.json` |

### Body structure

See `notion-schema.md` §"Daily page body". Key constraints:

- Use **actual Notion blocks**, not one giant text blob — H2 headers,
  bulleted lists, a table for top queries/pages, a callout for the
  coverage-integrity footer.
- The **Cross-Channel Analysis** section is required. If the user is
  tempted to skip it because of thin data, don't — write "sample size
  too small" rather than omitting the section.
- Include the **Raw data references** toggle at the bottom with the
  exact file paths so anyone (you, future Claude, a teammate) can audit
  the underlying data.

## Step 8 — Verify + sync dashboard + log

After `notion-create-pages` returns the page URL:

1. **Eyeball the Notion page in the browser** if you can — or at least
   fetch it via `notion-fetch` to confirm it rendered cleanly.

2. **Sync the localhost dashboard** per `dashboard-sync.md`:
   - **Append 3-5 insights** to `data/dashboard/insights.json`, drawn
     from the "Key Insights" bullets on the Notion page. Each with
     `source: "daily-routine"`, `source_date: <target_date>`,
     `severity` appropriate (most are `info`; `warning` if the
     insight concerns a >2σ deviation; `critical` if blocking).
   - **Create tasks** in `data/dashboard/tasks.json` for each item in
     the Recommended Actions section. Use the role-based `owner`
     convention ("content", "engineering") and compute a due date
     from the action's timeframe hint.
   - Preserve existing insights + tasks; prepend new, cap insights
     at 200.

3. Append a changelog entry per the template in `SKILL.md` §"Changelog".

4. Reply to the user with:
   - The Notion page URL
   - The three headline numbers (SEO score, GEO score, LLM sessions)
   - Any data-quality flags the user should know about
   - One-sentence "top insight of the day"
   - **Dashboard sync confirmation**: "Dashboard updated — N new
     insights, M new tasks. View at localhost:8001."

## Call budget

| Step | Calls |
|---|---|
| 2 — scripted pulls | 3 (subprocess) |
| 3 — Peec MCP | ≤12 MCP calls per `peec-ingest.md` |
| 4 — aggregate | 1 (subprocess) |
| 7 — Notion MCP | 1 `notion-create-pages` (page + body in one call) |

Target total: **≤17 distinct tool calls**. Over 20 is a signal that
something's wrong with the routine (stuck in a Peec MCP loop, or
re-pulling raw data unnecessarily).

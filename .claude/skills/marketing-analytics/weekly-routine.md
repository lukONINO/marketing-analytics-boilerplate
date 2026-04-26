# Weekly Marketing Deep-Dive Runbook

Target output: one longer narrative Notion page covering a full ISO
week. 15 minutes from invocation to published page. Replaces the daily
report on the weekly run day (typically Sunday 22:00 local time).

## Step 0 — Resolve target ISO week

- If the user specified ("week 17 2026", "last week", "2026-W17"), use it.
- Otherwise default to the previous full ISO week via
  `scripts.utils.dates.previous_full_iso_week()`.
- Format: `YYYY-Www` (e.g., `2026-W17`). Week runs Mon→Sun.

## Step 1 — Preflight

Same as `daily-routine.md` §Step 1.

## Step 2 — Ensure the week's daily files exist

The weekly aggregator is self-healing (builds daily on the fly from
raw sources if a processed daily is missing), but we want to do the
heavy MCP pulls **once per missing day** rather than repeatedly via
fallback:

```zsh
python -c "
from scripts.utils import week_date_range
import json, os, sys
monday, sunday = week_date_range('<iso_week>')
from datetime import timedelta
for i in range(7):
    d = (monday + timedelta(days=i)).isoformat()
    missing_raw = [s for s in ('gsc','ga4','peec','llm_traffic')
                   if not os.path.exists(f'data/raw/{s}/{d}.json')]
    print(d, 'missing_raw:', missing_raw)
"
```

For each day × missing source, run the appropriate pull (per
`daily-routine.md` §Step 2 and §Step 3). Tolerate failures — a weekend
with a known Peec outage is acceptable; missing 4+ of 7 days is not.

## Step 3 — Roll up

```zsh
python scripts/aggregate_weekly.py --week <iso_week>
```

Produces `data/processed/weekly/<iso_week>.json` with:

- `week_summary` — totals + averages for the week
- `trends` — 7-day array per metric (for trend lines in the report)
- `winners_losers` — top 5 growers/decliners for queries, pages, topics
- `topic_view` — per-topic SEO × GA4 × GEO side-by-side (critical section)
- `opportunity_gaps` — three quadrants (see below)
- `anomalies` — days where any metric was >2σ from the 28-day baseline
- `dates_missing` — days where no data was ingested at all

## Step 4 — Load the aggregate into context

```zsh
python -c "
import json, pprint
d = json.load(open('data/processed/weekly/<iso_week>.json'))
pprint.pprint(d, width=140, sort_dicts=False)
" | less
```

## Step 5 — Apply the weekly analytical framework

Load `seo-principles.md` into context. The weekly checklist is stricter
than daily — it requires:

- **Cross-channel narrative**, not just metrics
- **Opportunity quadrants** — see next step
- **Recommended actions** — concrete, specific, assignable

## Step 6 — Compose the deep-dive report

Follow the **weekly page body structure** in `notion-schema.md`
§"Weekly page body". Sections in order:

### 1. Executive summary (3-5 bullets, max)

Lead with the **one thing that matters this week**. Not "visibility was
stable", not "clicks went up". Write the thing the team should know in a
Slack message. Examples:

- "Acme's share of Competitor Comparison prompts climbed from 85% to
  100% — we fully own the category answer in ChatGPT + AI Overview now."
- "[Your product] topic has 7 tracked prompts but only 25%
  visibility. The largest prompt cluster is our weakest. Top MOFU gap
  for April."

### 2. Weekly metrics overview

One callout block with: total clicks, total impressions, total sessions,
total LLM sessions, total conversions, avg SEO score, avg GEO score.
Compare vs prior week (from `deltas_vs_prior_day` on the last daily).

### 3. Trend analysis

One per metric: a sparkline description (written, not plotted — Notion
doesn't natively render charts in MCP-created pages) of the 7-day
trajectory. Flag any day that's >2σ from baseline.

Explicitly answer: "Did anything change direction mid-week?" "Did
weekends look different from weekdays?"

### 4. Topic-cluster breakdown

**Required.** For each cluster in `config/topic_clusters.yaml`, produce
TWO rows — one per language — render as a Notion table:

| Cluster | Lang | SEO clicks | SEO imps | GA views | GEO viz | GEO mentions | Cross-channel note |
|---|---|---|---|---|---|---|---|

The "Cross-channel note" column is where the insight lives. Examples:

- Product Features: "Rank position 8-12, 0 clicks, Peec viz 25%.
  We rank but aren't being clicked AND AI isn't citing us as the top
  answer. Both a CTR/metadata problem AND a GEO content problem."
- Industry Use Cases: "0 SEO clicks, 0 GA views, 26 Peec citations.
  Citation-without-rank gap. The /solutions/example page gets cited by
  AI but isn't surfacing in search. Check indexability + internal linking."

### 5. Winners and losers

Top 5 growers / decliners per: queries, pages, topics. From the
aggregator's `winners_losers` block. Format as three mini-tables.

Annotate each row with a one-line interpretation — "traffic jumped
because of a press mention", "position improved after recent content
refresh", etc. (Claude reasons about this from the context it has.)

### 6. Anomalies flagged

From `anomalies` block. Only include σ>2 events; below that is noise.
For each: the metric, the day, the direction, sigma deviation, and a
hypothesis for cause.

### 7. Opportunity gaps — the four-quadrant view

Always four sections, even if one is empty. If empty, write
"No detected items this week" and continue:

1. **Rank without citation** (SEO wins, GEO absent): pages where we
   have SEO impressions/clicks but Peec doesn't cite them. Action:
   optimize content for LLM citation — add structured data, quotable
   sentences, citable stats.
2. **Citation without rank** (GEO wins, SEO absent): pages cited by
   Peec but with no GSC visibility. Action: the page exists and is
   citation-worthy → fix indexability, improve internal linking,
   check robots.txt / sitemap inclusion.
3. **LLM traffic without conversion** (LLM sessions, 0 conversions):
   high LLM-referral sessions landing on pages that don't convert.
   Action: CRO on those landing pages, consider dedicated LLM-traffic
   landing pages.
4. **Orphan traffic** (ga_views > 0, seo_clicks = 0, geo_mentions = 0):
   pages drawing direct/referral traffic we aren't optimizing. Action:
   decide whether to invest in SEO/GEO for these or deprioritize.

Feed these from `opportunity_gaps` in the weekly aggregate. If a
quadrant has candidates, list top 3 by relevance.

### 8. Recommended actions

**3-7 specific, concrete actions.** Not "improve SEO". Not "write more
content". Examples:

- "Rewrite the meta description on `/product/features` (currently
  148 chars, generic) — target the [your product] keyword cluster
  explicitly. Owner: content. Due: Friday."
- "Activate Claude and Perplexity in the Peec project to unblock
  visibility measurement on our two highest-intent AI surfaces. Owner:
  growth. Due: this week."
- "Publish a comparison page for `/solutions/example` vs Competitor A /
  Competitor B / Competitor C — we're winning Peec citations on
  '[your category] platform' but have no landing page optimized for the
  comparison intent. Owner: growth. Due: next sprint."

Each action should have: owner (role, not name), due date (this week /
next week / this month), and a one-sentence rationale grounded in the
week's data.

### 9. Data freshness footer

Callout block at the bottom:

```
Data coverage: <days_available>/7 days  |  Missing: <dates_missing>
Active engines: <N>/16 (Claude, Perplexity, Gemini inactive — these
are blind spots, NOT zero-visibility)
Generated: <ISO timestamp>  |  Source: data/processed/weekly/<iso_week>.json
```

## Step 7 — Notion page write

Use `notion-create-pages` per `notion-schema.md` §"Weekly page body".

### Properties

| Property | Value |
|---|---|
| `Name` | `Weekly Report – Week NN YYYY` (e.g., `Weekly Report – Week 17 2026`) |
| `Type` | `Weekly` |
| `Period start` | Monday of the ISO week |
| `Period end` | Sunday of the ISO week |
| `SEO score` | `week_summary.avg_seo_score` |
| `GEO score` | `week_summary.avg_geo_score` |
| `LLM traffic sessions` | `week_summary.total_llm_sessions` |
| `Total organic clicks` | `week_summary.total_clicks` |
| `Total sessions` | `week_summary.total_sessions` |
| `Conversions` | `week_summary.total_conversions` |
| `Key insights` | Same 3-5 bullets as the Exec Summary section |
| `Anomalies` | multi-select tags drawn from flagged anomalies |
| `Status` | `Generated` |
| `Generated by` | `claude-weekly` |
| `Source data file` | `data/processed/weekly/<iso_week>.json` |

## Step 8 — Verify + sync dashboard + log + respond

Same pattern as daily §Step 8, plus a richer dashboard sync because
weekly reports carry more actionable content.

Per `dashboard-sync.md`:

1. **Append Executive Summary bullets** (up to 5) to
   `data/dashboard/insights.json` as insights with
   `source: "weekly-routine"`, `source_date: <iso_week>`. The
   "one thing that matters this week" bullet gets `severity: "warning"`
   at minimum (it's the headline of the week); others default to `info`.

2. **Create / update tasks** for every item in the Recommended Actions
   section. Weekly actions typically span sprints, so due dates lean
   toward "end of week" or "next sprint". Tasks from last week's
   report that recur should not be duplicated — update their
   `updated_at` and prepend "Re-surfaced on <date>" to the
   description.

3. **Prune stale tasks** before writing:
   - Archive `done` tasks where `updated_at` > 7 days ago
   - Archive `deferred` tasks where `updated_at` > 30 days ago
   - For `open` tasks older than 14 days, log a `warning` insight:
     "Task X has been open 14+ days — attention needed."

Reply to the user with:

- Notion page URL
- The three headline numbers for the week
- The "one thing that matters this week" (from Exec Summary #1)
- Count of recommended actions
- Dashboard sync summary: "Dashboard updated — N new insights, M new
  tasks, P tasks archived. View at localhost:8001."

## Call budget

| Step | Calls |
|---|---|
| 2 — backfill days × sources | variable; capped at 7 × 4 = 28 |
| 3 — weekly aggregator | 1 subprocess |
| 7 — Notion MCP | 1 `notion-create-pages` |

Target total: **≤33 tool calls**. Spec calls out ≤15 for analysis
alone; the overhead is the per-day Peec backfill. If a week has all
7 daily files already in place, total drops to **≤3 tool calls**.

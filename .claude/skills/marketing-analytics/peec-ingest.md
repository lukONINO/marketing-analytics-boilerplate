# Peec AI Data Ingest — Claude Runbook

This file tells Claude **exactly** how to pull Peec data during the
daily and weekly routines and what shape to write to
`data/raw/peec/<date>.json`. The aggregator in Phase 4
(`aggregate_daily.py`) assumes this shape.

> **Required reading before running this:** the public Peec MCP repo at
> <https://github.com/peec-ai/peec-mcp>. In particular, the
> tool reference (schemas + edge cases) and query recipes.

## Inputs

- `project_id`: resolve once via `list_projects` at session start. Replace
  with your own project id, e.g. `or_REPLACE_WITH_YOUR_PROJECT_ID`.
  Do not hardcode — always derive via `list_projects`.
- `start_date`, `end_date` (ISO `YYYY-MM-DD`). For a daily routine,
  `start_date == end_date`. For a 3-day backfill, set `start_date = end_date - 2`.
- Output directory: `<repo>/data/raw/peec/<date>.json`, one file per date
  in the window.

## Call sequence (≤12 MCP calls for a 3-day window; ≤8 for daily)

Fire context + report calls in parallel where possible. Report calls
are independent of each other — don't serialize them.

### Context — 4 calls (once per session, cache)

1. `list_brands(project_id)` — resolve `is_own` → `own_brand_id`. Never hardcode the brand name.
2. `list_models(project_id)` — filter `is_active=true` to get the engine set that actually ran. Flag any expected engine that's inactive in `coverage_integrity.inactive_engines`.
3. `list_topics(project_id)` — for `topic_id → name` resolution in the aggregator.
4. `list_tags(project_id)` — for `tag_id → name` resolution. **Flag case-duplicates** (e.g. `branded`/`Branded`, `non-branded`/`Non-Branded`) and **flag malformed tag names** (e.g. prompt fragments accidentally turned into tags).

### Brand metrics — 4 calls (one window covers all days)

5. `get_brand_report(dims=[date, model_id])` — leaderboard. All brands × active models × dates. The `brand_id` / `brand_name` come back as columns automatically — do **not** add `brand_id` to `dimensions`, that errors.
6. `get_brand_report(dims=[date, prompt_id], filter=[brand_id in [own]])` — per-prompt authoritative universe (works around `list_prompts` 50-row bug). **Filter to own brand only** to keep payload <100k chars; competitor×prompt detail is weekly territory.
7. `get_brand_report(dims=[date, topic_id], filter=[brand_id in [own]])` — per-topic own-brand trend. Filter to own for size.
8. `get_brand_report(dims=[date, tag_id], filter=[brand_id in [own]])` — ICP/funnel/branded audit for own brand. Filter to own for size.

### Citations — 3 calls

9. `get_domain_report(dims=[date])` — domain leaderboard per day, with `classification` (CORPORATE / EDITORIAL / UGC / REFERENCE / OWN / COMPETITOR / INSTITUTIONAL / OTHER).
10. `get_url_report(filter=[mentioned_brand_id in [own]])` — URLs citing your brand (3-day aggregate, no date dim needed — own-brand citations are typically sparse enough that daily splits add noise, not signal).
11. `get_url_report(filter=[{gap: gt: 0}])` — gap URLs: content where competitors appear and your brand doesn't. 3-day aggregate.

### Opportunities — 1 call

12. `get_actions(project_id, scope=overview)` — ranked opportunity surface. Defaults to last 30 days. **Drill-downs (`scope=owned|editorial|reference|ugc`) are weekly territory — skip in the daily routine.** The Peec playbook warns against >3 drills per session.

### Error handling

If any call fails, record the error in `_errors` with the slice name
and continue. Do **not** abort the whole ingest for one failed slice —
aggregate_daily.py tolerates partial data and flags gaps.

## Prompt taxonomy — funnel-stage discipline

Your Peec prompt set should cover **three journey stages**, not just the
obvious "best X" category queries. Track these separately via tags
(`funnel_stage:TOFU`, `funnel_stage:MOFU`, `funnel_stage:BOFU`) so the
`own_by_tag` aggregation can show per-stage visibility.

**Stage 1 — Awareness** (TOFU): concerns / objections, not brand
queries. "Is X legally safe?", "How do I scale Y?". Awareness prompts
are usually the largest potential pool by far (people not yet
evaluating vendors). Many B2B brands are under-indexed here.

**Stage 2 — Consideration** (MOFU): category + persona variations.
"Best [your category] platform for [your ICP]", "Best [solution] for
[industry]". This is where the bulk of most prompt sets sits.

**Stage 3 — Purchase** (BOFU): vendor/comparison queries. "[Your brand]
vs Competitor A", "Best [your category] for [region]". Watch that
brand-term prompts don't inflate the overall visibility metric — see
the anti-pattern below.

### Anti-pattern: brand-evaluation prompts inflate visibility

Prompts like "[Your brand] vs Competitor A" or "[Your brand] reviews"
have **your brand name in the prompt itself**, so visibility is
guaranteed at 100%. Mixing these with category-level prompts (where
visibility is ~25-50%) inflates the aggregate visibility score.

**Rule**: tag every brand-mention prompt with `branded:branded` and
every non-brand prompt with `branded:non-branded`. The weekly
report's Topic breakdown already separates these via the
`own_by_tag` aggregation; ensure the Peec project has the tags
applied consistently.

**"Non-branded visibility"** is the pipeline-valuable metric.
"Branded visibility" is a brand-health metric (should always be
≥90%). They move for different reasons.

---

## Metric-interpretation gotchas — read before writing claims

Peec exposes several metrics that look similar but measure different
things. Getting these wrong produces insights that are confidently
incorrect.

### `gap_percentage` in `get_actions` ≠ "brand absent from AI answers"

`get_actions(scope=overview)` returns a row per (`action_group_type` ×
`url_classification`). A row with `gap_percentage = 1.0` means:

> *Of the URLs in this classification that AI engines cited as sources,
> 100% did not mention your brand.*

It does **not** mean "your brand is 100% absent from AI answers to
these queries." AI engines routinely mention brands from other knowledge
(direct training, the brand's own citations, non-editorial sources)
even when the cited third-party editorial article doesn't.

**Concrete example:**
- `EDITORIAL/ARTICLE` row: `gap_percentage = 1.0`, `used_total = 44`.
- Incorrect read: "Brand doesn't appear in listicle AI answers."
- Actual read: "Of 44 third-party editorial articles AI engines cited
  this week, none mentioned the brand."
- Reality at the answer level: ChatGPT and Copilot might still list the
  brand in the same week, sourcing from elsewhere.
- Remediation implied by the metric: **third-party placement** on the
  cited domains, not self-publish on your own site. Peec's
  `scope=editorial, url_classification=ARTICLE` drill-down returns
  exactly this advice in the `text` column.

**Rule**: if you want to claim "brand X is absent from answers for
query Y," use `get_brand_report` filtered to that topic/prompt and
look at `mention_count` and `visibility`. If you want to claim "brand
X is missing from third-party editorial", use `gap_percentage` from
`get_actions` — and phrase the claim precisely as "missing from
editorial sources cited by AI," not "missing from AI answers."

### Always drill down `get_actions` before writing recommendations

`scope=overview` is navigation metadata. The `text` column only
appears in the drill-downs (`scope=owned|editorial|reference|ugc`).

**Rule**: before recommending any action derived from a high-gap row
in the overview, call `get_actions` with the matching scope to get
Peec's own recommendation text. If Peec's text contradicts the
recommendation you were about to write, Peec is right — it has the
citation graph that produced the gap and you don't.

The daily routine skips drill-downs (≤3 per session). The weekly
routine and ad-hoc investigations must pull them when the insight is
about a specific classification × domain.

### `visibility` (get_brand_report) ≠ "share of AI answers that include us"

Actually this one is close to what it sounds like, but there's a
subtle gotcha worth naming:

- `visibility` is computed as `visibility_count / visibility_total`
  per row. When no dimensions are set, it's aggregated across all
  prompts, dates, and engines in the range.
- With `dimensions=[model_id]`, each model has its own visibility —
  so the top-level `visibility` is a weighted average, not the max.
- On inactive engines `visibility_total = 0` and Peec reports NaN
  (handled as `null` in our aggregator). Do not treat as "0%."

### `position` (get_brand_report) — lower is better, but missing ≠ worst

- `position = 2.3` means: when the brand appears, it's on average
  the 2.3rd entity mentioned.
- If a brand isn't mentioned at all in a chat, it has no position —
  it's excluded from the `position_count` denominator.
- A brand with visibility 0.10 and position 1.0 looks stronger than
  one with visibility 0.50 and position 2.5, but the second
  generates more total impressions. Report both side by side or
  report `mention_count` as the tiebreaker.

---

## Known data-quality issues (verify in your own project)

Document these in `_errors` or `_data_quality_flags` so the daily
report doesn't misinterpret:

1. **`model_id` dimension may return null in `get_brand_report` rows.**
   On some projects, every row from `get_brand_report(dims=[date, model_id])`
   comes back with `model_id=null`, even though the MCP differentiates
   engines internally (one row per brand × date, one per active engine).
   Work around by attributing the rows per (brand, date) to the active
   engines in alphabetical sorted order. Flag explicitly in the daily
   report if this matters.
2. **Tag case-duplicates.** `branded`/`Branded` and `non-branded`/`Non-Branded`
   often exist as separate tags. Aggregator must lowercase+trim before
   rolling up. Surface as a `tag_quality_flags` entry.
3. **Malformed tag names**: prompt fragments accidentally committed as
   tags. Clean up in quarterly consolidation.
4. **Inactive engines.** Inactive engines return `visibility_total=0` —
   aggregate_daily.py must **not** treat these as "0% visibility", they
   are simply absent. Use `visibility_total>0` as the "engine actually
   ran" check.

## Output schema — `data/raw/peec/<date>.json`

```jsonc
{
  "date": "2026-04-20",
  "fetched_at": "2026-04-22T09:15:00+00:00",
  "project_id": "or_REPLACE_WITH_YOUR_PROJECT_ID",
  "playbook_version": "v1.2 (verified <date>)",
  "playbook_url": "https://github.com/peec-ai/peec-mcp",

  "context": {
    "own_brand": { "id": "kw_...", "name": "Acme", "domains": ["acme.io"] },
    "brands": [
      { "id": "...", "name": "Acme",        "domains": ["acme.io"],        "is_own": true },
      { "id": "...", "name": "Competitor A", "domains": ["competitor-a.com"], "is_own": false }
      // ...
    ],
    "models": {
      "active":   [ { "id": "chatgpt-scraper",          "name": "ChatGPT" } ],
      "inactive": [ { "id": "claude-sonnet-4",          "name": "Claude Sonnet 4" } ]
    },
    "topics": [ { "id": "to_...", "name": "Product Features" } ],
    "tags":   [ { "id": "tg_...", "name": "BOFU" } ],
    "tag_quality_flags": [
      { "issue": "case_duplicate", "tag_ids": ["tg_<id1>", "tg_<id2>"], "names": ["branded", "Branded"] }
    ]
  },

  "coverage_integrity": {
    "active_models_count": 3,
    "total_models_tracked": 16,
    "note": "List inactive engines here — NOT zero-visibility but absent."
  },

  "brand_visibility": {
    // get_brand_report(dims=[date, model_id]) rows for THIS date only.
    // Keep the raw columnar shape Peec returns — it's the most faithful,
    // and parse on the aggregator side. model_id may be null on some
    // projects (see bug above).
    "by_model_raw": {
      "columns": ["brand_id","brand_name","visibility","visibility_count","visibility_total","mention_count","share_of_voice","sentiment","sentiment_sum","sentiment_count","position","position_sum","position_count","date","model_id"],
      "rows": [ /* N rows per date: brands × active models */ ]
    },
    "own_by_prompt": {
      "columns": [...],
      "rows":    [ /* one row per date × prompt for own brand */ ]
    },
    "own_by_topic": {
      "columns": [...],
      "rows":    [ /* one row per date × topic for own brand */ ]
    },
    "own_by_tag": {
      "columns": [...],
      "rows":    [ /* one row per date × tag for own brand */ ]
    }
  },

  "citations": {
    "top_domains_raw": {
      "columns": ["domain","classification","retrieved_percentage","retrieval_rate","citation_rate","mentioned_brand_ids","date"],
      "rows": [ /* top N domains for THIS date */ ]
    },
    // The two below are window-level aggregates,
    // duplicated into each daily file for self-contained use.
    // Aggregator dedupes by (url, date_range) key.
    "_aggregation_window": { "start": "2026-04-19", "end": "2026-04-21" },
    "top_own_urls": { "columns": [...], "rows": [ /* URLs citing own brand */ ] },
    "gap_urls":     { "columns": [...], "rows": [ /* URLs where competitors appear but own brand doesn't */ ] }
  },

  "actions_overview": {
    "columns": ["action_group_type","url_classification","domain","opportunity_score","relative_opportunity_score","gap_percentage","coverage_percentage","used_ratio","used_total"],
    "rows": [ /* from get_actions(scope=overview), aggregated 30-day */ ],
    "_aggregation_window": "trailing 30 days (Peec default)"
  },

  "_errors": [],
  "_data_quality_flags": [
    "model_id dim returns null — work around by positional attribution to active engines alphabetical"
  ]
}
```

## Writing the file — checklist

1. Write atomically: dump to `<date>.json.tmp`, then rename to `<date>.json`. Never leave a half-written file.
2. Pretty-print with `indent=2` for human auditability. File sizes run ~50-150 KB per day; disk is cheap.
3. Re-runs for the same date overwrite (idempotent).

## What NOT to include (scope discipline)

- Per-prompt × per-competitor cross-tabs (too big for daily file; weekly territory).
- `list_shopping_queries` output — irrelevant for B2B SaaS in most cases.
- `list_search_queries` fanout — monthly territory.
- Narrative commentary / analysis — that's the report's job, not the raw file's.

## Scheduled-task integration

The daily / weekly routines invoke this ingest via `daily-routine.md` step 6.
Keep that coupling tight: if the schema above changes, update
`aggregate_daily.py` and `daily-routine.md` in the same commit.

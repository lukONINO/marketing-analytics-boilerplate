# Source-gap refresh — fill data/dashboard/source_gaps.json

Populates the dashboard's Source Gaps panel by walking Peec prompts in
each topic cluster, collecting the domains cited by AI answer engines
(ChatGPT / Copilot / Perplexity / Google AI Overview), and writing
back a gap analysis the dashboard reads at `/insights`.

## When Claude loads this

The user says any of:

- `source gap refresh`
- `/source-gap-refresh`
- `refresh source gaps`
- `update source gaps`
- `pull source gap analysis`

## Why this is Claude-side

Peec's chat-level source citations are only exposed via the MCP
(`list_chats`, `get_chat` — no REST equivalent for the sources list).
The Python scripts can't pull this data. Claude fills the file; the
dashboard reads it. That's why the output is under
`data/dashboard/` (Claude-written) rather than `data/processed/`
(Python-written).

## Process

### 1. Load the cluster config

```bash
cat config/topic_clusters.yaml
```

Collect each cluster's `slug`, `names`, `peec_topic_ids`. The
bilingual panel needs data keyed by `(slug, lang)`.

### 2. For each cluster × lang, walk Peec prompts

Own brand ID: resolve via `list_brands` filter `is_own=true`.

For each cluster:
- Collect all prompt IDs whose topic is in the cluster's `peec_topic_ids`.
  (`list_chats` with `topic_id` filter, or `list_prompts` then filter by
  `topic_id` in results — pick whichever has lower call budget; see
  peec-ingest.md for the recipe.)
- For each prompt in the cluster:
  - Determine prompt language: if the prompt text contains German
    indicators (umlauts, clearly-German tokens), lang="de"; otherwise "en".
    Use detected language to bucket into the right lang row. (Adjust
    rules for your locale — e.g. swap to French / Spanish detection
    if those are your tracked locales.)
  - Call `get_chat(chat_id=<most-recent chat for this prompt>)`
    — or iterate via `list_chats(prompt_id=...)` and pick the latest.
  - From the chat response, collect:
    - `sources[].url` → extract hostname → add to domains tally
    - Whether your brand's domain appears among sources → cite counter
    - Whether `brands_mentioned` includes your brand_id → viz counter
- Keep per-prompt records so `example_prompts` in the output can link
  back to the prompts where each domain appeared.

### 3. Aggregate per (cluster, lang)

For each `(cluster, lang)` bucket, compute:

| Field | Formula |
|---|---|
| `prompts_analyzed` | count of distinct prompts walked |
| `onino_cited_in` | prompts where own brand was in sources OR mentioned |
| `onino_visibility_pct` | `onino_cited_in / prompts_analyzed` (0-1) |
| `top_cited_domains` | top 15 domains by `times_cited` |
| `never_co_cited_with_onino` | domains with `times_cited >= 3` AND `onino_co_cited_count == 0` |
| `cluster_gap_score` | 0-100; `round(100 * never_co_cited_count / max(1, top_cited_domain_count))` |

For each `top_cited_domains` entry:
- `domain` — hostname (normalize: strip `www.`)
- `times_cited` — appearances across prompts in this cluster/lang
- `onino_co_cited_count` — prompts where both this domain AND own brand appeared
- `onino_co_cited_pct` — count / times_cited
- `first_seen` — ISO date of the earliest chat it appeared in
- `example_prompts` — up to 3 prompt texts (trimmed to 120 chars) as illustrations

> Note: the field names `onino_*` are stable schema names that survive
> into the dashboard code. They mean "own brand" — keep them as-is even
> after rebranding. Don't rename the keys.

### 4. Write the file atomically

Write to `data/dashboard/source_gaps.json.tmp` then rename, matching
the write pattern used by `scripts/write_dashboard_insights.py` (atomic
rename via `Path.replace`).

```json
{
  "last_updated": "<ISO datetime>",
  "source_mcp": "peec",
  "schema_version": 1,
  "by_cluster": {
    "product-features": {
      "en": { ... },
      "de": { ... }
    },
    "industry-use-cases": { ... },
    ...
  }
}
```

### 5. Summarize to the user

Short chat reply:

```
Source gaps refreshed across N clusters × 2 languages.

Biggest gaps (cluster_gap_score ≥ 70):
  - <cluster> (<lang>): <top 3 never-co-cited domains>
  - ...

Full detail → dashboard /insights → Source Gaps panel.
```

## Call-budget guardrails

Peec prompt catalogs can be large. Before the walk:

1. Run `list_prompts` once to get the full set + their topic_ids.
2. Filter client-side to prompts whose `topic_id` is in any cluster's
   `peec_topic_ids`.
3. Cap per-prompt `get_chat` calls at 10 most-recent per prompt
   (`list_chats(prompt_id=..., limit=10)` — then pick the latest one).
4. Total call budget: expect ~1 × `list_prompts` + N × `list_chats` +
   N × `get_chat` where N is the filtered prompt count (typically ~30–60).

If the run is projected to exceed 200 Peec MCP calls, ask the user
whether to continue or to restrict to one cluster.

## Anti-patterns

- **Don't count the same domain twice per prompt.** `sources` arrays
  can contain the same URL multiple times; dedupe by (prompt_id, domain).
- **Don't put a prompt into both lang buckets.** Pick one — if a
  prompt looks bilingual, prefer the locale that better matches your
  primary market.
- **Don't write partial updates.** If the walk errors partway, keep
  the previous `source_gaps.json` intact — write to `.tmp` and rename
  only on full success.

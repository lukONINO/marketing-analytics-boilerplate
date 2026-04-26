# GEO debug — page-by-page AI-search relevance audit

Implements Malte Landwehr's 4-step GEO citation framework (CPO/CMO Peec AI)
for your domain. Classifies every tracked prompt into one of four states,
maps each prompt back to its topic cluster and the pages in that cluster,
and produces a prioritized action report the dashboard renders on the
Insights page.

Credit: The 4-step framework is Malte Landwehr's original work — see
<https://github.com/pshbg7/geo-debugging-skill>. This skill file adapts
it to your project's specifics (own project_id + domain, bilingual cluster
mapping, page-level target generation).

## When Claude loads this

The user says any of:

- `run geo debug`
- `geo debug acme.io`
- `citation audit`
- `why isn't [your brand] being cited for <topic>?`
- `/geo-debug`

## The framework (recap)

For each tracked Peec prompt:

| State | Condition | Meaning | Fix |
|---|---|---|---|
| **A** ✅ | `citation_rate > 0.05` | Cited — healthy | Nothing to do |
| **B** ⚠️ | `retrieved_percentage > 0.05` AND NOT A | Retrieved but not cited | Make content more **citeable** (summary blocks, declarative voice, entity density) |
| **C** 🔍 | fanout queries exist AND NOT A/B | Reaches search but not retrieved | Improve **source-worthiness** (EEAT, authoritative voice, unique data) |
| **D** ❌ | no fanout data AND NOT A/B/C | No relevant page | **Create the page** targeting these fanout queries |

Priority order (biggest lift first): **D → C → B → A**. Creating a missing
page unlocks all future citation potential; source-worthiness converts
existing search presence into LLM citations; citeability is the smallest
surface area but the fastest win.

## Inputs (always the same per project)

| Field | Value |
|---|---|
| Peec project_id | `or_REPLACE_WITH_YOUR_PROJECT_ID` (resolve via `list_projects`) |
| Domain | `acme.io` (your brand domain) |
| Date window | last 30 days ending today |
| Cluster config | `config/topic_clusters.yaml` (for prompt_id → cluster, page targets) |
| Page assignments | `data/processed/page_clusters.json` (for target-page suggestions) |

## Process

### Step 1 — Load static context

Read these files (cheap, no MCP):

1. `config/topic_clusters.yaml` — for each cluster, map `peec_topic_ids[]` ↔ cluster slug + bilingual names.
2. `data/processed/page_clusters.json` — for each (cluster, lang) pair, gather the URLs assigned to that cluster so we can list "target pages" on recommendations.

### Step 2 — Parallel MCP pulls

Issue all three in parallel (single message, three tool calls):

1. **`list_prompts(project_id, limit: 10000)`** → all tracked prompts with `id, text, topic_id, tag_ids`.

2. **`get_domain_report`** with:
   - `start_date` = today - 30, `end_date` = today
   - `dimensions: ["prompt_id"]`
   - `filters: [{ field: "domain", operator: "in", values: ["acme.io"] }]`
   - `limit: 1000`

   Returns per-prompt: `retrieved_percentage`, `retrieval_rate`, `citation_rate`.

3. **`list_search_queries`** with the same window, no prompt filter (captures all fanout queries project-wide). Paginate if `totalCount > 1000`.

### Step 3 — Classify each prompt

For each prompt from step 2.1:

```
1. Look up its row in the domain report (match by prompt_id).
2. Look up its fanout queries from list_search_queries (filter by prompt_id).
3. Apply thresholds:
     citation_rate > 0.05           → STATE A
     retrieved_percentage > 0.05    → STATE B
     fanout_count >= 1              → STATE C
     otherwise                      → STATE D
```

Also detect the prompt's language from its text (see `source-gap-refresh.md`'s
language-detection rule — adapt to your locales).
This matters because target-page mapping filters to the same lang.

### Step 4 — For State B prompts only, sample one chat

Call `list_chats(project_id, prompt_id, start_date, end_date, limit: 1)`
to get the most recent chat, then `get_chat(chat_id)` on that one. From
the response, capture the first ~200 characters of the assistant's
mention of your domain (if any) — this gives us the exact phrasing the AI
uses, which drives the citeability fix suggestion.

Call budget: up to N State-B chats × 2 MCP calls each. Most projects have
3–8 State-B prompts, so 6–16 calls total. Skip if budget is tight.

### Step 4b — Derive each prompt's funnel stage from its tag_ids

For each prompt from `list_prompts`, capture both:

1. The full `tag_ids` array (for downstream consumers).
2. A derived `stage` field, set to "TOFU" / "MOFU" / "BOFU" / null based
   on which Peec funnel-stage tag is present in `tag_ids`. Map your own
   tag_ids in `config/topic_clusters.yaml` (or a similar config) like:

   - `<tofu-tag-id>` → TOFU
   - `<mofu-tag-id>` → MOFU
   - `<bofu-tag-id>` → BOFU

   If a prompt carries none of these (or several — pathological), set
   `stage` to null. The dashboard then falls back to a heuristic
   classifier (in `dashboard/src/lib/analytics.ts:classifyStage`) that
   parses prompt text for stage signals.

   Why this matters: the heuristic classifier matches manual Peec
   tagging on ~92% of prompts; persisting the canonical tag_ids gets
   us to 100% and makes the stage breakdown on the Strategy /
   Topic-Cluster pages reliable.

### Step 5 — Map prompts to clusters and target pages

For each prompt:

- **Cluster**: look up `prompt.topic_id` in the config's `peec_topic_ids[]` index. Every topic should map to exactly one cluster after consolidation.
- **Lang**: from step 3's detection.
- **Target pages**: filter `page_clusters.json.assignments` to `{cluster, lang}`. Order by word_count desc. Keep the top 5.
- **Pillar page**: check `data/dashboard/pillar_pages.json` for `<cluster>::<lang>` — surface that explicitly.

### Step 6 — Generate the action recommendations

For each State B/C/D prompt, produce a `recommended_action` string tailored
to its state, following Malte's original guidance but enriched with
project-specific context:

**State D (Create the page)**:
```
Create a new page targeting: <top 3 fanout queries>.
Cluster: <cluster> (<lang>). Suggested slug: /<path>/<slug>.
Internal link sources: <pillar page> + top 3 cluster pages by word_count.
Quality bar: Article/BlogPosting schema, ≥3 numeric claims, author byline
with credentials, ≥1500 words. See .claude/skills/…/page-drafts.md.
```

**State C (Source-worthiness)**:
```
Pages <top 2 target URLs> likely cover <fanout queries> but lack authority
signals. Add:
  • Named author with credentials above the fold
  • ≥2 external citations from recognizable sources (regulators, research bodies)
  • Original data or a unique claim no competitor makes
  • Explicit source attribution ("According to [authoritative source], …")
Expand to cover all fanout queries in one authoritative doc.
```

**State B (Citeability)**:
```
Pages <top 2 target URLs> retrieved at <retrieved_pct>% but cited at
<citation_rate>. AI currently says: "<sampled quote>". Fix:
Add a summary block immediately after the intro:
  • Lead: one declarative sentence with the key claim
  • 2–3 supporting facts (numbers, named entities, specific comparisons)
  • Entity relationship: "[Your brand] is <category> for <ICP> because <differentiator>"
Keep under 100 words. No hedging language.
```

### Step 7 — Write the output

Atomic write to `data/dashboard/geo_debug.json`:

```json
{
  "generated_at": "<ISO datetime>",
  "domain": "acme.io",
  "project_id": "or_REPLACE_WITH_YOUR_PROJECT_ID",
  "window": {
    "start_date": "<YYYY-MM-DD>",
    "end_date": "<YYYY-MM-DD>",
    "days": 30
  },
  "summary": {
    "total_prompts": 45,
    "state_a": 23,
    "state_b": 5,
    "state_c": 10,
    "state_d": 7,
    "citeability_health_score": 0.62
  },
  "prompts": [
    {
      "prompt_id": "pr_…",
      "prompt_text": "…",
      "topic_id": "to_…",
      "tag_ids": ["<tofu-tag-id>", "tg_…"],
      "stage": "TOFU",
      "cluster": "product-features",
      "cluster_display": "Product Features",
      "lang": "en",
      "state": "B",
      "citation_rate": 0.02,
      "retrieved_percentage": 0.35,
      "retrieval_rate": 0.8,
      "fanout_count": 4,
      "fanout_queries_sample": ["…", "…", "…"],
      "sample_chat_id": "ch_…",
      "ai_language_sample": "You might check …",
      "recommended_action": "Add a summary block…",
      "target_pages": [
        "https://acme.io/product/features",
        "https://acme.io/blog/build-vs.-buy-…"
      ],
      "pillar_page": "https://acme.io/product/features"
    }
  ],
  "by_cluster": {
    "product-features::en": {
      "prompt_count": 8,
      "state_counts": { "A": 5, "B": 1, "C": 2, "D": 0 },
      "citeability_score": 0.72,
      "top_priority": "C",
      "urgent_action_count": 2
    }
  },
  "action_groups": {
    "p1_create_pages": [
      {
        "prompt_id": "…",
        "prompt_text": "…",
        "cluster": "…",
        "lang": "…",
        "fanout_queries_sample": ["…"],
        "recommended_action": "Create a new page…"
      }
    ],
    "p2_source_worthiness": [ /* similar shape */ ],
    "p3_citeability": [ /* similar shape, includes ai_language_sample */ ]
  }
}
```

`citeability_health_score` is the fraction of prompts in states A or B
(retrieved + cited OR retrieved not cited — at least the domain is in play).
1.0 = every prompt is working. 0.0 = nothing is reaching AI answers.

Per-cluster `citeability_score` is the same ratio scoped to that cluster.

### Step 8 — Report back in chat

Concise summary, ≤300 words:

```
## GEO debug — acme.io (last 30 days)

Prompts analyzed: 45 · Window: 2026-03-25 → 2026-04-24

✅ 23 Cited            (state A)  — healthy
⚠️  5 Retrieved but not cited (state B)
🔍 10 Ranks but not retrieved (state C)
❌  7 No relevant page       (state D)

Citeability health: 62% (A+B / total).

### 🔴 P1 — Create these pages (7)
1. "<prompt text>" — cluster: <cluster> (<lang>)
   Targets: <fanout queries>
2. …

### 🟡 P2 — Improve source-worthiness (10)
<short summary>

### 🟠 P3 — Make citeable (5)
<short summary>

Full detail in data/dashboard/geo_debug.json and the dashboard
Insights → GEO Health panel.
```

### Step 9 — Auto-spawn dashboard tasks + insights (always)

**This step is non-optional.** Every geo-debug run must write to
`data/dashboard/insights.json` and `data/dashboard/tasks.json` following
the `dashboard-sync.md` contract. Do not ask the user — just do.

#### 9a. One routine insight (always)

Prepend an `info`-severity insight to `insights.json` with:

- `id`: `ins_<YYYY>_<MM>_<DD>_NNN` (next sequence for today)
- `source`: `"adhoc"` (or `"daily-routine"` if invoked from the daily flow)
- `source_date`: today
- `severity`: `"info"`
- `title`: `"GEO debug <YYYY-MM-DD> — citeability <NN>% across 30-day window, <N> P<X> actions in <top-cluster>"`
- `body`: state distribution (A/B/C/D counts + citeability_health_score),
  funnel-stage mix, list of clusters at 100% / clusters below 50%, list
  of task IDs spawned (so the dashboard's "view related tasks"
  affordance can wire up later).
- `tags`: `["geo-debug", "routine", "citeability"]` plus any cluster
  slug that's in the worst state.
- `linked_urls`: `[]` (no Notion page yet for ad-hoc runs)
- `status`: `"open"`

#### 9b. One warning insight per cluster with citeability < 0.30

If any `(cluster, lang)` row in `by_cluster` has
`citeability_score < 0.30` AND `prompt_count >= 3`, prepend a
`warning`-severity insight summarizing that cluster as a focused gap.
Include severity-warranting evidence (the score, the prompt count,
which prompt-states dominate). Skip if there's an existing open
warning insight tagged with the same cluster slug from the last 14
days — don't spam.

Tags: `["geo-gap", <cluster-slug>, "source-worthiness" | "page-creation",
"cluster-priority"]`.

#### 9c. P1 tasks — one per page-to-create action

For each entry in `action_groups.p1_create_pages` (capped at 4 per
run to avoid task-list bloat), prepend a task to `tasks.json` with:

- `id`: `tsk_<YYYY>_<MM>_<DD>_NNN`
- `title`: ≤120 chars. Concrete page action — start with a verb
  ("Build out", "Publish", "Create"). Include the URL or slug.
- `description`: 4-7 sentence brief: source classification (which
  prompt-id, current state, fanout count), acceptance criteria
  (word-count target, schema, internal-link count, named author/
  customer references, ≥3 numeric claims), the geo_debug.json path
  for traceability, and the success metric (state transition in the
  next geo-debug run).
- `owner`: `"content"` (always — page creation is content work)
- `status`: `"open"`
- `source_report`: `"GEO Debug — <YYYY-MM-DD>"`
- `source_url`: `null`
- `created_by`: `"claude-adhoc"` (or `"claude-daily"` from daily routine)
- `cluster`: the prompt's cluster slug (from
  `geoDebug.prompts[].cluster`). Required for the task to surface on
  `/topics/<cluster>` automatically.
- `lang`: `"en"` or `"de"` (from `geoDebug.prompts[].lang`).
- `claude_prompt`: a self-contained Claude prompt the user can paste
  to ask Claude to draft the page. **Required.** Must include:
    1. The action verb ("draft", "expand", "publish")
    2. The target URL/slug
    3. The cluster + language
    4. The fanout queries (or sample) so Claude has retrieval context
    5. Quality bar (word count, schema requirements, named references,
       internal-link count)
    6. The source task id + prompt id for traceability
  Template:
  ```
  draft <action> for <URL> as a <word-count>+ word <type> in <Lang>.
  Cover: <topics from action_groups.recommended_action>.
  Target queries (from geo_debug fanout): <list>.
  Output Article + FAQPage JSON-LD; FAQ entries should match the
  fanout queries verbatim.
  Quality bar: <numeric claims requirement>, <author byline
  requirement>, <internal-link list>.
  Source: <tsk_id> / <prompt_id>.
  ```

#### 9d. P2 source-worthiness — DO NOT auto-spawn individually

Source-worthiness fixes share a pattern (lift cluster pages, add
companion posts). Spawning a task per State-C prompt would create
6-12 tasks per run, all touching the same 2-3 pages — noise.

Instead:
1. If a cluster has ≥3 source-worthiness items, mention it in the
   routine insight body (9a) but don't spawn individual tasks.
2. If the same cluster shows ≥3 source-worthiness items in two
   consecutive runs (≥7 days apart), THEN spawn one consolidated
   task: "Lift &lt;cluster&gt; cluster pages — &lt;N&gt; AI prompts
   stuck in state C for &gt;7 days." Owner `content`, due 6 weeks out.
   Reference both geo_debug runs in the description.

#### 9e. De-duplication

Before writing any task, scan existing `tasks.json` for:
- Same `cluster` slug AND
- Same `lang` AND
- Status `open` or `in_progress` AND
- Created within the last 14 days

If a match exists, do NOT create a duplicate. Instead, update the
existing task's `updated_at` to today and append a one-line note to
its `description`: `"Re-surfaced via GEO debug <YYYY-MM-DD>: prompt
<pr_id> still in state C."` This matches the dashboard-sync.md
sticky-task convention.

#### 9f. Atomic writes

Both files use the standard read-modify-write flow from
`dashboard-sync.md`:
1. Read current JSON.
2. Prepend new entries (most-recent-first ordering).
3. Truncate insights to last 200 entries.
4. Update `last_updated` to current ISO-8601 UTC.
5. Use the `Write` tool to overwrite — no .tmp rename needed at
   Claude's level (the Write tool is atomic from our side).

#### 9g. Surface what was written in the chat report

After writing, the Step 8 chat report MUST end with a one-line
summary of dashboard side-effects, e.g.:

> Dashboard synced — 1 info insight, 1 warning insight (<cluster>),
> 3 new P1 tasks (`tsk_<id_1>`, `tsk_<id_2>`, `tsk_<id_3>`).
> View at `/strategy` (insights) and `/tasks` (kanban).

This makes the audit trail visible without forcing the user to
diff the JSON files.

## Call budget

Expected per run:
- 1 × `list_prompts`
- 1 × `get_domain_report(dim=prompt_id)` — one call retrieves all prompts
- 1–3 × `list_search_queries` (paginated — up to 1000/page)
- 3–8 × `list_chats` for State-B prompts
- 3–8 × `get_chat` for State-B prompts

Total: ~10–20 MCP calls for a full audit. Well under the 200-call guard in
`source-gap-refresh.md`.

## Anti-patterns

- **Don't fabricate citations.** If a prompt has no domain-report row, it
  means the domain wasn't retrieved — write `retrieved_percentage: 0,
  citation_rate: 0`. Don't infer from other signals.
- **Don't run with stale Peec data.** Check `data/raw/peec/` — if the
  newest file is >2 days old, prompt the user to `pull peec data for the
  last 7 days` first. The skill reads live from MCP, not disk, but a
  mismatch between the dashboard's Peec state and MCP's state is
  confusing.
- **Don't classify fewer than 10 prompts.** If `list_prompts` returns
  <10 rows, tell the user their Peec project isn't mature enough yet —
  tracking needs at least a week before the framework produces reliable
  signals.
- **Don't collapse ties.** If a prompt has BOTH citation_rate > 0.05 AND
  retrieved_percentage > 0.05, it's State A (cited wins over retrieved).
  If a prompt has citation_rate = 0.055 AND retrieved_percentage = 0.04,
  it's still A — the thresholds are OR-exclusive in the order A → B → C → D.
- **Don't confuse the domain report's `citation_rate` with Peec's
  `visibility`.** Visibility = brand mentions / total chats (via
  `get_brand_report`). Citation rate = inline URL citations / retrievals
  (via `get_domain_report`). Different denominators, different questions.

# Cluster audit — one-cluster deep-dive

Produces a focused analytical report on a single topic cluster across all
available data sources, writes the findings as insights into the
dashboard, and optionally adds tasks for the high-priority fixes.

## When Claude loads this

The user says any of:

- `analyze cluster <slug>` (e.g. `analyze cluster product-features`)
- `cluster audit <slug>` or `cluster audit <slug> en`
- `deep dive product-features` / `deep dive industry-use-cases de`

If the user omits the language, audit **both** (en and de) and
write two insights — the SEO + GA metrics and the page-content
posture differ between them, the Peec visibility is shared.

## Input

The user supplies a cluster slug. Example slugs (see
`config/topic_clusters.yaml`):

- `product-features`
- `industry-use-cases`
- `company-and-pricing`
- `compliance-and-security`
- `regulation`
- (replace with whatever clusters fit your taxonomy)

If the user gives a name instead of a slug, resolve it via the
`names.en` / `names.de` fields in the config.

## Process

### 1. Load all inputs

| Source | File | Use |
|---|---|---|
| Topic cluster config | `config/topic_clusters.yaml` | names, Peec IDs, patterns |
| Page assignments | `data/processed/page_clusters.json` | which pages belong to the cluster, per lang |
| Latest daily aggregate | `data/processed/daily/<latest>.json` | SEO/GA/LLM/Peec metrics |
| 30-day window aggregates | `data/processed/daily/*.json` (last 30) | trend direction |
| Scraped content | `data/raw/content/<latest>/_inventory.json` + per-page files | body text for claim + schema analysis |
| Visibility improvements | `data/processed/visibility_improvements.json` | already-computed opps for this cluster |
| Source gaps (if filled) | `data/dashboard/source_gaps.json` | competitor co-citation pattern |
| Peec MCP | `list_brands`, `list_chats`, `get_chat` | live competitor visibility per prompt |

Read these via standard Read / Bash tools. For Peec, use MCP.

### 2. Compute the per-lang view

For each language (en + de unless the user specified one):

| Dimension | Where it comes from |
|---|---|
| SEO clicks (30d) | `top_topics[].seo_clicks` for `cluster==slug && lang==L` |
| SEO impressions (30d) | `top_topics[].seo_impressions` likewise |
| GSC CTR (30d) | clicks / impressions from the same rows |
| GA4 page views (30d) | `top_topics[].ga_views` likewise |
| LLM sessions attributed | `llm_traffic.by_landing_page` intersected with assignments |
| Peec visibility (avg) | `top_topics[].geo_visibility` (shared en+de) |
| Peec mentions (30d sum) | `top_topics[].geo_mentions` |
| Page count | `page_clusters.json → by_cluster[<slug>::<L>].page_count` |
| Avg word count | same block |
| Schema coverage | `schema_article_pct` |
| Claim coverage | `pages_with_claims_pct` |
| Competitor position | Peec `list_chats` filtered by the cluster's `peec_topic_ids`, `get_chat` on top N for each, tally competitor domains |

### 3. Identify concrete actions

Always produce exactly **3 actions** per language in priority order:

1. **Highest-leverage visibility fix** — pick from the `RANK_WITHOUT_SCHEMA` or `RANKER_WITHOUT_CLAIMS` rows in `visibility_improvements.json` that belong to the cluster; if none, synthesize from the scraped content.
2. **Competitor counter-move** — reference a specific competitor domain that's co-cited in this cluster but not with your brand (from Peec MCP).
3. **Content gap / new asset** — one net-new piece of content to fill a crack (topic not covered, cluster leaf missing, DE mirror absent).

Each action must include:

- The specific URL (or "new:" prefix if not yet existing)
- The exact change (schema type, claim to add, word count target)
- Expected lift, with reference to the estimated_lift copy from visibility_improvements.json when applicable

### 4. Write the insight

Use the same `write_dashboard_insight` convention as `dashboard-sync.md`:

```json
{
  "source": "cluster-audit",
  "source_date": "<today>",
  "severity": "warning" | "info" | "critical",
  "title": "Cluster audit: <display name> (<lang>) — <1-line verdict>",
  "body": "<4-6 paragraph narrative: metrics, competitor positioning, the 3 actions, estimated lift>",
  "tags": ["cluster-audit", "cluster:<slug>", "lang:<en|de>"],
  "linked_urls": [<top 3 URLs discussed>]
}
```

Severity rules:
- `critical` if cluster visibility <15% AND ≥3 competitor domains are cited where your brand isn't
- `warning` if 15%–30% visibility OR schema_article_pct <50% OR avg word count <800
- `info` otherwise

### 5. Optionally create tasks

If the user said "and log tasks" or "create tasks", write each of the
3 actions as a Task via `dashboard-sync.md` conventions. Owner is one
of `content` / `engineering` / `peec ai` — pick the team that will
actually own the work. Tasks have no due dates; status (open / in
progress / done / deferred) is the only scheduling lever.

## Output template

When reporting back to the user in chat:

```
## Cluster audit — <display name> (<lang>)

**Verdict:** <1 sentence>

| Signal | 30d | vs 30d prior |
|---|---|---|
| SEO clicks | N | ±N% |
| SEO impressions | N | ±N% |
| GA views | N | ±N% |
| AI visibility | N% | ±Np (points) |
| Peec mentions | N | ±N% |
| Pages (this lang) | N | — |
| Avg words/page | N | — |
| Schema coverage | N% | — |
| Claim coverage | N% | — |

**Competitor positioning:**
<2–3 bullets citing specific domains + their Peec positions>

**3 actions (priority order):**
1. <title> — <URL> — <the change> — expected lift: <X>
2. ...
3. ...

Insight logged: <id>
Tasks logged (if asked): <ids>
```

Keep the chat summary under 400 words. Full narrative goes in the
insight body, not the chat reply.

## Anti-patterns

- **Don't audit a cluster with no scraped pages.** If
  `page_clusters.json` has `page_count == 0` for the cluster, the
  content-depth analysis is blind; surface that as the verdict and
  ask the user to run `scripts/scrape_site.py` + `assign_clusters.py`.
- **Don't use SOV without checking `visibility_total`.** If Peec
  has `visibility_total == 0` for a topic, flag coverage gap
  (engines didn't run) — do NOT report as 0% visibility.
  (See anti-pattern in `peec-ingest.md`.)
- **Don't invent numeric claims.** The 3-actions list can ONLY
  reference metrics that came from the data sources above. If a
  number would make the action sharper but isn't available, say
  "commission stat: <description>" instead of making one up.

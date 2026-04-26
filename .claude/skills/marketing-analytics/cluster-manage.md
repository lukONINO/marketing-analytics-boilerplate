# Cluster manage — create clusters and bulk-assign pages from chat

Lets the user ask Claude to do cluster housekeeping without opening the
dashboard. Covers:

- Creating a new custom cluster
- Bulk-assigning a list of URLs to a cluster (by pattern, by keyword,
  or by explicit URL list)
- Moving EN/DE translation pairs together
- Renaming or deleting custom clusters

## When Claude loads this

The user says any of:

- `create cluster <en name> [slug]`
- `assign [pages/urls/blogs] matching <pattern> to cluster <slug>`
- `move all <cluster-a> pages about <topic> to <cluster-b>`
- `bulk assign to cluster <slug>`
- `delete custom cluster <slug>`
- `which pages match <pattern>?` (read-only, useful before an assign)

## Source of truth

All reads + writes flow through the same files the dashboard uses:

| What | Path | Writer |
|---|---|---|
| Cluster config | `config/topic_clusters.yaml` | Editorial (humans) |
| Custom clusters | `data/dashboard/custom_clusters.json` | Dashboard + this skill |
| Page assignments (Python) | `data/processed/page_clusters.json` | `scripts/assign_clusters.py` |
| Manual overrides (Claude + UI) | `data/dashboard/cluster_overrides.json` | Dashboard + this skill |

Effective cluster for a URL = `overrides[url] ?? page_clusters[url].cluster`.

## Process — creating a cluster

1. **Parse the user's request.**
   - EN name, DE name. If only one name is given, ask for the other if
     bilingual support is required for your project.
   - Slug: auto-derive from EN name (lowercase, kebab-case, ASCII-only) if not supplied.

2. **Verify the slug doesn't collide.**
   - Read `config/topic_clusters.yaml` + `data/dashboard/custom_clusters.json`.
   - If the slug exists in either → tell the user and suggest an alternative.

3. **Write the new cluster.**
   - Append to `data/dashboard/custom_clusters.json` via an atomic write:
     ```json
     {
       "slug": "...",
       "names": { "en": "...", "de": "..." },
       "created_at": "<ISO>",
       "source": "custom"
     }
     ```
   - Update `last_updated`.

4. **Respond.**
   - "Created cluster X. It has no pages yet. Want me to assign some?"

## Process — bulk-assigning pages

1. **Resolve the candidate URL list.**
   - If the user gave explicit URLs → use them.
   - If the user gave a pattern ("all blogs matching [keyword]"):
     - Load the most recent per-page records under `data/raw/content/<latest>/`
     - Match against title + body_text (case-insensitive).
     - Present 3-5 matches as a sanity check: "Found N candidates: [first 3 titles]. Proceed?"
   - If the user referenced a cluster ("all EN pages in <cluster>"):
     - Load `page_clusters.json`, filter by cluster + lang.

2. **Confirm the target cluster exists.**
   - Look up the slug in config + custom. If missing, create it (see above) or error.

3. **Decide pair-move.**
   - Default: YES, move translation pairs too (matches dashboard default).
   - If the user explicitly said "just EN" or "don't move pairs" → no pair expansion.

4. **Apply the overrides.**
   - Load `data/dashboard/cluster_overrides.json`.
   - For each URL in the resolved list:
     - If `includePairs=true`: resolve the pair from the URL's
       `translation_pair_url` (from page_clusters.json) or via the
       same fuzzy matcher used by the dashboard.
     - Upsert an override: `{ url, cluster, updated_at, source: "claude" }`.
   - Atomic write.

5. **Verify.**
   - Re-read `cluster_overrides.json`; confirm the new entries are present.
   - Tell the user: "Moved N pages to X (including M translation pairs)."

## Process — deleting a custom cluster

1. **Verify it's custom.**
   - YAML-defined clusters are read-only from this skill. If the user
     asks to delete a YAML cluster, tell them to edit the YAML
     directly and re-run `scripts/aggregate_daily.py`.

2. **Check for orphans.**
   - Load `cluster_overrides.json`. If any override points at this
     slug, tell the user and ask: "N pages currently overridden into
     this cluster will become unassigned. Continue?"

3. **Apply.**
   - Remove the cluster entry from `custom_clusters.json`.
   - Remove any `cluster_overrides.json` rows that pointed at it
     (those pages fall back to their Python-assigned cluster).

## Example invocations

### Create + assign in one go

> "Create a custom cluster called '[Your industry] Use Cases' and assign
> all blogs mentioning '[keyword A]' or '[keyword B]' to it."

1. Slug: `[your-industry]-use-cases`. Names: EN = "[Your industry] Use Cases",
   DE = "[Your industry]-Anwendungsfälle" (derive; confirm with user if unsure).
2. Create cluster via custom_clusters.json.
3. Search scraped content for "[keyword A]" OR "[keyword B]" in
   title/body → list matches.
4. Present 3 sample matches, ask for confirmation.
5. On yes, apply overrides with pair-move enabled.

### Move a cluster's pages to another

> "Move everything in the <cluster-a> cluster to <cluster-b>."

This one's tricky — the user may mean "merge them into a renamed
cluster". Clarify first: "The slug `<cluster-a>` already covers both —
do you want to rename it, or move to a different slug?"

### Bulk-reassign by URL list

> "Move these 8 URLs to <cluster>:
>  https://acme.io/blog/post-a
>  https://acme.io/blog/post-b ..."

Direct application — no pattern matching needed.

## Anti-patterns

- **Never auto-assign without showing sample matches first.** When the
  user gives a pattern, always verify 3-5 matches before writing.
- **Never edit `config/topic_clusters.yaml` from this skill.** YAML is
  editorial. Custom clusters live in JSON for a reason.
- **Never delete `page_clusters.json` entries.** That file is the
  Python pipeline's output. Always write to `cluster_overrides.json`
  instead — the dashboard merges them at read time.
- **Log every bulk operation to `knowledge/changelog.md`** if it
  touches >20 URLs. Makes auditing obvious.

## Rollback

If the user says "undo my last assign" or similar:

1. Read `cluster_overrides.json`.
2. Find entries with `source: "claude"` from the most recent
   `updated_at` batch.
3. Remove them (write an empty `cluster` back, which the helper
   interprets as "clear override").
4. Confirm with the user.

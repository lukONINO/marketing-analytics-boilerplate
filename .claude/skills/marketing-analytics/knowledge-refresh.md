# Peec Knowledge Refresh Runbook

**Cadence**: weekly (Wednesday 03:00 local time is a recommended cron
slot) or on-demand ("refresh peec knowledge").

**Goal**: detect new Peec AI blog posts / docs pages, read them, and
decide whether any of them changes how the workflow should operate —
then edit the skill's own markdown files so future runs reflect the
new knowledge.

This is the routine that makes the workflow self-improving.

---

## Step 1 — Run the fetcher script

```zsh
python scripts/fetch_peec_resources.py
```

> **Note:** This script is referenced in the roadmap but may not be
> implemented in your repo yet. Until it ships, fall back to the manual
> path in Step 1.alt below. Remove this note when `fetch_peec_resources.py`
> lands.

### Step 1.alt — Manual fallback while the script is missing

Use WebFetch against the Peec blog index + docs sitemap:

1. Fetch `https://peec.ai/blog` and extract post URLs (keep only those
   matching `^https://peec.ai/blog/[^/]+$`).
2. Fetch `https://docs.peec.ai/sitemap.xml` (if it exists) or crawl
   `https://docs.peec.ai/intro-to-peec-ai` for same-domain links.
3. Diff against `knowledge/seen.json` (expected shape: `{url: fetched_at_iso, ...}`).
4. For each new or changed URL, use WebFetch to pull the content and
   save a markdown version to:
   - `knowledge/peec_blog/<slug>.md` for blog posts
   - `knowledge/peec_docs/<slug>.md` for docs pages
5. Update `knowledge/seen.json` with the URL + current ISO timestamp.

If `knowledge/seen.json` doesn't exist yet, treat all discovered URLs
as "new" on the first run. Initialize it empty: `{}`.

The automated script version (when it lands) will do the same thing
via `trafilatura` for content extraction and will be more robust to
HTML drift on the upstream pages.

---

## Step 2 — For each new/changed piece of content

Read it into context. Then answer these questions in sequence — each
"yes" triggers a specific edit to the skill:

### Q1. Does it introduce a new Peec metric, dimension, or MCP tool?

Examples: "Peec now ships a `mention_share_growth_rate` field", "A new
dimension `model_channel_id` is now filterable", "Fanout queries now
return a `products[]` array".

**If yes** → edit `peec-ingest.md`:
- Add the new field/tool to the schema documentation
- If it's a new tool: add to the 12-call sequence where appropriate
- If it's a new field: update the output-file schema section
- Run the daily routine once to verify the new field is being captured

### Q2. Does it change how a metric should be interpreted?

Examples: "Visibility formula now uses rolling 14-day baseline instead
of snapshot", "Sentiment score range changed from 0-100 to -1 to +1",
"Share of voice is now weighted by prompt volume".

**If yes** → edit `seo-principles.md`:
- Update the relevant "What good looks like" section
- If score calibrations changed, update `compute_geo_score` formula
  in `scripts/aggregate_daily.py` and bump `GEO_SCORE_VERSION` in
  the docstring
- Write a changelog entry explaining the recalibration so historical
  comparisons aren't misread

### Q3. Does it describe a new analytical framework or workflow?

Examples: "AI Search Market Share 2026 Report methodology",
"How to audit a prompt set for ICP drift", "The 'Signal-to-Noise
Index' for AI visibility".

**If yes** → decide between:
- A **new workflow file** under `.claude/skills/marketing-analytics/`
  (e.g., `quarterly-prompt-audit.md`) with a routing entry added to
  `SKILL.md` §"Decision tree"
- A **section addition** to `seo-principles.md` if it's an analytical
  principle rather than a full workflow

### Q4. Does it document a bug or anti-pattern we should avoid?

Examples: "update_prompt.text is now silently ignored", "list_prompts
has a pagination cap at 50 on certain projects".

**If yes** → edit `peec-ingest.md` §"Known data-quality issues" with
the specific anti-pattern and the workaround.

### Q5. None of the above?

Log it as informational. Append to `knowledge/changelog.md` under the
entry for this refresh run, but no skill file changes needed.

---

## Step 3 — Commit discipline

Every skill file change from this routine gets its own commit with a
`skill:` prefix:

```zsh
git add .claude/skills/marketing-analytics/<file>
git commit -m "skill: updated peec-ingest.md after Peec blog post \
\"New share-of-voice metric introduced\" (2026-04-18)"
```

Separate commits per file. Never mix a knowledge-refresh commit with
unrelated changes — the `skill:` prefix is grep-able and the single-
concern commits make rollback trivial if a refresh misreads a change.

---

## Step 4 — Log the run

Append to `knowledge/changelog.md`:

```
## 2026-04-23 — Peec knowledge refresh
- New URLs fetched: 3
  - peec.ai/blog/new-share-of-voice-methodology (2026-04-21)
  - peec.ai/blog/activating-claude-in-your-project (2026-04-19)
  - docs.peec.ai/prompt-taxonomy-guide (2026-04-17)
- Skill files edited:
  - peec-ingest.md (added `mention_share_growth_rate` schema note)
  - seo-principles.md (§"GEO — what good looks like"
    updated for new SoV formula)
- Commits: abc1234, def5678
- No changes needed: docs.peec.ai/prompt-taxonomy-guide (covered
  existing content)
```

Even when no changes are made, log **"no knowledge changes"** with
the date — the empty log is still useful for tracking that the
refresh routine ran.

---

## What NOT to update automatically

- **config/topic_clusters.yaml** — the bilingual cluster config.
  Cluster slugs, names, Peec topic IDs, and regex patterns are
  editorial, tied to your ICP and prompt set. Never edit from this
  routine.
- **config/notion_schema.yaml** — DB ID is set-once, should never be
  rewritten.
- **SKILL.md trigger phrases** — adding new Peec features doesn't
  necessarily warrant new trigger phrases. Only add phrases when a
  new workflow routine exists.

---

## Budget

Per-refresh tool call budget:

- WebFetch × (blog index + docs sitemap) = 2 (or 0 if the script
  handles it)
- WebFetch × new URLs — typically 0-5 per week
- Edit × skill files — typically 0-2 per week
- Bash × git commits — 1-3 per week

Total: **≤15 tool calls per weekly refresh.** If it runs longer,
something's off — likely too many Peec blog posts changed at once, or
the script is failing silently.

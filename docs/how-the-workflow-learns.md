# How the Workflow Learns

Why this repo isn't a static set of scripts. How the skill self-updates as
Peec ships new capabilities. What makes the analytical framework improve
over time.

---

## The core idea

Most analytics pipelines decay. A new vendor feature ships, nobody notices,
the pipeline keeps querying the old shape, reports slowly become wrong.
The workflow limps along until someone does a big audit and finds 12
things that changed.

This pipeline is designed to **notice**.

Every Wednesday at 03:00 (your configured timezone), a Claude Code agent:

1. Scrapes Peec AI's blog (<https://peec.ai/blog>) and docs
   (<https://docs.peec.ai>)
2. Diffs new URLs against `knowledge/seen.json`
3. For each new piece of content, reads it and asks: **"does this change
   how our skill should operate?"**
4. If yes → edits the skill's own markdown files, commits with a
   `skill:` prefix
5. Logs the run to `knowledge/changelog.md` whether anything changed or not

No-one has to remember to re-read Peec's docs. The workflow does it on a
cadence, and Claude's reasoning is the decision layer that catches things
worth acting on.

---

## What "edit the skill" actually means

The skill at `.claude/skills/marketing-analytics/` is a folder of
markdown files. Six of them today:

| File | What it contains | When the refresh edits it |
|---|---|---|
| `SKILL.md` | Trigger phrases, decision tree | Rarely — new trigger phrases are human decisions |
| `daily-routine.md` | Daily runbook | Only when a Peec MCP surface change alters the call sequence |
| `weekly-routine.md` | Weekly deep-dive runbook | Same as above |
| `peec-ingest.md` | Peec call sequence + output schema + data-quality gotchas | **Most common edit target** — any new Peec field, tool, or bug lands here |
| `notion-schema.md` | Notion DB schema + page templates | Rarely — only if we add new report sections |
| `seo-principles.md` | Analytical framework (SEO + GEO + LLM traffic) | When Peec publishes methodology updates (benchmarks, new scoring approaches, etc.) |
| `knowledge-refresh.md` | This routine's own runbook | When the refresh process itself needs updating |

The five questions the refresh routine asks, from
[`knowledge-refresh.md`](../.claude/skills/marketing-analytics/knowledge-refresh.md) §Step 2:

> **Q1.** Does it introduce a new Peec metric, dimension, or MCP tool?
> → edit `peec-ingest.md`
>
> **Q2.** Does it change how a metric should be interpreted?
> → edit `seo-principles.md` (and possibly recalibrate score formulas)
>
> **Q3.** Does it describe a new analytical framework or workflow?
> → add a new workflow file or extend `seo-principles.md`
>
> **Q4.** Does it document a bug or anti-pattern we should avoid?
> → edit `peec-ingest.md` §"Known data-quality issues"
>
> **Q5.** None of the above?
> → log informational, no edits

Each edit is its own commit with a `skill:` prefix, so
`git log --oneline --grep '^skill:'` gives you a clean history of
everything the workflow has learned.

---

## Example: how the first refresh might go

The scraper pulls 28 blog posts on its first run. Among them:

- **"Peec AI MCP"** blog post — documents a recent MCP update, the one
  the Peec MCP Playbook already encoded. Claude compares it against
  `peec-ingest.md`; nothing new beyond what the playbook already covers.
  **No edit.** Logged.

- **"Citation rate benchmarks from over 1M citations"** — provides
  concrete benchmark ranges: 0.2-0.4 citation_rate for editorial content,
  above 1.0 for "high-authority" sources. This is **interpretation
  guidance**. Claude updates `seo-principles.md` §"GEO — what good looks
  like" to include these benchmarks so future reports can interpret
  `citation_rate` values against a reference range.
  **One edit, one commit.**

- **"Introducing Actions"** — Peec describes their new `get_actions`
  opportunity-scored recommendations tool. The playbook already covers
  this; `peec-ingest.md` already calls it. Claude verifies coverage
  against the blog post, finds nothing missing, logs as informational.
  **No edit.**

- **"How to choose the right prompts for LLM tracking"** — introduces a
  framework for prompt-set quality auditing. Claude decides this
  warrants a new workflow file (`quarterly-prompt-audit.md`) because
  it's a standalone procedure, not an inline principle. Creates the new
  file + adds a routing entry to `SKILL.md`'s decision tree.
  **Two edits, two commits.**

Net result from the first refresh: ~3 commits, ~2 skill files touched,
a changelog entry summarizing what was learned.

Six months later, looking back through `git log --grep skill:`, you
have a complete audit trail of how the analytical framework evolved
alongside Peec's product.

---

## Why this matters more than it looks

The short version: **the workflow doesn't need a human custodian.** Once
the three scheduled agents (daily / weekly / knowledge-refresh) are
wired in, the marketing analytics loop runs autonomously _and stays
current with upstream changes_.

Without the knowledge-refresh loop, the workflow would slowly decay:

- Peec ships a new metric → we don't capture it
- Peec deprecates a field → our aggregator silently breaks
- Peec publishes new methodology → our interpretation stays stale

With the loop, the pipeline catches these within a week.

---

## How to verify the loop is actually learning

Periodic sanity checks for future-you:

### Every month — check the learning cadence

```zsh
git log --grep '^skill:' --since='30 days ago' --oneline
```

Zero commits for 30+ days means either (a) Peec is genuinely quiet, or
(b) the refresh isn't running. Check `knowledge/changelog.md` — there
should be at least 4 refresh entries per month (one per Wed run). If
the changelog is stale, the cron isn't firing.

### Every quarter — read what's been learned

```zsh
# Summarize the skill: commits
git log --grep '^skill:' --since='3 months ago' --pretty='%s%n%b%n---'
```

Skim it. Did anything substantive change? Did the commits make sense?
If the commits look like noise (e.g. rewording for no reason), the
Q1-Q4 decision logic may be too permissive — tighten in
`knowledge-refresh.md`.

### Every year — audit the analytical framework

Read `seo-principles.md` end-to-end. Are the benchmarks still current?
The framework should have grown since its first version (this repo was
seeded with ~250 lines; after a year of refreshes, expect 400-600
lines with more specific scoring guidance, current benchmarks, updated
anti-patterns).

---

## What the loop CANNOT do

Boundaries so future-you understands why some things still need a human:

- **Adding new data sources.** If you want to add a LinkedIn Analytics
  pull or a Clearbit enrichment, that's a human-designed extension.
  The refresh loop only updates how we use the data sources we already
  have.
- **Changing `config/topic_clusters.yaml`.** Topic regex patterns are
  editorial — they're tied to your ICP and commercial priorities.
  The refresh is forbidden from auto-editing this file.
- **Changing the report format in Notion.** `notion-schema.md` is
  editable by the refresh, but the refresh doesn't proactively
  redesign the report. It only updates when Peec explicitly introduces
  a new field we should surface.
- **Committing + pushing code changes.** The refresh only commits. You
  (or a deploy pipeline) push.
- **Running destructive Peec MCP ops.** `delete_prompt`,
  `delete_brand`, etc. are outside the refresh's permissions.

---

## What to do when the loop makes a mistake

It will happen. Claude will misread a blog post and make a bad edit, or
over-interpret a methodology change. Recovery is cheap because every
edit is one commit:

```zsh
# Inspect the suspect commit
git show <sha>

# If wrong, revert it
git revert <sha>

# Re-run the refresh with the original URL now in seen.json → won't be
# re-fetched. If you want it re-evaluated, remove its entry from
# knowledge/seen.json and re-run.
python scripts/fetch_peec_resources.py --force  # nuclear option
```

Because the refresh commits every edit as its own atomic `skill:`
commit, the blast radius of a bad interpretation is one revert.

---

## The broader design principle

This isn't just about Peec. The same pattern generalizes:

> **Any upstream data source your workflow depends on should have a
> scheduled agent reading its changelog, blog, or docs — and a
> decision procedure for when to update your own tooling.**

Peec → our skill is the implementation here. The same pattern would
work for Google's SEO updates, GA4's schema changes, Notion's MCP
updates, etc. Each is a candidate for its own knowledge-refresh
routine with a scoped set of files it's allowed to edit.

For now, Peec is the fastest-moving dependency, so that's where we
spent the implementation time. If Google Search Central starts
shipping breaking changes weekly, this pattern extends there next.

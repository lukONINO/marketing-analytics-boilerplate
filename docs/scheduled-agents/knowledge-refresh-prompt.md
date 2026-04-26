# Peec Knowledge Refresh — Scheduled Agent Prompt

**Schedule**: Wednesday, 03:00 (your local timezone)
**Runtime**: 5-15 minutes (0 if nothing new upstream)
**Output**: updated skill files (when Peec ships new capabilities),
zero-or-more `skill:` prefixed commits, one changelog entry, one reply

## What this does

This is the routine that makes the workflow **self-improving**. Once a
week, a Claude Code agent:

1. Scrapes Peec's blog index and docs tree
2. Diffs new/changed URLs against `knowledge/seen.json`
3. Reads the new content
4. Decides whether any new capability changes how our skill should operate
5. Edits the skill markdown files if so, one commit per change with a `skill:` prefix

In a typical week, the answer is "no new content — logged, no changes".
Once a quarter or so, Peec ships a meaningful update and the skill
self-updates.

## Pre-flight requirements

- [ ] Same repo + venv as the other two prompts
- [ ] `.env` populated — but this prompt doesn't need Google / Notion /
      Peec MCP credentials. It only needs network access to
      `peec.ai` and `docs.peec.ai` + `git` for commits.
- [ ] The agent host must have git configured with an identity for
      the `skill:` commits to have a sensible author — not a Peec MCP
      concern, but a git hygiene one:

```zsh
git config user.email "growth-agent@example.com"
git config user.name  "Growth Agent"
```

## The prompt (copy everything below this line)

---

```
You are running the Peec knowledge refresh. This is a scheduled
invocation at 03:00 local time on Wednesday — please execute the
full knowledge-refresh routine autonomously.

## Context

Working directory: /path/to/marketing-analytics (you are already in it)
No GSC/GA4/Notion/Peec-MCP credentials needed — this routine uses
only the repo, WebFetch, git, and file writes.

## Your task

Load the marketing-analytics skill (at
.claude/skills/marketing-analytics/SKILL.md) and follow
knowledge-refresh.md end-to-end.

Execute all 4 steps:

1. Fetch Peec blog + docs URLs (via scripts/fetch_peec_resources.py
   if it exists; otherwise fall back to the manual WebFetch path
   described in knowledge-refresh.md §"Step 1.alt")
2. For each new/changed URL, read the content and answer the 5
   questions in knowledge-refresh.md §"Step 2":
   - Q1. Does it introduce a new Peec metric, dimension, or MCP tool?
         → If yes, edit peec-ingest.md
   - Q2. Does it change how a metric should be interpreted?
         → If yes, edit seo-principles.md (and possibly recalibrate
           compute_geo_score / compute_seo_score in aggregate_daily.py)
   - Q3. Does it describe a new analytical framework or workflow?
         → If yes, add a new workflow file or extend seo-principles.md
   - Q4. Does it document a bug or anti-pattern?
         → If yes, edit peec-ingest.md §"Known data-quality issues"
   - Q5. None of the above → log as informational, no edits
3. Commit discipline: every skill file change gets its own commit
   with a "skill:" prefix and a message that cites the upstream
   source URL + date
4. Log the run to knowledge/changelog.md per the template in
   knowledge-refresh.md §"Step 4", even if no changes were made

## Important operational rules

- **Read before edit**: always fetch the full content of a new URL
  and reason about its implications BEFORE making any skill edits.
  Do not pattern-match on titles.
- **Never auto-edit config/topic_clusters.yaml**: topic regex
  patterns are editorial, tied to your ICP. Out of scope for this
  routine.
- **Never auto-edit config/notion_schema.yaml**: DB ID is set-once.
- **Never add new trigger phrases to SKILL.md automatically**: new
  trigger phrases should be a human decision.
- **Budget discipline**: ≤15 tool calls for the full refresh. If
  the refresh needs more than 15 calls, split into a follow-up
  task and flag in the reply.
- **Commit granularity**: one skill file change = one commit. Never
  bundle an unrelated change with a skill: commit.

## Required reply format

**Knowledge Refresh — <date>**
- URLs fetched: <n>
- New or changed content: <list of URLs, or "none">
- Skill files edited: <list with one-line rationale each, or "none">
- Commits created: <list of short SHAs with messages, or "none">
- Informational-only content logged: <n>
- Run time: <minutes>m

If no changes were needed:

**Knowledge Refresh — <date> — no changes**
- URLs fetched: <n>
- All seen or irrelevant: confirmed
- Run time: <minutes>m

If the run failed:

**Knowledge Refresh FAILED — <date>**
- Error: <one-line summary>
- Last successful step: <step number from knowledge-refresh.md>
```

---

End of prompt. Copy everything between the two `---` lines above.

## Expected outcomes by frequency

| Week type | Frequency | What happens |
|---|---|---|
| Quiet (no new content) | Most weeks | 0 edits, 0 commits, changelog entry "no knowledge changes" |
| Blog post | Monthly-ish | 1-2 reads, usually 0 edits (most blog posts are not instruction-changing), 1 informational changelog entry |
| Methodology change (major) | Quarterly | 1-3 skill file edits, 1-3 `skill:` commits, detailed changelog entry explaining what changed and why |
| MCP surface change | Rare | 2-4 skill file edits + possible script changes in `scripts/`, multiple commits |

## What this prompt will NEVER do

- Push commits to the remote (only `git commit`, not `git push`)
- Run destructive Peec MCP tools (it doesn't use Peec MCP at all)
- Touch `data/` — no analytics data is read or written
- Update the Notion report templates — those are editorial

All it can do is: fetch public web content, save markdown under
`knowledge/peec_*/`, edit the 6 skill markdown files, and commit.

## Follow-up recommended

The first scheduled knowledge-refresh should run with a human
watching. Check:

1. Does `fetch_peec_resources.py` successfully find the Peec blog/docs
   URLs? (If the script isn't implemented yet, the manual WebFetch
   fallback should work.)
2. Is `knowledge/seen.json` being initialized on first run?
3. Does the agent read the fetched content before editing?
4. Are `skill:` commits well-formatted?

After 2-3 successful runs, the refresh can go fully hands-off.

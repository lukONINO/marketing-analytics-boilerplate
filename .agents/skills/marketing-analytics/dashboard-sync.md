# Dashboard Sync — Claude's Contract with the Localhost Dashboard

This file tells Claude **how to keep the localhost dashboard at
`localhost:8001` in sync** with the analytics pipeline. Claude is the
primary writer of insights + tasks; the dashboard UI is a secondary
writer that can mutate existing records but never creates new ones.

## Primary-source contract

**Claude is the primary source for findings, improvements, and flags.**
Rule-based pipelines are a secondary mechanical floor that runs without
human input — they catch patterns that don't need judgment, but they do
not generate the bulk of what the user reads on the action stream.

What this means in practice:

- **Findings (`insights.json`)** — always Claude-written. A finding
  passes through Gates 1–4 below before being committed.
- **Improvements (`visibility_improvements.json`)** — narrowed to rules
  that fire on multi-signal patterns (schema absence on a ranking page,
  numeric-claims absence on a high-impression page, cluster-level
  visibility lag, bilingual gap, orphan long-form, weak meta on low-CTR
  pages). The retired `THIN_BUT_TRAFFICKED` rule (word count alone) is
  the canonical example of a signal too crude to template — Claude now
  owns thin-content judgment.
- **Flags (data-quality, baseline-reset, anti-pattern warnings)** —
  always Claude-written. The aggregator emits raw `_data_quality_flags`
  in the daily payload, but the user-facing severity-warning insights
  ("AI Overview dropped 12% — investigate") come from Claude reading
  those flags + the wider context.

Why the asymmetry: rules can pass Gate 2 (cite the data point) in
templated form but cannot pass Gate 3 (dual verification of absence
claims) or Gate 4 (vendor-recommendation cross-check) — those gates
require judgment about counterfactuals and external recommendations
that a pattern matcher can't perform. The dashboard's action-stream
sort puts findings first within each severity tier (see
`dashboard/src/lib/cluster-fixes.ts → buildSiteFixList`'s `KIND` map).

When Claude is asked to "fix top visibility issues" or runs a daily/
weekly routine, the expected output is **findings**, not new rule
emissions. If a recurring pattern starts surfacing in findings often
enough to warrant a rule, that's a separate decision — coordinate with
the user before adding rules to `compute_visibility_improvements.py`.

**Files Claude writes (creates new records, enforces schema):**

- `data/dashboard/insights.json` — chronological insight stream
- `data/dashboard/tasks.json` — kanban board tasks

**Files the dashboard UI also mutates:**

- `data/dashboard/insights.json` — PATCH status, DELETE by id
- `data/dashboard/tasks.json`    — PATCH status, DELETE by id

Both writers go through `.tmp → rename` atomic writes so no one sees
a partial file. The UI's API routes live at `dashboard/src/app/api/
{insights,tasks}/[id]/route.ts` and call shared helpers in
`dashboard/src/lib/mutations.ts`. Schema is unchanged — the UI
enforces the same `status` enums and preserves `id`, `created_at`,
`source_*`, `linked_urls`, `tags`, and `description` fields.

**User-initiated mutations to expect** (for Claude's awareness when
reading back these files later — the user may have changed status or
removed records between Claude writes):

- Status transitions: open → reviewed, open → archived, any → open
  (reopen), any task status → any other task status (via kanban drag)
- Hard deletes: the user may remove an insight or task entirely via
  the drawer's Delete button. Don't assume IDs you wrote persist.
- Deferred tasks: when the UI sets status=deferred, it appends
  "Deferred <date> (via UI): …" to `description` — mirrors Claude's
  own convention.

When Claude re-reads these files (e.g. during the next daily routine),
treat the current contents as source of truth. Don't re-create
deleted records; don't revert status changes.

**Files Claude reads (no writes):**

- `data/processed/daily/<date>.json` — per-day aggregate output
- `data/processed/weekly/<iso_week>.json` — weekly rollup

---

## When to update the dashboard files

Append to `insights.json` and/or `tasks.json` at the end of:

- **`daily-routine.md`** Step 8 (after Notion page is created) →
  append 3-5 insights from the daily report's Key Insights section;
  create any concrete new tasks from the Recommended Actions section
- **`weekly-routine.md`** Step 8 (after Notion page is created) →
  append the Executive Summary bullets as insights; create tasks
  from all Recommended Actions; optionally prune done tasks older
  than 7 days
- **`knowledge-refresh.md`** Step 4 (at the end of the refresh) →
  append one informational insight summarizing what changed in the
  skill, if anything
- **Ad-hoc investigations** (user said *"investigate X and log an
  insight"*) → append one insight with `source: "adhoc"`

For **task status changes** (user said *"mark task X as in_progress"*),
update the existing task's `status` and `updated_at` fields in
`tasks.json`.

---

## Insight verification protocol — REQUIRED before writing

Every insight must pass the gates below to avoid putting confidently
wrong claims into the dashboard.

### Gate 1 — Classify the claim type

Before writing, classify the insight into one of these buckets:

| Claim type | Examples | Gate |
|---|---|---|
| **Numeric factual** | "Clicks +80% WoW", "visibility 0.62" | Gate 2 (single source verification) |
| **Absence / negation** | "X does not appear", "no content exists", "0% coverage" | **Gate 3 (mandatory dual verification)** |
| **Causal / narrative** | "X happened because Y", "competitors own Z" | **Gate 3 + Gate 4 (vendor-recommendation check)** |
| **Directional trend** | "Up across the week", "declining sentiment" | Gate 2 + show the series |

### Gate 2 — Cite the specific data point

Every insight body must reference the **file, metric name, and value**
it relies on. Example good evidence chain:

> "per `data/processed/daily/2026-04-21.json` → `summary.seo.total_clicks = 18`"

Example of what NOT to do (notice the metric name is missing, only the
percentage survives):

> "the EDITORIAL gap was 100% this week"

If the insight makes multiple claims, each claim gets its own
evidence line. If you can't cite, you can't claim.

### Gate 3 — Absence claims require two independent checks

A claim of the form "X is absent from Y" or "no comparable content
exists" is the highest-risk insight category. Required before writing:

1. **Check 1 — the aggregate metric** (e.g., `gap_percentage`,
   `visibility = 0`, `mention_count = 0`). This is necessary but
   **not sufficient**.
2. **Check 2 — actual content**: read at least one real artifact.
   - For "X does not appear in AI answers": pull a chat via
     `get_chat` on a relevant `prompt_id` and confirm X isn't in
     `brands_mentioned`.
   - For "no comparable page exists on the site": grep the
     `cross_channel.top_pages_all_channels` array in the latest
     daily aggregate AND the GSC `top_pages` list for any matching
     slug before claiming absence.

If Check 1 and Check 2 disagree, the aggregate metric is a proxy you
misread. Re-interpret it — see "Metric-interpretation gotchas" in
`peec-ingest.md`.

### Gate 4 — Vendor recommendation check

If the insight recommends an action, call the vendor's own
recommendation surface first:

- **Peec**: `get_actions(scope=<matching drill-down>, url_classification=<the slice>)`
  returns the `text` column with Peec's literal recommendation.
- **GSC**: check Search Console's "Experience" and "Enhancements"
  recommendations.

If your recommendation **contradicts** the vendor's, the vendor is
right. Peec has the citation graph; you don't.

### Severity cap for unverified insights

If an insight cannot pass Gates 2–4 fully (e.g., the user asked for
a quick read and you don't have tool budget for verification), you
may still write it — but cap severity at **`info`**. `warning` and
`critical` require full verification. Add the tag `unverified` and
set `status` to `open` so the next routine reviews it.

### Post-incident review ritual

At the start of every weekly routine, scan `insights.json` for any
insight with:

- `severity = warning|critical` AND
- `tags` containing `unverified`, OR
- `status = reviewed` with a supersede note in the body

For each hit, either run verification and promote to `status=open`,
or archive with a correction insight.

---

## `insights.json` contract

### Schema

```jsonc
{
  "last_updated": "2026-04-22T07:00:00+00:00",    // ISO 8601 UTC
  "insights": [
    {
      "id": "ins_YYYY_MM_DD_NNN",                   // year_month_day_sequence (3-digit)
      "created_at": "2026-04-22T07:00:00+00:00",
      "source": "daily-routine",                    // enum below
      "source_date": "2026-04-20",                  // which date this concerns
      "severity": "info",                           // enum below
      "title": "≤100 char headline",
      "body": "2-6 sentence explanation with specifics",
      "tags": ["geo-gap", "strategic"],             // kebab-case, 1-4 items
      "linked_urls": ["https://www.notion.so/..."], // optional; Notion page, source URLs
      "status": "open"                              // enum below
    }
  ]
}
```

### Enum values

- **`source`**: `daily-routine` | `weekly-routine` | `knowledge-refresh` | `adhoc` | `manual`
- **`severity`**:
  - `info` — neutral observation (default; most entries)
  - `warning` — something needs attention this week
  - `critical` — blocking issue or major regression (use sparingly; prominent red in the UI)
- **`status`**: `open` | `reviewed` | `archived`

### Rules

1. **New insights are prepended** to the `insights` array, not
   appended. The UI shows most-recent-first; this matches JSON
   order.
2. **IDs must be unique**. Format: `ins_YYYY_MM_DD_NNN` where NNN is
   the next sequence number for that date. Check existing IDs for
   the target date and increment.
3. **Retention**: keep the latest 200 insights. When writing, if the
   array length exceeds 200 after prepend, truncate to 200. For
   historical review, the Notion reports are the archive.
4. **Always update `last_updated`** to the current ISO-8601 UTC
   timestamp.
5. **Atomic writes**: write to `insights.json.tmp` first, then rename
   via `Path.replace()`. Never leave the file half-written — the
   dashboard polls every 30s and a half-written file would render a
   blank insights page.
6. **Severity thresholds for daily routine** — guidance for what
   counts as `warning`/`critical`:
   - `critical`: a metric moved >3σ in a commercially important
     direction (brand visibility dropped below 90%, traffic halved
     day-over-day, a data-quality flag with severity=high). Expect
     to use `critical` <1× per month.
   - `warning`: moderate concern that shouldn't wait a week
     (>2σ deviation, an opportunity-gap candidate worth a few hours
     this week).
   - `info`: everything else. Default.

---

## `tasks.json` contract

### Schema

```jsonc
{
  "last_updated": "2026-04-22T07:00:00+00:00",
  "tasks": [
    {
      "id": "tsk_YYYY_MM_DD_NNN",
      "created_at": "2026-04-22T07:00:00+00:00",
      "updated_at": "2026-04-22T07:00:00+00:00",    // mirrors created_at on creation
      "title": "≤120 char actionable statement",
      "description": "Full rationale + acceptance criteria (2-4 sentences)",
      "owner": "content",                            // one of: content | engineering | peec ai
      "status": "open",
      "source_report": "Daily Report – 2026-04-20",  // human-readable
      "source_url": "https://www.notion.so/...",     // the report page
      "created_by": "claude-daily",                  // routine that created the task

      // Cross-page surfacing: when both fields are set, the task
      // appears in /topics/<cluster>'s "Open work for this cluster"
      // section automatically. Skills MUST set these when the task
      // is cluster-scoped.
      "cluster": "industry-use-cases",               // optional cluster slug
      "lang": "en",                                  // "en" | "de", optional

      // Two-class model: every task should carry a self-contained
      // Claude prompt the user can paste to do the work. Drives the
      // dashboard's "Copy Claude prompt" button. Skills MUST populate
      // this for any auto-spawned task. See per-skill contract notes
      // for prompt-shape conventions.
      "claude_prompt": "draft the full body for /solutions/example as a 1500+ word pillar page in English. Cover: …"
    }
  ]
}
```

### Enum values

- **`status`**: `open` | `in_progress` | `done` | `deferred`
- **`created_by`**: `claude-daily` | `claude-weekly` | `claude-adhoc` | `user` | `knowledge-refresh`

### Task creation rules

1. **One task per recommended action** from the daily/weekly report.
   Copy the action text verbatim into `title` + `description`.
2. **Task IDs are sticky**. If a similar action is suggested in a
   later report, don't create a duplicate — instead, *update the
   existing task's `updated_at`* and add a note to the description
   ("Re-surfaced on 2026-04-29 weekly report").
3. **Owner must be one of `content` / `engineering` / `peec ai`.**
   No individual people, no other free-form values — the dashboard's
   API rejects anything else. Pick by which team owns the work:
   - `content` — page builds, copy edits, schema, internal links,
     editorial outreach, anything that ships in the website repo.
   - `engineering` — analytics fixes, infra, deploys, anything that
     needs a pull request to a code repo.
   - `peec ai` — Peec project changes (prompts, tags, topics) and
     anything that lives inside the Peec MCP surface.
4. **Tasks have no due dates.** Status (open / in_progress / done /
   deferred) is the only scheduling lever; calendar work happens
   outside the dashboard. Don't write `due_date` on new tasks.

### Status-change rules (user-driven)

When the user says **"mark task X as Y"**:

1. Find the task by ID (`tsk_...`) or by a unique phrase in its
   title if no ID given.
2. Update its `status` and `updated_at`.
3. If transitioning to `done`, do NOT delete — keep on the board
   for up to 7 days so done-work is visible.
4. If transitioning to `deferred`, append a one-line reason to the
   description ("Deferred 2026-04-22: waiting on legal review").
5. Reply to the user with the full updated task object so they
   can confirm.

### Retention + pruning rules

Run at the **end of every weekly routine**:

1. Archive (remove from array) any task with `status = done` whose
   `updated_at` is more than 7 days ago.
2. Archive any task with `status = deferred` whose `updated_at` is
   more than 30 days ago.
3. Do NOT archive `open` or `in_progress` tasks regardless of age —
   they're either real blockers or stale work that needs human
   attention. If a task has been `open` >14 days, bump its severity
   by logging a `warning` insight: "Task X has been open 14+ days."

---

## Writing the files — mechanics

Both files are updated via normal Write tool operations; use atomic
rename:

```python
# Pseudo-code (Claude does this via the Write tool in practice)
import json
from pathlib import Path

path = Path("data/dashboard/insights.json")

# 1. Read current state
current = json.loads(path.read_text()) if path.exists() else {"insights": []}

# 2. Prepend new insight, truncate to 200
current["insights"] = [new_insight] + current["insights"]
current["insights"] = current["insights"][:200]
current["last_updated"] = datetime.now(tz=timezone.utc).isoformat(timespec="seconds")

# 3. Write atomically: tmp → rename
tmp = path.with_suffix(".json.tmp")
tmp.write_text(json.dumps(current, ensure_ascii=False, indent=2))
tmp.replace(path)
```

Via the Write tool, this is: Read the existing JSON with Read tool,
compute the new state in Claude's reasoning, use the Write tool to
overwrite. No tmp-file rename needed through the Write tool (it's
effectively atomic from Claude's side).

---

## Initialization on first run

If `data/dashboard/insights.json` or `data/dashboard/tasks.json`
don't exist yet (first-ever dashboard run):

1. Create `data/dashboard/` directory if missing.
2. Initialize each file with the empty shape:
   ```json
   {"last_updated": "<current ISO>", "insights": []}
   ```
   ```json
   {"last_updated": "<current ISO>", "tasks": []}
   ```
3. Then proceed with the normal update flow.

---

## How the dashboard consumes these files

Reference only — Claude doesn't need to change anything based on
this; it's just context:

- `dashboard/app.py` reads both files every time a page is rendered
  (~every 30 seconds via browser auto-reload)
- The overview page shows the 5 most recent insights + 5 oldest
  open tasks
- The insights page shows all 200 retained insights
- The actions page groups tasks by status column

---

## Example: end-of-daily-routine append

After the daily routine at 2026-04-22 finishes with the Notion page
at `https://www.notion.so/...abc123`, Claude would:

1. **Update `insights.json`** with 3 entries (top 3 Key Insights from
   the Notion page body), each with `source: "daily-routine"`,
   `source_date: "2026-04-21"`, `linked_urls: ["https://www.notion.so/...abc123"]`.
2. **Update `tasks.json`** with 1-3 new tasks (the concrete items
   from the Recommended Actions section), each with
   `created_by: "claude-daily"`, `source_report: "Daily Report – 2026-04-21"`.
3. Confirm to the user: "Dashboard synced — 3 new insights, 2 new
   tasks. View at localhost:8001."

---

## Integration: where this fits in the existing runbooks

- **`daily-routine.md` Step 8** already says "append a changelog
  entry." **Extend Step 8** to also say:
  > 8b. Update the dashboard files:
  >   - Append 3-5 insights from this report to `data/dashboard/insights.json`
  >   - Create tasks in `data/dashboard/tasks.json` for each Recommended Action
  >   - See `dashboard-sync.md` for the contract details

- **`weekly-routine.md` Step 8** similarly:
  > 8c. Update the dashboard + prune stale tasks per `dashboard-sync.md`

- **`knowledge-refresh.md` Step 4**:
  > 4b. Append one `info`-severity insight summarizing the refresh
  >   (or "no changes this week" if applicable) to `insights.json`

These integration points are the difference between a dashboard that
stays current and one that silently goes stale.

# Page Drafts — Claude's Contract for Authoring New Pages

This file tells Claude **how to draft new pages for your site** from
the dashboard. Drafts live as markdown files on disk; the user reviews
them in the dashboard's Settings page, then copy-pastes into the CMS
(Webflow / Framer / your CMS) when ready to publish.

Claude is the only writer of page drafts. The dashboard is read-only
for this surface — it only lists + previews drafts.

**Files Claude owns:**

- `data/drafts/pages/*.md` — one draft per file

**When to draft a page**

Draft a new page when the user asks:
- "draft a page for tsk_2026_04_23_006" (link to a tracked task)
- "write a credibility page" (creative brief)
- "draft the [topic] pillar" (named concept)
- "rewrite acme.io/solutions/example with more numeric proof"
  (rewrite an existing page based on a scrape inventory)

When drafting is triggered by a task, reference the task id in
`source_task` so the dashboard can surface the connection.

---

## File format — `data/drafts/pages/<slug>.md`

Markdown with YAML frontmatter. **Keep frontmatter flat** — the
dashboard's `parseFrontmatter` in `lib/drafts.ts` is a small subset of
YAML; nested/multiline keys won't render.

```markdown
---
id: draft_2026_04_24_001
title: "[Your topic]: The New Standard for [Your category]"
slug: /blog/your-topic-pillar
meta_description: "[A 130-160 char SERP snippet describing what the page covers and why it matters to your reader]"
status: draft
schema_suggestions: [Article, FAQPage, HowTo]
source_task: tsk_2026_04_23_006
target_language: en
created_at: 2026-04-24T10:30:00+00:00
updated_at: 2026-04-24T10:30:00+00:00
---

# [Your topic]: The New Standard for [Your category]

## TL;DR
Acme enables [your value prop] in under 24 hours, structured as
[your structure / format] under [your governing framework], with
[your differentiator]…

## Why [your topic] matters
The traditional path takes 6-12 weeks and €15,000-50,000 to set up.
With Acme it launches in under a day at a fraction of the cost
because…

## How it works
1. Define the deliverable — choose [config option A] + [config option B]
2. Configure compliance — plug in the [your partner] integration for
   [your framework] coverage
3. Onboard users — KYC/AML through the Acme portal
4. Activate — go live in production

…
```

### Required frontmatter fields

| Key | Type | Purpose |
|---|---|---|
| `id` | string | `draft_YYYY_MM_DD_NNN`, three-digit sequence per day |
| `title` | string | Page headline, quoted if it contains a colon |
| `slug` | string | Target URL path (e.g. `/blog/foo`). Lowercase, hyphens, no trailing slash |
| `meta_description` | string | 130–160 chars for SERP snippet |
| `status` | enum | `draft` \| `review` \| `ready` \| `published` |
| `schema_suggestions` | string[] | schema.org types to wire up (`[Article, FAQPage, HowTo, Product]`). Flat array only — no nested markup |
| `created_at` | ISO8601 | When this draft was written |
| `updated_at` | ISO8601 | Bump on every edit |

### Optional

| Key | Type | Purpose |
|---|---|---|
| `source_task` | string | `tsk_...` task id this draft fulfills, if any |
| `target_language` | `en` \| `de` | Which locale the page targets |

---

## Status lifecycle

```
draft  →  review  →  ready  →  published
```

- **`draft`** — Claude's initial output. Default for new files.
- **`review`** — User has read it, wants edits. Claude re-drafts in place, keeping the same filename; bumps `updated_at`.
- **`ready`** — Final text. User is about to paste into the CMS.
- **`published`** — User published it. Draft stays on disk (for provenance) but grays out in the dashboard.

User moves state via chat (`"mark draft_2026_04_24_001 as ready"`), not in the UI. Claude edits the file's frontmatter `status` field in place.

---

## Quality bar for drafted pages

If your brand has a sentiment gap on AI engines driven by feature-language
drift, every draft MUST include:

1. **At least 3 numeric proof points.** $-volume processed, customer
   count, time-to-launch, license / framework names ([your governing
   frameworks]), version numbers, years in market. Don't invent
   numbers — if the user hasn't given you a fact, mark it as
   `TODO: confirm with ops`.
2. **Structured-data anchor.** Use Q&A (FAQPage) and step (HowTo)
   patterns when the topic supports them. AI engines parse these and
   cite back to them at a higher rate.
3. **A comparison.** At least one side-by-side table vs the
   traditional/alternative approach. Comparison pages are usually the
   highest-cited own-content per the Peec gap analysis.
4. **Internal links in-body.** At least 4 links to existing site
   pages. Use the content-inventory snapshot in
   `data/raw/content/<date>/_inventory.json` to confirm linkable pages.
5. **Bilingual mirroring (if your project is bilingual).** When
   drafting EN, also note in the body
   `<!-- DE equivalent: /de/<slug> — draft TBD -->` so the
   weekly routine can catch and commission the DE counterpart.

---

## Workflow integration

### On request from a task

When the user invokes a task-linked draft (`"draft a page for
tsk_2026_04_23_005"`):

1. Read the task's description from `data/dashboard/tasks.json` for
   acceptance criteria.
2. Read the latest content inventory at `data/raw/content/<date>/
   _inventory.json` to find:
   - Similar existing pages (for style/tone matching)
   - Pages to internal-link to
   - Schema gaps to address
3. Draft the page following the quality bar above.
4. Write to `data/drafts/pages/<slug-derived-filename>.md` with
   `status: draft` and `source_task: <task id>`.
5. Confirm to user: "Drafted at `data/drafts/pages/<file>`. Preview at
   `/settings`. Say `mark draft_... as ready` when final."

### Standalone request

When asked to draft without a task anchor (`"write a [topic] pillar"`):

1. Ask 1-2 clarifying questions if critical context is missing
   (target audience, language, length). Don't ask more than 2.
2. Draft with the same quality bar.
3. Log an info-severity insight tagged `page-drafted` linking to the
   draft filename, so the draft shows up in the insight stream too.

### Never
- Never write real HTML to draft files. Markdown only. The CMS
  handles the HTML conversion.
- Never embed placeholder images/assets. Use `![alt text](TODO: image)`.
- Never invent numeric claims. Placeholder with `TODO: confirm`.
- Never overwrite `status: published` drafts without explicit user ask.

---

## Example: first-ever draft triggered by tsk_2026_04_23_005

```markdown
---
id: draft_2026_04_24_001
title: "Acme by the Numbers"
slug: /about/by-the-numbers
meta_description: "Acme's [your category] platform in quantified detail — volume processed, customers deployed, [your frameworks] supported."
status: draft
schema_suggestions: [Organization, FAQPage]
source_task: tsk_2026_04_23_005
target_language: en
created_at: 2026-04-24T10:30:00+00:00
updated_at: 2026-04-24T10:30:00+00:00
---

# Acme by the Numbers

## Volume
TODO: confirm with ops — current total $-volume processed across all customer instances.

## Customers
TODO: confirm with ops — number of platform instances deployed and names that can be named publicly.

## [Your regulatory / compliance footprint]
- **[Region 1] — [your framework]**: [Brief description, naming any partners].
- **[Region 2] — [your framework]**: [Brief description].
- **[Region 3] — [your framework]**: [Brief description].

## Time to first deployment
**< 24 hours** from contract to live instance …

## Standards / integrations
- [Standard A] — [what it covers]
- [Standard B] — [what it covers]

<!-- DE equivalent: /de/about/zahlen-und-fakten — draft TBD -->
```

This draft appears at `/settings` in the dashboard with a `draft`
status chip and a "Copy markdown body" button.

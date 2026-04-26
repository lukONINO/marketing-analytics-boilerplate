# Visibility lift — act on the AI Visibility Improvements panel

Consumes the opportunities written by
`scripts/compute_visibility_improvements.py` and either (a) produces
concrete change sets the user can execute or (b) creates persistent tasks
tracking the work.

## When Claude loads this

The user says any of:

- `visibility lift`
- `visibility lift <cluster>`
- `act on top N visibility opportunities`
- `fix top visibility issues`
- `plan this week's visibility work`

## Source of truth

`data/processed/visibility_improvements.json` — written by
`compute_visibility_improvements.py`. Each opportunity has:

- `id`, `rule`, `severity`
- `cluster`, `lang`
- `url`, `title`
- `evidence` (rule-specific metrics)
- `fix` (recommended action)
- `estimated_lift` (expected outcome)

The 6 rules currently emitted:

| Rule | Trigger | Canonical fix |
|---|---|---|
| `RANK_WITHOUT_SCHEMA` | ≥50 impressions, no Article/FAQPage/HowTo | Add JSON-LD Article + author + datePublished |
| `RANKER_WITHOUT_CLAIMS` | ≥50 impressions, 0 numeric claims | Insert 3+ quantified proof points |
| `LOW_CTR_WEAK_META` | ≥200 impressions, <1% CTR, weak meta/title | Rewrite title + meta |
| `BILINGUAL_GAP` | Cluster has ≥3 pages one lang, 0 other | Translate top performers |
| `CLUSTER_VISIBILITY_LAG` | Peec viz <30%, <5 mentions, with SEO footprint | Stand up pillar page |
| `ORPHAN_LONGFORM` | >1000 words, <5 internal links | Add internal links |

**Retired: `THIN_BUT_TRAFFICKED`.** Word count alone was too crude
a signal — a 415-word homepage and a 415-word category index trigger the
same template, even though the right action differs wildly. Thin-content
judgment now lives in Claude-written findings (see `dashboard-sync.md`).
When you spot a genuinely thin substantive page during analysis, write a
`warning`-severity insight with full evidence rather than letting a rule
emit a templated row.

Run the script fresh before acting:

```bash
python scripts/compute_visibility_improvements.py --window 30
```

## Process

### Mode A: plan / list

User asks "what are the top visibility opportunities?" or similar.

1. Load `visibility_improvements.json`.
2. Filter to `severity == "high"` unless user said otherwise.
3. Optionally filter by cluster if user said "for <cluster>" etc.
4. Present as a compact ranked table in chat:

```
| # | Sev | Cluster | Rule | URL | Expected lift |
|---|-----|---------|------|-----|---------------|
| 1 | high | product-features/en | RANK_WITHOUT_SCHEMA | /blog/build-vs... | +15-30% AI citation |
...
```

Summarize the top 3 in 1 paragraph. Close by asking whether to
(a) create tasks for them, (b) draft the specific change sets, or
(c) both.

### Mode B: draft change sets

User says "draft the change sets for top 3" or "plan the fixes".

For each opportunity, produce a per-URL change spec:

- **Current state** — quote the actual page title/H1/schema types
  (read the page's JSON from `data/raw/content/<latest>/<slug>.json`).
- **Target state** — the exact title/meta/schema block/paragraph
  content to write. Don't hand-wave; write the literal strings.
- **Source of claims** — if injecting proof points, cite where the
  number came from. Only use real numbers that exist either in
  the scraped page (detected via `numeric_claims`), in
  `data/knowledge/proof-points.json` (if present), or that the
  user supplies in chat.
- **Verification plan** — what to check after shipping (GSC CTR
  over next 14d, Peec mention count, etc.).

### Mode C: create tasks

User says "and log tasks" or "create tasks".

For each opportunity being acted on:

1. Write a Task via `dashboard-sync.md` conventions:
   ```json
   {
     "title": "<Rule label>: <page title or cluster>",
     "description": "<the fix copy from the opportunity>",
     "owner": "<one of: content | engineering | peec ai>",
     "source_report": "visibility_improvements.<opp.id>",
     "source_url": "<opp.url if any>"
   }
   ```
   Owner picking: content rules (RANK_WITHOUT_SCHEMA / RANKER_WITHOUT_CLAIMS /
   LOW_CTR_WEAK_META / BILINGUAL_GAP / ORPHAN_LONGFORM) → "content".
   Tracking-set / prompt-tagging issues → "peec ai". Anything that needs
   shipping a code change (schema injection, sitemap fix, redirect) →
   "engineering". Tasks have no due dates — the dashboard tracks status,
   not scheduling.
2. Track the opportunity id → task id mapping in chat so the user
   knows which task traces back to which opportunity.

## Rule-specific nuances

### RANK_WITHOUT_SCHEMA

- For blog articles: `BlogPosting` (preferred), `Article` as fallback.
- For FAQ-heavy pages: pair `Article` + `FAQPage`.
- For how-to content with ordered steps: add `HowTo`.
- Always include: `headline`, `author` (as `Person` or `Organization`),
  `datePublished`, `image`, `publisher` (your brand as `Organization`).

### RANKER_WITHOUT_CLAIMS

Quantified claim = must contain a number AND a unit/qualifier. Examples:
- "Setup completes in <24 hours"
- "[Your framework] adoption continuing through 2026"
- "[Your standard] is the primary [your category] standard"

Not claims (don't count):
- "significant improvement" (no number)
- "2022" alone (no unit/qualifier)

Insert at least 3. Place them early (intro + first section) so
answer engines encounter them without parsing the full doc.

### THIN_BUT_TRAFFICKED

Structure targets for a 1500-word expansion:
- Quick Takeaway (75 words)
- Core explanation (400-500 words with 2+ claims)
- Decision table
- [Your industry] context (300 words, cluster-dependent)
- FAQ section (5+ QAs, each 50-80 words)
- Summary (100 words, 3 bullets)

### BILINGUAL_GAP

Pick the top 3 EN pages by GSC impressions in the cluster → translate
those first. Don't do a 1:1 translation; localize:
- Locale-specific terminology (use the local-language term, not
  a transliteration)
- Locale-specific frameworks ([your local regulator] over the
  international equivalent)
- Locale-specific examples ([local customer/partner names] over
  US equivalents)

### CLUSTER_VISIBILITY_LAG

Pillar-page template:
- 2000+ words, ≥5 claims
- FAQPage schema with ≥8 questions
- Cross-link from every leaf page in the cluster
- Include competitor comparison table (referenced from
  source_gaps.json if filled)

## Output format

Every run of this skill must end with either:
- A chat summary listing what was planned/done
- (If tasks created) a "Tasks created: N" line with IDs
- (If change sets drafted) the change specs inline or as file paths

Never leave a user wondering "did anything happen?".

## Anti-patterns

- **Don't ship a change set without the user's OK.** This skill
  drafts; the user ships. No auto-edits to the live site.
- **Don't merge multiple opportunities into one task.** Each
  opportunity = one task, even when they touch the same URL —
  traceability matters more than compactness.
- **Don't re-use stale opportunities.** Always re-run
  `compute_visibility_improvements.py` before acting; thresholds
  and data may have shifted.

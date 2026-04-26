# Analytical Framework — SEO × GEO × LLM Traffic

Distilled from the Agentic SEO Skill (at `Agentic-SEO-Skill-main/`),
the public Peec MCP repo (<https://github.com/peec-ai/peec-mcp>),
and your own brand knowledgebase. Applied during every daily + weekly
report run to structure analysis and ensure reports reflect
professional SEO thinking, not metric dumps.

---

## Core principles

### 1. Always measure across channels, never in isolation

A metric is only meaningful in the context of the others. `SEO clicks
dropped 20%` is not an insight — it could mean site issue, seasonality,
or clicks just moved to AI answers (GEO) or direct (LLM referral).
**The job of every report is to explain which of those it was.**

### 2. Lead with commercial impact, not volume

Your ICP defines what counts. A 50% visibility jump on irrelevant
prompts has near-zero commercial value. A 10% visibility jump on
high-intent ICP prompts is meaningful. **Rank movements by commercial
relevance, not raw size.**

### 3. Separate signal from noise with confidence labels

Every finding carries a confidence label:

- **Confirmed** — observed directly in data, reproduced across ≥2 channels
- **Likely** — observed in one channel, consistent with known patterns
- **Hypothesis** — observed once, attribution uncertain, needs verification

Never summarize an aggregate as causation without grounding it in at
least one underlying chat (`get_chat`) or URL (`get_url_content`).

### 4. E-E-A-T applies to ALL competitive queries (as of Dec 2025)

Every page you publish must demonstrate Experience, Expertise,
Authoritativeness, and Trustworthiness — not just YMYL queries. This
typically means: named author bylines with linked LinkedIn profiles,
cited [your regulatory framework] where applicable, customer outcome
evidence, and visible team credentials on the About page.

---

## SEO — what good looks like

### Technical health (gate, not a bonus)

- **Mobile-first indexing** — as of July 2024, 100% of new rankings are
  mobile-first. Check mobile rendering on key templates.
- **INP not FID** — FID was removed Sept 2024. Only track INP (Interaction
  to Next Paint) as the interactivity metric.
- **Core Web Vitals** — LCP ≤2.5s, INP ≤200ms, CLS ≤0.1. Below these
  is a ranking-blocker. The SEO skill's `cwv-thresholds.md` has details.
- **Indexing health** — ≥95% PASS on inspected URLs. Below 85% = audit.
- **AI crawler management** — robots.txt must allow GPTBot, ClaudeBot,
  PerplexityBot, Applebot-Extended, Google-Extended, Bytespider, CCBot.
  Blocking these blocks GEO.

### On-page

- **Intent match** — does the page answer the query it ranks for? Use
  GSC's top-query-per-page to sanity-check.
- **Title tag** — 50-60 chars, front-load primary keyword, mention the
  brand for BOFU pages, drop it for TOFU.
- **Meta description** — 120-155 chars, specific claim, CTA. Not generic.
- **Header hierarchy** — one H1, H2s map to user sub-questions.
- **Internal linking** — every page ≤3 clicks from homepage. Every
  product page links to ≥2 supporting blog posts and vice versa.

### Structured data (JSON-LD only)

- `Organization` on every page (once, via template)
- `BreadcrumbList` on every non-home page
- `Article` or `BlogPosting` on blog content with `author` (with `url`),
  `datePublished`, `dateModified`
- **Never**: `FAQPage` (restricted to gov/healthcare since 2023),
  `HowTo` (deprecated Sept 2023), Microdata, RDFa
- **Service** or `SoftwareApplication` on product pages (e.g.
  `SoftwareApplication` with `applicationCategory: "BusinessApplication"`
  and `offers` using your pricing plans)

### How to reason about rank + CTR + position together

- **High position + low CTR** → metadata problem (title/meta not
  compelling) OR intent mismatch (page doesn't answer the query well).
  Cross-check: same query, same page, other sites — is everyone
  suffering low CTR here, or just you? If just you, metadata. If all,
  intent.
- **Low position + high impressions** → the query is in your radius but
  you're not the preferred answer. Content upgrade candidate.
- **High position + declining clicks** → AI Overview (or similar SERP
  feature) is eating the click-through. Check GEO parallel — are you
  being CITED in AI Overview? If yes, you're losing clicks but
  maintaining influence. If no, you're losing both.

### Content decay indicators

Flag any page that:
- Had ≥30 daily clicks a year ago and now has ≤5
- Has had no update (page `lastmod`) in ≥6 months and declining impressions
- Lost a top-3 position for its target query in the last 14 days

---

## GEO — what good looks like

**GEO = Generative Engine Optimization.** The practice of being cited
as an authoritative answer by ChatGPT, Claude, Perplexity, Gemini,
Copilot, AI Overview, AI Mode.

### KPI tier for AI search

Rank-ordered by reliability + commercial relevance:

1. **Visibility %** — percentage of AI responses that mention your brand,
   **always segmented by topic / funnel stage / customer segment**.
   A single blended visibility number hides the story; your Peec
   topic taxonomy (`own_by_topic`) delivers the segmented view.
2. **Position** — avg rank when your brand appears. **Aggregate weekly,
   not daily** — LLM responses are non-deterministic, day-to-day is
   noise. A single weekly average per (topic × engine) is the
   actionable grain.
3. **Brand sentiment** — how AI describes you when you're mentioned.
   Below ~60 means meaningfully negative.
   Sentiment is **highly actionable**: identify sources that
   LLMs are citing about you, fix the ones misrepresenting you
   (review-site spam, competitor content, outdated press).
   Changes to training data are slow; changes to the sources LLMs
   retrieve in real-time are fast.
4. **Conversions from LLMs** — the hard-to-measure number. The only
   practical path: **self-reported attribution** on demo-request
   forms + onboarding calls ("how did you hear about us? — if 'AI',
   what prompt?"). Track revenue from these customers separately.
5. **Traffic from AI** — **useful but incomplete.** Real-world LLM
   referral traffic is dramatically under-counted (no click in AI
   Overview; AI-convinced users often Google the brand later, which
   GA attributes to Google organic). Do NOT use as a primary KPI.

### Visibility targets (informed by Peec data)

- **Brand prompts** (`Topic: Brand: <your brand>`): 100% visibility expected.
  Below 90% = you lost your own brand term, critical.
- **Competitor Comparison prompts**: 80-100% is achievable for an
  established vendor in a defined category.
- **Use-case prompts**: target 60-80% visibility per ICP use case.
- **Category prompts** ("best [your category] platforms"): 25-50%
  target. Competitive territory — multiple competitors are all
  fighting for this surface.

### Citation rate benchmarks per engine

`citation_rate` = average inline citations per chat when a URL is
retrieved. Not all engines cite with the same generosity — benchmarks
differ dramatically:

| Engine | "Good" citation rate | Distribution shape |
|---|---|---|
| **ChatGPT** | **2.0+** | Generous overall — 31% of URLs hit 2.0+ |
| **Google AI Overview / AI Mode** | **1.1-1.5** | Tight, conservative — 90%+ of URLs sit below 1.0 |
| **Perplexity** | **1.5-2.0** | Bimodal — 64% of URLs never cited, 6% dominate |
| Claude / Gemini / Copilot | (insufficient Peec data) | Monitor as coverage expands |

**Content-type preferences per engine:**

- **ChatGPT** strongly prefers **LISTICLE** (52% cited at 2.0+),
  followed by ARTICLE. Product pages underperform relative to
  their share.
- **Google AI Mode** prefers **CATEGORY_PAGE + PRODUCT_PAGE** —
  brand-owned content, not editorial. It's more even-handed than
  ChatGPT, rarely awarding high rates.
- **Perplexity** is selective across all content types. Listicles
  and articles top the small set that gets cited heavily.

**Interpretation rule**: if your brand's `citation_rate` on a URL is
below the per-engine benchmark, that URL is visible-but-not-trusted.
Fix with: structured data (JSON-LD), specific numeric claims,
citation-worthy quotable sentences, external authority links.
Content isn't the issue if retrievals > citations; structure is.

### What drives citations

Peec's `get_actions` surface scores opportunities. Common drivers for
B2B SaaS brands:

1. **Own-domain PRODUCT_PAGE coverage** — does your page exist, is it
   comprehensive, is it schema'd, is it citation-worthy (specific
   claims, structured data, quotable sentences)?
2. **Editorial LISTICLE / COMPARISON placement** — being included on
   "best [your category]" listicle articles. This is outreach + press
   work.
3. **REFERENCE domain presence** — Wikipedia, Crunchbase, industry
   reports (analyst firms, research bodies). Slow-moving, high-value.
4. **UGC (Reddit, LinkedIn posts)** — people writing about you on
   discoverable platforms. Investigate gaps if you have heavy outreach
   but low UGC presence.

### Citable content patterns (apply during blog writing)

- **Specific numeric claims** — "Setup in <24 hours" not "fast setup"
- **Named regulatory frameworks** — "[your framework]-compliant"
  not "regulated"
- **Discrete feature lists** with bullet-point specificity
- **Structured comparisons** (tables) — ChatGPT loves these
- **Quoted team/customer attribution** — "X said Y, context Z"
- **Citation trails** — link out to authoritative sources, not just
  inward. LLMs prefer sites that cite others.

### GEO anti-patterns (from Peec playbook)

- Never treat `visibility_count=0, visibility_total=0` as "0% visibility"
  (engine didn't run — missing data, not weak performance)
- Never conflate mention_count (brand name in answer) with citation_count
  (URL cited as source)
- Never report share-of-voice on clusters with `mention_count < 5` (noise)
- Never attribute a sentiment movement without reading ≥1 chat first

---

## LLM Referral Traffic

Traffic from chatbot surfaces (chatgpt.com, claude.ai, perplexity.ai,
copilot.microsoft.com, etc.) where the user clicked through to your
site after an AI conversation.

### What counts (and what doesn't)

Good referrals:
- `chatgpt.com`, `chat.openai.com` — ChatGPT web
- `claude.ai` — Anthropic Claude
- `perplexity.ai` (+ subdomains) — Perplexity AI answers
- `gemini.google.com` — Google Gemini
- `copilot.microsoft.com`, `edgeservices.bing.com` — Microsoft Copilot

**Important caveat**: `www.google.com` and `www.bing.com` referrals are
ambiguous — they could be AI Overview clicks or regular search clicks.
Referrer alone can't distinguish. This is why Peec exists.

### Volume expectations

For a B2B SaaS vendor with <1000 daily total sessions, expect:

- **Weekday average**: 0-5 LLM sessions per day
- **Peak day**: 10-20 when a press piece goes viral in AI surfaces
- **Trend over months**: should grow 5-15% MoM if content + GEO work
  is effective

Zero LLM sessions on a specific day is **not** a bug — it's typical
for weekends and slow news weeks. The signal is the 28-day rolling
average, not any single day.

### CRO consideration

LLM-referral visitors have different intent than organic-search
visitors — they've already been educated by the chatbot. They arrive
with higher-context questions, faster to "ready to book a demo" state.
Landing pages should:

- Lead with the specific claim the AI referred them for
- Short-circuit top-of-funnel content they already absorbed
- Surface the "book a demo" CTA within the first viewport

---

## Cross-channel opportunity quadrants (the four-box framework)

Every weekly report must surface these four quadrants. The aggregator
pre-computes candidate URLs; Claude ranks and narrates.

### 1. Rank without citation (GEO opportunity)

- Page ranks in GSC (≥1 impression, ≥position 1-20) AND has GA views
- But Peec `top_own_urls` doesn't include it OR includes it with
  `citation_count < 5`
- **Why it matters**: Google trusts you for the query; AI doesn't. The
  content is being indexed but not quoted. Usually a structured-data /
  citation-pattern gap.
- **Action**: add schema, add quotable stats, add citation-worthy
  structured sections.

### 2. Citation without rank (SEO opportunity)

- Peec shows you cited for a prompt (`citation_count > 5`)
- But GSC shows 0 impressions or position >30 for the related query
- **Why it matters**: AI trusts you; Google doesn't surface you. The
  content exists and is good, but SEO fundamentals (title, meta,
  internal linking, technical indexability) aren't firing.
- **Action**: technical SEO audit on the specific URL. Re-check
  `indexing_health`, internal link count, metadata.

### 3. LLM traffic without conversion (CRO opportunity)

- Landing page has LLM-referral sessions (≥5 in window)
- But `conversions = 0` on those sessions
- **Why it matters**: AI is referring qualified visitors and you're
  losing them at the landing page. Massive leverage — the traffic is
  FREE and pre-qualified.
- **Action**: tighten the landing page for LLM intent, add a clear
  CTA above the fold, consider a dedicated LLM-traffic landing page.

### 4. Orphan traffic (triage opportunity)

- Page has `ga_views > 0`
- But `seo_clicks = 0` AND `geo_mentions = 0`
- **Why it matters**: direct / referral traffic you aren't optimizing.
  Could be a customer-success link, a partner link, an embedded
  backlink you didn't know about. Decide whether to double down or
  deprioritize.
- **Action**: investigate the referrer, decide direction.

---

## Daily report checklist

Apply these in order every daily run. Tick them off as observations
before composing the report:

- [ ] **Coverage integrity** — all 4 sources ingested? Any `sources_missing`?
      Any `data_quality_flags` at severity high?
- [ ] **Trend against baseline** — any metric >1σ from 7-day rolling mean?
- [ ] **Brand visibility** — your brand visibility on brand prompts still ≥90%?
- [ ] **Competitor visibility** — did any competitor jump significantly?
      New brand surface?
- [ ] **MOFU/BOFU pages** — any top-ranked MOFU page lose position?
      Any gain?
- [ ] **SEO × GEO divergence** — any page ranking well but not cited,
      or vice versa?
- [ ] **LLM referrals** — nonzero? Which providers? Which landing pages?
- [ ] **Uncited prompts** — which Peec prompts had `visibility=0`?
      Is that characteristic or a regression?
- [ ] **Data quality flags** — are you surfacing the inactive-engines
      caveat in the Notion footer?

---

## Weekly report checklist (adds to daily)

- [ ] Did you complete the full 7-day aggregation? Any `dates_missing`?
- [ ] Sigma-anomaly scan against 28-day baseline
- [ ] All four opportunity-gap quadrants have at least 3 candidates
      each (or explicit "no items this week" per quadrant)
- [ ] Winners/losers per query, page, topic ranked and annotated
- [ ] 3-7 recommended actions, each with owner + due + rationale
- [ ] Executive summary leads with commercial relevance, not volume

---

## References (follow these for depth)

| Topic | Source |
|---|---|
| Peec MCP tool schemas + edge cases | `https://github.com/peec-ai/peec-mcp` |
| Peec query recipes | `https://github.com/peec-ai/peec-mcp` |
| Peec anti-patterns | `https://github.com/peec-ai/peec-mcp` |
| E-E-A-T scoring | `Agentic-SEO-Skill-main/resources/references/eeat-framework.md` |
| Schema-type validity | `Agentic-SEO-Skill-main/resources/references/schema-types.md` |
| CWV thresholds | `Agentic-SEO-Skill-main/resources/references/cwv-thresholds.md` |
| LLM audit rubric | `Agentic-SEO-Skill-main/resources/references/llm-audit-rubric.md` |
| Content quality gates | `Agentic-SEO-Skill-main/resources/references/quality-gates.md` |
| Your brand positioning | (your own knowledgebase or skill) |

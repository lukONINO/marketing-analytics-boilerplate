/**
 * Aleyda Solis's 3-Layer AI Search Measurement Framework.
 *
 * Source: https://www.aleydasolis.com/en/ai-search/a-3-layer-framework-to-measure-ai-presence-readiness-and-business-impact-redefining-metrics-for-the-ai-search-era/
 *
 * The framework's central thesis: traditional SEO metrics (rankings,
 * clicks, sessions) are insufficient because AI search influences
 * purchase decisions without producing clicks. Three layers fix that:
 *
 *   • Layer 1 — Presence:   where the brand appears in AI answers
 *   • Layer 2 — Readiness:  why visibility looks the way it does
 *   • Layer 3 — Impact:     whether visibility creates business value
 *
 * Layers are orthogonal — strong readiness doesn't guarantee visibility,
 * visibility doesn't guarantee impact. This module derives each layer
 * from data we already pull (Peec MCP, GSC, GA4, content scrape).
 *
 * Anything we can't yet compute is returned as `null` rather than zero,
 * so the dashboard can surface a "not yet measured" state instead of
 * misleading the user with phantom values.
 */

import type {
  CustomCluster,
  GeoDebugFile,
  PageClusterAssignment,
  PageClustersFile,
  ReadinessExtrasFile,
  RolledTopic,
  SourceGapsFile,
  TopicCluster,
} from "./types";

// =====================================================================
// Layer 1 — Presence
// =====================================================================

/**
 * Aleyda's five Layer-1 metrics. We compute the two derivable from
 * Peec data we already pull; the other three need chat-text analysis
 * which is a follow-up workstream (rule + LLM classification of chat
 * mentions). Their slots are kept as `null` so the dashboard can show
 * them as "next" rather than fabricating a value.
 */
export interface PresenceMetrics {
  /** (state_a + state_b) / total — the "domain reaches AI answers" rate.
   *  Aleyda's framing: prompt coverage. */
  prompt_coverage: number | null;
  /** state_a / total — the subset where the domain is also *cited*. */
  cited_coverage: number | null;
  /** Mean citation_rate across cited prompts. Higher = more inline links
   *  per chat the domain appears in. From get_domain_report. */
  linked_citation_rate: number | null;
  /** Counts for the headline numerator/denominator. */
  prompts_total: number;
  prompts_state_a: number;
  prompts_state_b: number;
  prompts_state_c: number;
  prompts_state_d: number;
  /** Aleyda's other three Layer-1 metrics — chat-text analysis. */
  comparative_win_rate: number | null;
  recommendation_rate: number | null;
  representation_accuracy: number | null;
}

export function computePresence(geoDebug: GeoDebugFile | null): PresenceMetrics {
  if (!geoDebug || geoDebug.summary.total_prompts === 0) {
    return {
      prompt_coverage: null,
      cited_coverage: null,
      linked_citation_rate: null,
      prompts_total: 0,
      prompts_state_a: 0,
      prompts_state_b: 0,
      prompts_state_c: 0,
      prompts_state_d: 0,
      comparative_win_rate: null,
      recommendation_rate: null,
      representation_accuracy: null,
    };
  }

  const { summary, prompts } = geoDebug;
  const total = summary.total_prompts;
  const reaching = summary.state_a + summary.state_b;

  // Linked citation rate — average citation_rate across prompts where
  // the brand actually appears (states A+B). Aleyda's denominator is
  // "appearances", not "all prompts".
  const reachingPrompts = prompts.filter(
    (p) => p.state === "A" || p.state === "B",
  );
  const avgCiteRate = reachingPrompts.length > 0
    ? reachingPrompts.reduce((sum, p) => sum + p.citation_rate, 0) / reachingPrompts.length
    : null;

  return {
    prompt_coverage: total > 0 ? reaching / total : null,
    cited_coverage: total > 0 ? summary.state_a / total : null,
    linked_citation_rate: avgCiteRate,
    prompts_total: total,
    prompts_state_a: summary.state_a,
    prompts_state_b: summary.state_b,
    prompts_state_c: summary.state_c,
    prompts_state_d: summary.state_d,
    comparative_win_rate: null,
    recommendation_rate: null,
    representation_accuracy: null,
  };
}

// =====================================================================
// Layer 2 — Readiness (10 dimensions)
// =====================================================================

/**
 * Aleyda's 10 readiness dimensions. Today we cover 8:
 *   - accessible      ← scrape success rate
 *   - extractable     ← word_count + h1 + meta + schema + claims composite
 *   - useful          ← GA4 engagement seconds per pageview (readiness_extras)
 *   - fresh           ← median days since Last-Modified header (readiness_extras)
 *   - differentiated  ← 1 - mean Jaccard similarity over body_text (readiness_extras)
 *   - recognizable    ← schema_article_pct (entity-rich pages)
 *   - corroborated    ← inverse of source-gap score
 *   - transactable    ← URL/schema/body-text pricing+plan signals (readiness_extras)
 *
 * The remaining 2 (consistent, credible) need new data sources
 * (Wikipedia/G2 cross-source check, Ahrefs/Moz authority scores) and
 * are kept explicit `null` so the dashboard renders them as a muted
 * "not yet measured" cell rather than a fake green/red tile.
 */
export interface ReadinessScore {
  cluster: string;
  cluster_display: string;
  lang: "en" | "de";
  page_count: number;

  scores: {
    accessible: number | null;     // 0-1
    extractable: number | null;    // 0-1
    useful: number | null;         // needs GA4 engagement
    fresh: number | null;          // needs Last-Modified header capture
    differentiated: number | null; // needs competitive language analysis
    recognizable: number | null;   // 0-1
    consistent: number | null;     // needs Wikipedia/G2 cross-source check
    corroborated: number | null;   // 0-1
    credible: number | null;       // needs domain-authority weighting
    transactable: number | null;   // needs pricing/comparison detection
  };

  /** Average of all NON-NULL dimensions. 0-1. */
  composite: number;
  /** How many of the 10 dimensions we actually scored. */
  measured_dimensions: number;
}

export const READINESS_DIMENSION_KEYS = [
  "accessible",
  "extractable",
  "useful",
  "fresh",
  "differentiated",
  "recognizable",
  "consistent",
  "corroborated",
  "credible",
  "transactable",
] as const;

export type ReadinessDimensionKey = (typeof READINESS_DIMENSION_KEYS)[number];

export const READINESS_DIMENSION_META: Record<
  ReadinessDimensionKey,
  { label: string; question: string; computed: boolean }
> = {
  accessible:     { label: "Accessible",     question: "Can pages be fetched & indexed?",             computed: true },
  extractable:    { label: "Extractable",    question: "Easy to summarise & quote from?",             computed: true },
  useful:         { label: "Useful",         question: "Do users actually engage with the page?",     computed: true },
  fresh:          { label: "Fresh",          question: "Recently updated (Last-Modified header)?",    computed: true },
  differentiated: { label: "Differentiated", question: "Distinct vocabulary across cluster pages?",   computed: true },
  recognizable:   { label: "Recognisable",   question: "Machine-readable entity signals?",            computed: true },
  consistent:     { label: "Consistent",     question: "Brand signals match across third-party?",     computed: false },
  corroborated:   { label: "Corroborated",   question: "Third-parties reinforce positioning?",        computed: true },
  credible:       { label: "Credible",       question: "Reinforcing sources carry weight?",           computed: false },
  transactable:   { label: "Transactable",   question: "Can AI answer 'which plan fits me'?",         computed: true },
};

export function computeReadiness(
  pageClusters: PageClustersFile | null,
  sourceGaps: SourceGapsFile | null,
  configClusters: TopicCluster[],
  customClusters: CustomCluster[],
  assignments: PageClusterAssignment[],
  readinessExtras: ReadinessExtrasFile | null = null,
): ReadinessScore[] {
  if (!pageClusters) return [];

  const labelMap = new Map<string, string>();
  for (const c of configClusters) labelMap.set(c.slug, c.names.en);
  for (const c of customClusters) labelMap.set(c.slug, c.names.en);

  // Per-(cluster, lang) success rates for the dimensions we compute
  // directly off the assignment list (rather than rolled-up fields).
  //
  // Audit fix #19 (2026-04-26): "Accessible" used to count any page
  // with `word_count > 0` as accessible — but a 50-word JS-shell
  // response trivially clears that. We now require ≥200 words for
  // a page to count as "real content was reachable".
  //
  // Audit fix #18 (2026-04-26): "Recognizable" used to use the
  // article-only schema percentage from the rollup. Broadened to
  // include all entity-classifying schemas (Organization, Brand,
  // Product, WebSite + Article variants) — the ones that tell AI
  // "what kind of thing this page is".
  const ENTITY_SCHEMAS = new Set([
    "Organization",
    "Brand",
    "Product",
    "WebSite",
    "WebPage",
    "Article",
    "BlogPosting",
    "NewsArticle",
    "TechArticle",
    "FAQPage",
    "HowTo",
  ]);
  const ACCESSIBLE_MIN_WORDS = 200;

  const perKey = new Map<
    string,
    { accessible_ok: number; recognizable_ok: number; total: number }
  >();
  for (const a of assignments) {
    const key = `${a.cluster}::${a.lang}`;
    const row = perKey.get(key) ?? {
      accessible_ok: 0,
      recognizable_ok: 0,
      total: 0,
    };
    row.total += 1;
    if (a.word_count >= ACCESSIBLE_MIN_WORDS) row.accessible_ok += 1;
    if ((a.schema_types ?? []).some((s) => ENTITY_SCHEMAS.has(s))) {
      row.recognizable_ok += 1;
    }
    perKey.set(key, row);
  }

  const results: ReadinessScore[] = [];

  for (const [key, rollup] of Object.entries(pageClusters.by_cluster)) {
    const [cluster, lang] = key.split("::") as [string, "en" | "de"];

    const row = perKey.get(key);

    // ----- Accessible: % of pages with ≥200 words (real content) -----
    const accessible = row && row.total > 0 ? row.accessible_ok / row.total : null;

    // ----- Extractable: composite of structural-quality signals -----
    // Each component is already 0-1 in the rollup. Average them.
    const wordScore = rollup.avg_word_count >= 1500 ? 1.0
      : rollup.avg_word_count >= 800 ? 0.7
      : rollup.avg_word_count >= 400 ? 0.4
      : rollup.avg_word_count > 0    ? 0.15
      : 0.0;
    const metaScore = 1 - rollup.pages_missing_meta_pct;
    const h1Score = 1 - rollup.pages_missing_h1_pct;
    const schemaSubScore = rollup.schema_article_pct;
    const claimsScore = rollup.pages_with_claims_pct;
    const extractable = rollup.page_count > 0
      ? (wordScore + metaScore + h1Score + schemaSubScore + claimsScore) / 5
      : null;

    // ----- Recognizable: % with at least one entity-classifying schema ---
    const recognizable = row && row.total > 0
      ? row.recognizable_ok / row.total
      : null;

    // ----- Corroborated: inverse of source-gap score (0-100) -----
    // gap_score = 100 means competitors are cited but our brand isn't —
    // i.e. zero corroboration. gap_score = 0 means strong corroboration.
    const sgRow = sourceGaps?.by_cluster?.[cluster]?.[lang];
    const corroborated = sgRow
      ? Math.max(0, 1 - sgRow.cluster_gap_score / 100)
      : null;

    // ----- Readiness extras (fresh / useful / differentiated / transactable) -----
    // Computed offline by scripts/compute_readiness_extras.py and merged in here
    // so the four dimensions show up alongside the four we derive directly.
    // Each value is null when the extras file is missing OR when the script
    // couldn't score that cluster (e.g. zero scrape records, no GA4 traffic).
    const extras = readinessExtras?.by_cluster?.[key] ?? null;

    const dims = {
      accessible,
      extractable,
      useful: extras?.useful ?? null,
      fresh: extras?.fresh ?? null,
      differentiated: extras?.differentiated ?? null,
      recognizable,
      consistent: null,
      corroborated,
      credible: null,
      transactable: extras?.transactable ?? null,
    } as ReadinessScore["scores"];

    const measured = Object.values(dims).filter((v): v is number => v !== null);
    const composite = measured.length > 0
      ? measured.reduce((a, b) => a + b, 0) / measured.length
      : 0;

    results.push({
      cluster,
      cluster_display: labelMap.get(cluster) ?? cluster,
      lang,
      page_count: rollup.page_count,
      scores: dims,
      composite,
      measured_dimensions: measured.length,
    });
  }

  // Sort: composite asc within lang so the lowest-readiness clusters
  // bubble to the top — those are the ones most worth fixing.
  results.sort((a, b) => {
    if (a.lang !== b.lang) return a.lang === "en" ? -1 : 1;
    return a.composite - b.composite;
  });

  return results;
}

// =====================================================================
// Content Coverage matrix — AI × SEO
// =====================================================================

/**
 * One point per (cluster, lang) on a 100×100 plane.
 *
 * Y-axis (AI presence): geo_visibility × 100. Comparable to Aleyda's
 * "prompt coverage" but at the cluster level.
 *
 * X-axis (SEO presence): a normalized log-composite of clicks +
 * impressions. Log-scale because SEO traffic is heavy-tailed and a
 * linear axis would compress everything against the left wall.
 *
 * Quadrants (sliced at 50/50):
 *   • Top-right    Compounding   — winning both channels
 *   • Top-left     AI-only       — cited by AI, invisible in search
 *   • Bottom-right SEO-only      — ranks but AI ignores
 *   • Bottom-left  Blind spot    — invisible everywhere
 *
 * The dashboard turns each quadrant into a different action prompt.
 */
export interface CoveragePoint {
  cluster: string;
  cluster_display: string;
  lang: "en" | "de";
  /** 0-100; log-normalized SEO weight from clicks + impressions. */
  seo_score: number;
  /** 0-100; AI visibility ratio. */
  ai_score: number;
  /** Raw values exposed for tooltip use. */
  seo_clicks: number;
  seo_impressions: number;
  ga_views: number;
  ai_visibility: number; // 0-1
  ai_mentions: number;
  page_count: number;
  /** Quadrant tag for legend / styling. */
  quadrant: "compounding" | "ai_only" | "seo_only" | "blind_spot";
}

/**
 * Click-vs-impression weighting for the cluster SEO score.
 *
 * A click is a much stronger intent signal than an impression — a
 * user actively chose us — so we weight clicks 10×. This is a design
 * choice tuned for typical B2B-SaaS scale: 1 click ≈ 10 impressions
 * in score impact. Tweak to taste; document any change here.
 */
const CLICK_TO_IMPRESSION_WEIGHT = 10;

/**
 * Log-divisor that controls how quickly the SEO axis saturates.
 * `log10(1 + weight) / SEO_LOG_DIVISOR * 100`:
 *   - divisor 3 → score 100 at weight ≈ 1,000
 *   - divisor 4 → score 100 at weight ≈ 10,000  ← current
 *   - divisor 5 → score 100 at weight ≈ 100,000
 *
 * Calibrated for typical small-to-medium ranges (cluster weight
 * 0–500). As the strongest cluster approaches 5,000+, bump the
 * divisor to 5 so the matrix doesn't compress everyone against
 * the right wall.
 *
 * Audit note #7 (2026-04-26): hardcoded for now. Move to a config
 * surface once you have peer benchmarks.
 */
const SEO_LOG_DIVISOR = 4;

/**
 * Public SEO-presence scoring helper. Used by:
 *   - Content Coverage matrix (axis position)
 *   - Cluster ranking table (SEO score column)
 *
 * Single source of truth so both surfaces stay in sync.
 */
export function seoPresenceScore(clicks: number, impressions: number): number {
  const weight = clicks * CLICK_TO_IMPRESSION_WEIGHT + impressions;
  if (weight <= 0) return 0;
  return Math.min(100, (Math.log10(1 + weight) / SEO_LOG_DIVISOR) * 100);
}

function seoScore(clicks: number, impressions: number): number {
  return seoPresenceScore(clicks, impressions);
}

export function computeCoverage(
  rolled: RolledTopic[],
  pageClusters: PageClustersFile | null,
  configClusters: TopicCluster[],
  customClusters: CustomCluster[],
  /**
   * Per-(cluster, lang) prompt coverage from `geo_debug.prompts[]`,
   * keyed `${cluster}::${lang}`. When supplied, the AI axis uses
   * prompt coverage = (state A + state B) / total — the same metric
   * the cluster ranking table on /topics computes, so both surfaces
   * agree on which clusters are "compounding".
   *
   * When omitted, falls back to the daily aggregator's
   * `geo_visibility` (a weighted Peec prominence score). The two are
   * different signals and produce different quadrant assignments —
   * always pass the map when consistency with the ranking matters.
   */
  promptCoverageByKey?: Map<string, number>,
): CoveragePoint[] {
  const labelMap = new Map<string, string>();
  for (const c of configClusters) labelMap.set(c.slug, c.names.en);
  for (const c of customClusters) labelMap.set(c.slug, c.names.en);

  const points: CoveragePoint[] = [];

  for (const t of rolled) {
    if (!t.cluster || !t.lang) continue;
    const key = `${t.cluster}::${t.lang}`;
    const rollup = pageClusters?.by_cluster?.[key];

    const seo = seoScore(t.seo_clicks, t.seo_impressions);
    const promptCov = promptCoverageByKey?.get(key);
    const ai =
      promptCov !== undefined
        ? Math.round(promptCov * 100)
        : Math.min(100, t.geo_visibility * 100);

    const quadrant: CoveragePoint["quadrant"] =
      ai >= 50 && seo >= 50 ? "compounding"
      : ai >= 50            ? "ai_only"
      : seo >= 50           ? "seo_only"
      :                       "blind_spot";

    points.push({
      cluster: t.cluster,
      cluster_display: labelMap.get(t.cluster) ?? t.topic,
      lang: t.lang,
      seo_score: seo,
      ai_score: ai,
      seo_clicks: t.seo_clicks,
      seo_impressions: t.seo_impressions,
      ga_views: t.ga_views,
      ai_visibility: t.geo_visibility,
      ai_mentions: t.geo_mentions,
      page_count: rollup?.page_count ?? 0,
      quadrant,
    });
  }

  return points;
}

export interface CoverageQuadrantSummary {
  quadrant: CoveragePoint["quadrant"];
  count: number;
  clusters: string[];
}

export function summarizeCoverage(points: CoveragePoint[]): CoverageQuadrantSummary[] {
  const buckets = new Map<CoveragePoint["quadrant"], CoveragePoint[]>();
  for (const p of points) {
    const bucket = buckets.get(p.quadrant) ?? [];
    bucket.push(p);
    buckets.set(p.quadrant, bucket);
  }
  const order: CoveragePoint["quadrant"][] = [
    "compounding",
    "ai_only",
    "seo_only",
    "blind_spot",
  ];
  return order.map((q) => {
    const items = buckets.get(q) ?? [];
    return {
      quadrant: q,
      count: items.length,
      clusters: Array.from(
        new Set(items.map((p) => p.cluster_display)),
      ),
    };
  });
}

export const QUADRANT_META: Record<
  CoveragePoint["quadrant"],
  { label: string; description: string; tone: "good" | "warn" | "info" | "bad" }
> = {
  compounding: {
    label: "Compounding",
    description: "Winning across AI and SEO. Defend and scale.",
    tone: "good",
  },
  ai_only: {
    label: "AI-only",
    description: "Cited by AI but invisible in organic search. Reverse-engineer the SEO.",
    tone: "info",
  },
  seo_only: {
    label: "SEO-only",
    description: "Ranks in search but AI doesn't pull us. Add citation hooks (claims, schema).",
    tone: "warn",
  },
  blind_spot: {
    label: "Blind spot",
    description: "Invisible on both. Either kill or rebuild — high-cost, high-leverage.",
    tone: "bad",
  },
};

/**
 * Topic-cluster analytics helpers — site / cluster / page levels.
 *
 * Pure functions. No filesystem access; the server pages load data
 * via lib/data.ts and pipe it through these.
 *
 * The three drill levels share a small vocabulary:
 *   - AI metrics: derived from geo_debug.json + topic slices
 *   - SEO metrics: derived from daily aggregates' top_queries / top_pages
 *   - Funnel-stage: heuristic classification of prompt text →
 *     TOFU (awareness) / MOFU (consideration) / BOFU (purchase)
 */

import type {
  CrossChannelPage,
  DailyAggregate,
  DailyTopicsSlice,
  GeoDebugFile,
  GeoPromptDiagnostic,
  PageClusterAssignment,
  RolledTopic,
  TopQuery,
} from "./types";
import { rollTopics } from "./rollup";
import { seoPresenceScore } from "./framework";

// =====================================================================
// Funnel stage classification
// =====================================================================

export type FunnelStage = "TOFU" | "MOFU" | "BOFU";

export const STAGE_META: Record<
  FunnelStage,
  { label: string; description: string; color: string }
> = {
  TOFU: {
    label: "Awareness",
    description: "Top of funnel — what is X, how does it work, general questions",
    color: "#5754D5", // accent purple
  },
  MOFU: {
    label: "Consideration",
    description: "Middle of funnel — best X, options for use case, category research",
    color: "#188999", // secondary teal
  },
  BOFU: {
    label: "Decision",
    description: "Bottom of funnel — vs / comparison / pricing / brand-named queries",
    color: "#2D6B78", // primary teal
  },
};

/**
 * Resolve a prompt's funnel stage. Prefers the persisted Peec tag
 * (`prompt.stage`, populated by the geo-debug skill from list_prompts
 * tag_ids) when available. Falls back to a heuristic classifier on
 * prompt text for older geo_debug files that pre-date the persistence
 * change. Audit fix #12-followup F2 (2026-04-26).
 */
export function resolvePromptStage(prompt: GeoPromptDiagnostic): FunnelStage {
  if (prompt.stage === "TOFU" || prompt.stage === "MOFU" || prompt.stage === "BOFU") {
    return prompt.stage;
  }
  return classifyStage(prompt.prompt_text);
}

/**
 * Heuristic stage classification from prompt text. Approximates the
 * manual TOFU/MOFU/BOFU tags applied in Peec.
 *
 * Audit fix #12 (2026-04-26): the previous version classified ANY
 * prompt containing the brand name as BOFU, which falsely tagged
 * prompts like "Best whitelabel platform with [brand] support" — that's
 * MOFU (the user is still comparing options), not BOFU. The fix: only
 * treat brand-named prompts as BOFU when they DON'T also contain
 * comparison/best-of language.
 *
 * Future enhancement: when we cache prompt → tag_ids from Peec
 * list_prompts into geo_debug.json, we'll prefer that over heuristics.
 *
 * Brand-name detection uses the BRAND_REGEX env var (default "acme")
 * so the heuristic adapts to your project without code changes.
 */
const BRAND_NAME_RE = new RegExp(`\\b(?:${process.env.BRAND_REGEX || "acme"})\\b`, "i");

export function classifyStage(text: string): FunnelStage {
  // Pre-compute the major signals once so we can compose rules cleanly.
  const hasBrandName = BRAND_NAME_RE.test(text);
  const hasBofuFraming = /\bvs\.?\b|comparison|compared with|review|erfahrung|bewertung|pricing|\bpreise?\b|kosten/i.test(text);
  const hasMofuFraming = /\bbest\b|\bbeste(?:r|n|s)?\b|\btop\b|platforms?\s+(?:for|with)|plattform.*f[üu]r/i.test(text);
  const hasTofuFraming = /^(?:what is|what are|how (?:do|does|can)|why|was ist|wie (?:funktioniert|kann|ersetze))/i.test(text.trim());

  // 1. Direct BOFU framing always wins (vs / pricing / reviews).
  if (hasBofuFraming) return "BOFU";

  // 2. Brand-named WITHOUT MOFU framing → BOFU
  //    (brand recall in the question is a strong intent signal — but
  //    only when the question isn't also asking for a comparison.)
  if (hasBrandName && !hasMofuFraming) return "BOFU";

  // 3. TOFU: definitional, informational
  if (hasTofuFraming && !hasBrandName) return "TOFU";

  // 4. MOFU: best-of, category research, brand-named comparisons
  if (hasMofuFraming) return "MOFU";

  // 5. Default: middle-funnel category query without explicit framing.
  return "MOFU";
}

// =====================================================================
// Site-level analytics
// =====================================================================

export interface SiteAnalytics {
  // AI search rollup (across all tracked prompts)
  ai: {
    prompts_total: number;
    state_a: number;
    state_b: number;
    state_c: number;
    state_d: number;
    prompt_coverage: number; // (a+b)/total
    cited_coverage: number;  // a/total
    avg_citation_density: number | null; // mean citation_rate across cited
  };
  // SEO search rollup (across all clusters in window)
  seo: {
    total_clicks: number;
    total_impressions: number;
    avg_position: number | null;
  };
  // Stage breakdown — combines AI prompts with funnel-stage classification
  by_stage: Record<FunnelStage, StageRollup>;
  // Window length the SEO numbers cover
  window_days: number;
}

export interface StageRollup {
  stage: FunnelStage;
  prompt_count: number;
  state_counts: Record<"A" | "B" | "C" | "D", number>;
  prompt_coverage: number;          // (A+B)/total
  prompts_with_examples: GeoPromptDiagnostic[]; // up to 3 per stage
}

export function computeSiteAnalytics(
  geoDebug: GeoDebugFile,
  topicSlices: DailyTopicsSlice[],
  windowDays: number,
  latestDaily: DailyAggregate | null,
  recentDailies: DailyAggregate[] = [],
): SiteAnalytics {
  const { summary, prompts } = geoDebug;
  const total = summary.total_prompts;
  const cited = prompts.filter((p) => p.state === "A");
  const reaching = prompts.filter((p) => p.state === "A" || p.state === "B");

  const avgCitation =
    cited.length > 0
      ? cited.reduce((s, p) => s + p.citation_rate, 0) / cited.length
      : null;

  // Stage rollup
  const stageGroups: Record<FunnelStage, GeoPromptDiagnostic[]> = {
    TOFU: [],
    MOFU: [],
    BOFU: [],
  };
  for (const p of prompts) {
    stageGroups[resolvePromptStage(p)].push(p);
  }
  const byStage: Record<FunnelStage, StageRollup> = {
    TOFU: rollupStage("TOFU", stageGroups.TOFU),
    MOFU: rollupStage("MOFU", stageGroups.MOFU),
    BOFU: rollupStage("BOFU", stageGroups.BOFU),
  };

  // SEO rollup from rolled topics
  const rolled = rollTopics(topicSlices, windowDays);
  const totalClicks = rolled.reduce((s, t) => s + t.seo_clicks, 0);
  const totalImpressions = rolled.reduce((s, t) => s + t.seo_impressions, 0);

  // Average position: 7-day impression-weighted average across the
  // most recent daily aggregates we have. Each day's GSC avg_position
  // is already impression-weighted within the day; we extend that by
  // weighting each day by its impression count so a single low-volume
  // day can't skew the figure.
  //
  // Audit fix (2026-04-26): previously used the latest single day's
  // avg_position which was high-variance and vulnerable to GSC's
  // 2-3 day publish lag (latest day often has 0 impressions and
  // null position).
  const avgPos = computeImpressionWeightedPosition(recentDailies, latestDaily);

  return {
    ai: {
      prompts_total: total,
      state_a: summary.state_a,
      state_b: summary.state_b,
      state_c: summary.state_c,
      state_d: summary.state_d,
      prompt_coverage: total > 0 ? reaching.length / total : 0,
      cited_coverage: total > 0 ? summary.state_a / total : 0,
      avg_citation_density: avgCitation,
    },
    seo: {
      total_clicks: totalClicks,
      total_impressions: totalImpressions,
      avg_position: avgPos,
    },
    by_stage: byStage,
    window_days: windowDays,
  };
}

/**
 * Impression-weighted average GSC position across the last 7 days
 * with real data. Falls back to the latest daily's avg_position
 * when we have no recent dailies, and to null when nothing exists.
 *
 * Why impression-weighted: a day with 1 impression at position 80
 * shouldn't pull the average to 40 against another day with 100
 * impressions at position 5.
 */
function computeImpressionWeightedPosition(
  recentDailies: DailyAggregate[],
  latestDaily: DailyAggregate | null,
): number | null {
  // Take the last 7 daily aggregates (oldest first → use slice(-7))
  const last7 = recentDailies.slice(-7);
  let weightSum = 0;
  let weightedPos = 0;
  for (const d of last7) {
    const seo = d.summary?.seo;
    const pos = seo?.avg_position;
    const imp = seo?.total_impressions ?? 0;
    if (typeof pos !== "number" || imp <= 0) continue;
    weightedPos += pos * imp;
    weightSum += imp;
  }
  if (weightSum > 0) {
    return Math.round((weightedPos / weightSum) * 10) / 10;
  }
  // Fallback to latest single-day average if no impression-weighted
  // data is available.
  return latestDaily?.summary?.seo?.avg_position ?? null;
}

function rollupStage(
  stage: FunnelStage,
  prompts: GeoPromptDiagnostic[],
): StageRollup {
  const counts = { A: 0, B: 0, C: 0, D: 0 } as Record<"A" | "B" | "C" | "D", number>;
  for (const p of prompts) counts[p.state] += 1;
  const total = prompts.length;
  return {
    stage,
    prompt_count: total,
    state_counts: counts,
    prompt_coverage: total > 0 ? (counts.A + counts.B) / total : 0,
    prompts_with_examples: prompts
      .slice()
      .sort((a, b) => b.citation_rate - a.citation_rate)
      .slice(0, 3),
  };
}

// =====================================================================
// Cluster-level analytics
// =====================================================================

export interface ClusterAnalytics {
  cluster: string;
  cluster_display: string;
  ai: {
    prompts_total: number;
    state_a: number;
    state_b: number;
    state_c: number;
    state_d: number;
    prompt_coverage: number;
    avg_citation_density: number | null;
    by_lang: Record<"en" | "de", { prompts_total: number; state_a: number }>;
  };
  seo: {
    total_clicks: number;
    total_impressions: number;
    by_lang: Record<"en" | "de", { clicks: number; impressions: number }>;
  };
  by_stage: Record<FunnelStage, StageRollup>;
  prompts: GeoPromptDiagnostic[]; // all prompts in this cluster
  pages: PageClusterAssignment[];  // all pages assigned to this cluster
}

export function computeClusterAnalytics(
  cluster: string,
  clusterDisplay: string,
  geoDebug: GeoDebugFile,
  rolled: RolledTopic[],
  assignments: PageClusterAssignment[],
): ClusterAnalytics {
  const clusterPrompts = geoDebug.prompts.filter((p) => p.cluster === cluster);
  const clusterPages = assignments.filter((a) => a.cluster === cluster);
  const clusterTopics = rolled.filter((t) => t.cluster === cluster);

  // AI counts
  const counts = { A: 0, B: 0, C: 0, D: 0 } as Record<"A" | "B" | "C" | "D", number>;
  for (const p of clusterPrompts) counts[p.state] += 1;
  const cited = clusterPrompts.filter((p) => p.state === "A");
  const avgCitation =
    cited.length > 0
      ? cited.reduce((s, p) => s + p.citation_rate, 0) / cited.length
      : null;

  // Per-lang split
  const byLangAi: Record<"en" | "de", { prompts_total: number; state_a: number }> = {
    en: { prompts_total: 0, state_a: 0 },
    de: { prompts_total: 0, state_a: 0 },
  };
  for (const p of clusterPrompts) {
    byLangAi[p.lang].prompts_total += 1;
    if (p.state === "A") byLangAi[p.lang].state_a += 1;
  }

  const byLangSeo: Record<"en" | "de", { clicks: number; impressions: number }> = {
    en: { clicks: 0, impressions: 0 },
    de: { clicks: 0, impressions: 0 },
  };
  for (const t of clusterTopics) {
    if (t.lang === "en" || t.lang === "de") {
      byLangSeo[t.lang].clicks += t.seo_clicks;
      byLangSeo[t.lang].impressions += t.seo_impressions;
    }
  }

  // Stage rollup for this cluster
  const stageGroups: Record<FunnelStage, GeoPromptDiagnostic[]> = {
    TOFU: [],
    MOFU: [],
    BOFU: [],
  };
  for (const p of clusterPrompts) {
    stageGroups[resolvePromptStage(p)].push(p);
  }

  const total = clusterPrompts.length;
  return {
    cluster,
    cluster_display: clusterDisplay,
    ai: {
      prompts_total: total,
      state_a: counts.A,
      state_b: counts.B,
      state_c: counts.C,
      state_d: counts.D,
      prompt_coverage: total > 0 ? (counts.A + counts.B) / total : 0,
      avg_citation_density: avgCitation,
      by_lang: byLangAi,
    },
    seo: {
      total_clicks: byLangSeo.en.clicks + byLangSeo.de.clicks,
      total_impressions: byLangSeo.en.impressions + byLangSeo.de.impressions,
      by_lang: byLangSeo,
    },
    by_stage: {
      TOFU: rollupStage("TOFU", stageGroups.TOFU),
      MOFU: rollupStage("MOFU", stageGroups.MOFU),
      BOFU: rollupStage("BOFU", stageGroups.BOFU),
    },
    prompts: clusterPrompts,
    pages: clusterPages,
  };
}

// =====================================================================
// Page-level analytics
// =====================================================================

export interface PageAnalytics {
  url: string;
  page: PageClusterAssignment;
  // GSC queries this URL ranks for, summed across the window
  seo_queries: Array<{
    query: string;
    clicks: number;
    impressions: number;
    avg_position: number;
    avg_ctr: number;
    days: number;
  }>;
  // Per-day cross-channel stats from cross_channel.top_pages_all_channels
  daily_metrics: Array<{
    date: string;
    seo_clicks: number;
    seo_impressions: number;
    ga_sessions: number;
    llm_sessions: number;
    peec_citations: number;
  }>;
  // Window totals
  totals: {
    seo_clicks: number;
    seo_impressions: number;
    ga_sessions: number;
    llm_sessions: number;
    peec_citations: number;
    days_active: number;
  };
}

/**
 * Aggregate one URL's metrics across the window. The daily aggregates
 * carry per-page rows in `cross_channel.top_pages_all_channels`; we
 * filter those plus the GSC `top_queries` rows whose `page === url`.
 */
export function computePageAnalytics(
  url: string,
  page: PageClusterAssignment,
  dailies: Array<[string, DailyAggregate]>,
): PageAnalytics {
  const dailyMetrics: PageAnalytics["daily_metrics"] = [];
  const queryAccum = new Map<
    string,
    {
      clicks: number;
      impressions: number;
      pos_sum: number;
      ctr_sum: number;
      days: number;
    }
  >();

  for (const [date, daily] of dailies) {
    // Per-page metrics from cross_channel
    const pageRow = (daily.cross_channel?.top_pages_all_channels ?? []).find(
      (p): p is CrossChannelPage => p.url === url,
    );
    if (pageRow) {
      dailyMetrics.push({
        date,
        seo_clicks: pageRow.seo_clicks ?? 0,
        seo_impressions: pageRow.seo_impressions ?? 0,
        ga_sessions: pageRow.ga_sessions ?? 0,
        llm_sessions: pageRow.llm_sessions ?? 0,
        peec_citations: pageRow.peec_citations ?? 0,
      });
    }

    // GSC top_queries with `page === url`
    const queries = daily.summary?.seo?.top_queries ?? [];
    for (const q of queries as TopQuery[]) {
      if (q.page !== url) continue;
      const existing = queryAccum.get(q.query) ?? {
        clicks: 0,
        impressions: 0,
        pos_sum: 0,
        ctr_sum: 0,
        days: 0,
      };
      existing.clicks += q.clicks ?? 0;
      existing.impressions += q.impressions ?? 0;
      existing.pos_sum += q.position ?? 0;
      existing.ctr_sum += q.ctr ?? 0;
      existing.days += 1;
      queryAccum.set(q.query, existing);
    }
  }

  const seoQueries: PageAnalytics["seo_queries"] = Array.from(queryAccum.entries())
    .map(([query, v]) => ({
      query,
      clicks: v.clicks,
      impressions: v.impressions,
      avg_position: v.days > 0 ? v.pos_sum / v.days : 0,
      avg_ctr: v.days > 0 ? v.ctr_sum / v.days : 0,
      days: v.days,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);

  const totals = dailyMetrics.reduce(
    (acc, d) => ({
      seo_clicks: acc.seo_clicks + d.seo_clicks,
      seo_impressions: acc.seo_impressions + d.seo_impressions,
      ga_sessions: acc.ga_sessions + d.ga_sessions,
      llm_sessions: acc.llm_sessions + d.llm_sessions,
      peec_citations: acc.peec_citations + d.peec_citations,
      days_active: acc.days_active +
        (d.seo_clicks + d.seo_impressions + d.ga_sessions + d.llm_sessions + d.peec_citations > 0
          ? 1
          : 0),
    }),
    { seo_clicks: 0, seo_impressions: 0, ga_sessions: 0, llm_sessions: 0, peec_citations: 0, days_active: 0 },
  );

  return {
    url,
    page,
    seo_queries: seoQueries,
    daily_metrics: dailyMetrics,
    totals,
  };
}

// =====================================================================
// Cluster ranking (for the site-level cluster table)
// =====================================================================

export interface ClusterRanking {
  cluster: string;
  cluster_display: string;
  ai_score: number; // 0-100
  seo_score: number; // 0-100
  /** Readiness composite, 0-100. `null` when no readiness dimensions
   *  could be measured for this cluster (e.g. no scraped pages yet). */
  readiness: number | null;
  composite: number; // 0-100
  pages: number;
  prompts: number;
  prompt_coverage: number; // (A+B)/total
  top_stage: FunnelStage | null;
  // Quadrant from the framework
  quadrant: "compounding" | "ai_only" | "seo_only" | "blind_spot";
  // Cross-layer diagnostic patterns — auto-computed when readiness data
  // is available. Empty array when no patterns trigger.
  patterns: ClusterPattern[];
}

export function rankClusters(
  geoDebug: GeoDebugFile,
  rolled: RolledTopic[],
  assignments: PageClusterAssignment[],
  clusters: Array<{ slug: string; names: { en: string } }>,
  /**
   * Optional readiness-by-cluster lookup. When provided, the ranking
   * also receives the diagnostic patterns (compounding /
   * underdistributed / structural_blocker / bofu_gap / tofu_gap) for
   * each cluster. Pass an empty map if readiness isn't computed yet.
   */
  readinessByCluster: Map<string, number> = new Map(),
): ClusterRanking[] {
  const ranks: ClusterRanking[] = [];

  for (const c of clusters) {
    const clusterPrompts = geoDebug.prompts.filter((p) => p.cluster === c.slug);
    const clusterTopics = rolled.filter((t) => t.cluster === c.slug);
    const clusterPages = assignments.filter((a) => a.cluster === c.slug);

    if (clusterPrompts.length === 0 && clusterTopics.length === 0 && clusterPages.length === 0) {
      continue;
    }

    // AI score: prompt coverage % capped at 100 (already 0-1 scale)
    const promptCov =
      clusterPrompts.length > 0
        ? clusterPrompts.filter((p) => p.state === "A" || p.state === "B").length /
          clusterPrompts.length
        : 0;
    const aiScore = Math.round(promptCov * 100);

    // SEO score: log-normalized clicks + impressions. Shared formula
    // with the Content Coverage matrix — see framework.ts:seoPresenceScore
    // for the click-vs-impression weighting and saturation calibration.
    const totalClicks = clusterTopics.reduce((s, t) => s + t.seo_clicks, 0);
    const totalImpressions = clusterTopics.reduce((s, t) => s + t.seo_impressions, 0);
    const seoScore = seoPresenceScore(totalClicks, totalImpressions);

    const composite = Math.round((aiScore + seoScore) / 2);

    // Build per-stage groups for THIS cluster (for both topStage and
    // diagnostic-pattern computation).
    const stageGroups: Record<FunnelStage, GeoPromptDiagnostic[]> = {
      TOFU: [],
      MOFU: [],
      BOFU: [],
    };
    for (const p of clusterPrompts) stageGroups[resolvePromptStage(p)].push(p);
    const stageCount: Record<FunnelStage, number> = {
      TOFU: stageGroups.TOFU.length,
      MOFU: stageGroups.MOFU.length,
      BOFU: stageGroups.BOFU.length,
    };
    const topStageEntries = (Object.entries(stageCount) as [FunnelStage, number][])
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
    const topStage = topStageEntries.length > 0 ? topStageEntries[0][0] : null;

    const quadrant: ClusterRanking["quadrant"] =
      aiScore >= 50 && seoScore >= 50
        ? "compounding"
        : aiScore >= 50
          ? "ai_only"
          : seoScore >= 50
            ? "seo_only"
            : "blind_spot";

    // Cross-layer patterns — only computable when we have a readiness
    // score for this cluster (the readinessByCluster map is keyed by
    // cluster slug, averaging across languages so a cluster gets one
    // pattern set rather than two divergent ones).
    const readiness = readinessByCluster.get(c.slug);
    const patterns: ClusterPattern[] =
      typeof readiness === "number"
        ? computeClusterPatterns({
            presence: promptCov,
            readiness,
            byStage: {
              TOFU: rollupStage("TOFU", stageGroups.TOFU),
              MOFU: rollupStage("MOFU", stageGroups.MOFU),
              BOFU: rollupStage("BOFU", stageGroups.BOFU),
            },
          })
        : [];

    ranks.push({
      cluster: c.slug,
      cluster_display: c.names.en,
      ai_score: aiScore,
      seo_score: Math.round(seoScore),
      readiness:
        typeof readiness === "number" ? Math.round(readiness * 100) : null,
      composite,
      pages: clusterPages.length,
      prompts: clusterPrompts.length,
      prompt_coverage: promptCov,
      top_stage: topStage,
      quadrant,
      patterns,
    });
  }

  ranks.sort((a, b) => b.composite - a.composite);
  return ranks;
}

// =====================================================================
// Cross-layer diagnostic patterns
// =====================================================================
//
// Audit fix #21 / E2 (2026-04-26): replaces the static "Reading the
// three layers together" copy on the Strategy page with computed
// per-cluster pattern tags. Each cluster can carry zero or more
// patterns — they're not exclusive; a cluster can be "compounding"
// AND have a "bofu_gap" simultaneously.
//
// Two patterns that the audit listed are intentionally NOT computed:
//   - "Conversion gap" needs cluster-level Presence trend (we only
//     have site-wide trend today)
//   - "Misframed" needs the Representation Accuracy metric, which
//     is in Layer 1's "Next" section
// =====================================================================

export type ClusterPattern =
  | "structural_blocker"   // weak presence + weak readiness
  | "underdistributed"     // strong readiness, weak presence
  | "compounding"          // strong presence + strong readiness
  | "bofu_gap"             // wins TOFU/MOFU but loses BOFU
  | "tofu_gap";            // wins later stages but loses early-stage

export const CLUSTER_PATTERN_META: Record<
  ClusterPattern,
  {
    label: string;
    short: string;
    description: string;
    action: string;
    tone: "good" | "info" | "warn" | "bad";
  }
> = {
  structural_blocker: {
    label: "Structural blocker",
    short: "Blocker",
    description: "Weak readiness AND weak presence — structural gaps are hiding the cluster from AI entirely.",
    action: "Fix accessibility, content depth, and schema before chasing visibility.",
    tone: "bad",
  },
  underdistributed: {
    label: "Underdistributed",
    short: "Underdist.",
    description: "Strong readiness but weak presence — pages are good, third parties don't cite us.",
    action: "Invest in outreach (G2 / Wikidata / analyst briefings), not more content.",
    tone: "warn",
  },
  compounding: {
    label: "Compounding",
    short: "Compounding",
    description: "Strong presence AND strong readiness — both layers working together.",
    action: "Defend and scale. Don't neglect maintenance.",
    tone: "good",
  },
  bofu_gap: {
    label: "BOFU gap",
    short: "BOFU gap",
    description: "Strong on awareness/consideration prompts, weak on decision-stage (vs / pricing / reviews).",
    action: "Expand commercial-prompt coverage and comparison content.",
    tone: "warn",
  },
  tofu_gap: {
    label: "TOFU gap",
    short: "TOFU gap",
    description: "Wins decision-stage but missing from awareness questions. Buyers don't reach selection if they never hear about us first.",
    action: "Add definitional / educational content (\"what is X\", \"how does X work\").",
    tone: "info",
  },
};

const STRONG = 0.7;
const WEAK = 0.4;

export function computeClusterPatterns(args: {
  presence: number;        // 0-1 — prompt coverage for the cluster
  readiness: number;       // 0-1 — readiness composite for the cluster
  byStage: Record<FunnelStage, StageRollup>;
}): ClusterPattern[] {
  const patterns: ClusterPattern[] = [];

  // Structural patterns from cross-layer position
  if (args.presence < WEAK && args.readiness < WEAK) {
    patterns.push("structural_blocker");
  }
  if (args.presence < WEAK && args.readiness >= STRONG) {
    patterns.push("underdistributed");
  }
  if (args.presence >= STRONG && args.readiness >= STRONG) {
    patterns.push("compounding");
  }

  // Stage patterns — only meaningful if the cluster has prompts in
  // multiple stages (a cluster with only BOFU prompts can't have a
  // "BOFU gap" by definition).
  const stages = args.byStage;
  const tofu = stages.TOFU;
  const mofu = stages.MOFU;
  const bofu = stages.BOFU;

  // BOFU gap: BOFU is weak AND at least one earlier stage is strong
  if (
    bofu.prompt_count >= 2 &&
    bofu.prompt_coverage < WEAK &&
    ((tofu.prompt_count >= 2 && tofu.prompt_coverage >= STRONG) ||
      (mofu.prompt_count >= 2 && mofu.prompt_coverage >= STRONG))
  ) {
    patterns.push("bofu_gap");
  }

  // TOFU gap: TOFU is weak AND at least one later stage is strong
  if (
    tofu.prompt_count >= 2 &&
    tofu.prompt_coverage < WEAK &&
    ((mofu.prompt_count >= 2 && mofu.prompt_coverage >= STRONG) ||
      (bofu.prompt_count >= 2 && bofu.prompt_coverage >= STRONG))
  ) {
    patterns.push("tofu_gap");
  }

  return patterns;
}

// =====================================================================
// Helpers
// =====================================================================

/**
 * URL-encode a page path to use as a route segment array.
 * "/blog/example-vs-other" → ["blog","example-vs-other"]
 * "/de/produkt/whitelabel" → ["de","produkt","whitelabel"]
 */
export function urlPathToSegments(url: string): string[] {
  try {
    const u = new URL(url);
    return u.pathname.split("/").filter(Boolean).map((s) => encodeURIComponent(s));
  } catch {
    return [encodeURIComponent(url)];
  }
}

/**
 * Build a full URL from a path segment array. The default origin is
 * read from process.env.SITE_CANONICAL_ORIGIN at call time when no
 * `domain` is supplied, falling back to a placeholder so the function
 * stays referentially safe in environments where the env var isn't
 * configured. Replace the fallback with your canonical origin.
 */
export function segmentsToUrl(segments: string[], domain?: string): string {
  const origin = (domain || process.env.SITE_CANONICAL_ORIGIN || "https://acme.io").replace(/\/$/, "");
  const path = "/" + segments.map((s) => decodeURIComponent(s)).join("/");
  return `${origin}${path}`;
}

/** Short display path for a URL — pathname only, no query/hash. */
export function shortPath(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

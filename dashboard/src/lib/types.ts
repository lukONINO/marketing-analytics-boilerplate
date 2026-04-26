/**
 * TypeScript contracts mirroring the JSON produced by the Python pipeline.
 *
 * The shapes here MUST match what scripts/aggregate_daily.py and the
 * Claude skill (dashboard-sync.md) write. If a Python script adds a
 * field, add it here too; if types drift, the dashboard silently
 * renders stale.
 *
 * All fields are typed conservatively as optional because the Python
 * side is tolerant of missing data — aggregate_daily.py writes
 * `{ available: false }` blocks when a source is missing rather than
 * omitting the key outright.
 */

// ---------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------

export type ISODate = string;       // "2026-04-20"
export type ISODateTime = string;   // "2026-04-22T07:00:00+00:00"

/**
 * Global timeframe value — number of days of lookback.
 *
 * Was a union of `7 | 14 | 30` in the pill-selector era; widened to
 * `number` so the dropdown can offer 60 / 90 / 180 / 365 / all-time
 * presets without breaking every consumer.
 */
export type TimeWindow = number;

/** How a window-aggregated metric is combined across its daily values. */
export type AggregationMode = "sum" | "avg";

/**
 * A window-aware metric snapshot. Replaces the earlier
 * HistoricalSnapshot for the Overview cards — HistoricalSnapshot is
 * still used by loadTopicTrends for the 7d-vs-prior-7d direction map
 * on the Topics page.
 *
 * - `current` = `sum` or `avg` (per aggregation) of daily values in the
 *   last `window_days` days.
 * - `prior` = same aggregation over the immediately-preceding equal
 *   window. Used to compute `delta_pct`.
 * - `direction_7d` = 7d-vs-prior-7d momentum, independent of `window_days`.
 *   Kept as a stable "recent move" indicator regardless of selector.
 */
export interface WindowSnapshot {
  current: number | null;
  current_date: string | null;
  prior: number | null;
  delta_pct: number | null;
  direction_7d: "up" | "down" | "flat" | null;
  /** Number of days in the window that contributed a non-null value. */
  sample_size: number;
  aggregation: AggregationMode;
  window_days: number;
  /** For sum-aggregated metrics, the per-day average (current / non-null count). */
  per_day_avg: number | null;
}

/** Per-day slice of cross-channel page data, used by the Overview
 *  table to aggregate across a user-selected window. */
export interface DailyPagesSlice {
  date: ISODate;
  pages: CrossChannelPage[];
}

/** Per-day slice of cross-channel topic data, used by the Topics
 *  table to aggregate across a user-selected window. */
export interface DailyTopicsSlice {
  date: ISODate;
  topics: CrossChannelTopic[];
}

/** Aggregated page row — sums across the selected window. */
export interface RolledPage {
  url: string;
  seo_clicks: number;
  seo_impressions: number;
  ga_sessions: number;
  llm_sessions: number;
  peec_citations: number;
  sources: string[];
  composite_score: number;
  /** Number of days in the window where the URL had ANY signal. */
  days_active: number;
  first_seen: ISODate;
  last_seen: ISODate;
}

/** Aggregated topic row — sums counts, averages visibility.
 *
 * Bilingual model (added 2026-04-23): each cluster emits TWO rolled
 * rows, one per language. `cluster` is the slug, `lang` is "en" | "de".
 * Historical rollups from before the migration won't have these fields;
 * consumers should tolerate undefined.
 */
export interface RolledTopic {
  topic: string;
  cluster?: string;
  lang?: "en" | "de";
  seo_clicks: number;
  seo_impressions: number;
  ga_views: number;
  /** Mean of daily geo_visibility values (0–1). */
  geo_visibility: number;
  geo_mentions: number;
  peec_topic_ids: string[];
  days_active: number;
}

// ---------------------------------------------------------------------
// Daily aggregate — data/processed/daily/<date>.json
// ---------------------------------------------------------------------

export interface DailyAggregate {
  date: ISODate;
  generated_at: ISODateTime;
  sources_included: string[];
  sources_missing: string[];
  summary: {
    seo?: SeoSummary;
    traffic?: TrafficSummary;
    llm_traffic?: LlmTrafficSummary;
    geo?: GeoSummary;
  };
  scores: {
    seo_score: number | null;
    geo_score: number | null;
  };
  cross_channel: {
    top_pages_all_channels: CrossChannelPage[];
    top_topics: CrossChannelTopic[];
    url_coverage: UrlCoverage;
    normalization_duplicates: string[][];
  };
  deltas_vs_prior_day?: DeltasBlock;
  deltas_vs_prior_7_avg?: DeltasBlock;
}

export interface SeoSummary {
  available: boolean;
  total_clicks?: number;
  total_impressions?: number;
  overall_ctr?: number;
  avg_position?: number | null;
  inspected_count?: number;
  indexing_health?: number | null;
  top_queries?: TopQuery[];
  top_pages?: TopPage[];
}

export interface TopQuery {
  query: string;
  page?: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  country?: string;
  device?: string;
}

export interface TopPage {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  country?: string;
  device?: string;
}

export interface TrafficSummary {
  available: boolean;
  sessions?: number;
  users?: number;
  conversions?: number;
  channel_breakdown?: Record<string, number>;
  top_pages_ga?: {
    url: string;
    views: number;
    users: number;
  }[];
}

export interface LlmTrafficSummary {
  available: boolean;
  sessions?: number;
  users?: number;
  top_providers?: string[];
  by_provider?: Record<string, {
    sessions: number;
    users: number;
    domains: string[];
  }>;
  unclassified_referrer_count?: number;
}

export interface GeoSummary {
  available: boolean;
  avg_visibility?: number;
  avg_share_of_voice?: number;
  total_mentions?: number;
  avg_sentiment?: number | null;
  total_citations_window?: number;
  citations_aggregation_window?: { start: ISODate; end: ISODate } | null;
  uncited_prompt_count?: number;
  top_cited_prompts?: {
    prompt_id: string;
    visibility: number;
    mention_count: number;
  }[];
  active_engines?: { id: string; name: string }[];
  coverage_integrity?: {
    active_models_count: number;
    total_models_tracked: number;
    active_models: string[];
    note?: string;
  };
  data_quality_flags?: DataQualityFlag[];
}

export interface DataQualityFlag {
  flag: string;
  severity: "low" | "medium" | "high";
  description: string;
  affects?: string[];
}

export interface CrossChannelPage {
  url: string;
  seo_clicks: number;
  seo_impressions: number;
  ga_sessions: number;
  llm_sessions: number;
  peec_citations: number;
  sources: string[];
  composite_score: number;
}

export interface CrossChannelTopic {
  topic: string;
  /** Cluster slug (new bilingual model, 2026-04-23). Old daily files
   *  written before the migration will omit it — treat as undefined. */
  cluster?: string;
  /** Language the row's GSC + GA metrics are slotted under. */
  lang?: "en" | "de";
  seo_clicks: number;
  seo_impressions: number;
  ga_views: number;
  geo_visibility: number;
  geo_mentions: number;
  peec_topic_ids: string[];
}

export interface UrlCoverage {
  coverage_ratio: number | null;
  top_n_per_source: number;
  sizes: Record<string, number>;
  reason?: string;
}

export interface DeltasBlock {
  available: boolean;
  [domain: string]: unknown; // { seo: { total_clicks: { today, prior, pct_change } }, ... }
}

// ---------------------------------------------------------------------
// Weekly aggregate — data/processed/weekly/<YYYY-Www>.json
// ---------------------------------------------------------------------

export interface WeeklyAggregate {
  iso_week: string;
  start_date: ISODate;
  end_date: ISODate;
  generated_at: ISODateTime;
  days_available: number;
  dates_missing: ISODate[];
  week_summary: Record<string, number | null>;
  trends: Record<string, (number | null)[]>;
  winners_losers?: {
    queries?: WinnersLosers;
    pages?: WinnersLosers;
    topics?: WinnersLosers;
  };
  topic_view?: CrossChannelTopic[];
  opportunity_gaps?: {
    rank_without_citation?: string[];
    citation_without_rank?: string[];
    orphan_traffic_topics?: string[];
  };
  anomalies?: Anomaly[];
}

export interface WinnersLosers {
  winners: { key: string; first: number; last: number; pct_change: number }[];
  losers:  { key: string; first: number; last: number; pct_change: number }[];
}

export interface Anomaly {
  date: ISODate;
  metric: string;
  value: number;
  baseline_mean: number;
  baseline_sigma: number;
  sigma_deviation: number;
  direction: "up" | "down";
}

// ---------------------------------------------------------------------
// Dashboard state — data/dashboard/*.json (Claude-written)
// ---------------------------------------------------------------------

export type InsightSeverity = "info" | "warning" | "critical";
export type InsightSource =
  | "daily-routine"
  | "weekly-routine"
  | "knowledge-refresh"
  | "adhoc"
  | "manual";
export type InsightStatus = "open" | "reviewed" | "archived";

export interface Insight {
  id: string;
  created_at: ISODateTime;
  source: InsightSource;
  source_date?: ISODate | null;
  severity: InsightSeverity;
  title: string;
  body?: string;
  tags?: string[];
  linked_urls?: string[];
  status: InsightStatus;
}

export interface InsightsFile {
  last_updated: ISODateTime | null;
  insights: Insight[];
}

export type TaskStatus = "open" | "in_progress" | "done" | "deferred";

/**
 * Allowed task owners. Tasks are routed to *teams*, never individual
 * people — this dashboard isn't where the work is tracked day-to-day,
 * it's where Claude logs ideas the right team should pick up.
 */
export const TASK_OWNERS = ["content", "engineering", "peec ai"] as const;
export type TaskOwner = (typeof TASK_OWNERS)[number];

export interface Task {
  id: string;
  created_at: ISODateTime;
  updated_at?: ISODateTime;
  title: string;
  description?: string;
  owner?: TaskOwner;
  status: TaskStatus;
  source_report?: string;
  source_url?: string;
  created_by?: string;

  // ----- Cross-page surfacing fields (added 2026-04-26) -----
  /**
   * Cluster slug this task belongs to. When set, the task surfaces on
   * `/topics/<cluster>` in the "Open work for this cluster" section.
   * Optional — site-wide tasks (e.g. "fix GA4 conversion config") don't
   * carry one.
   */
  cluster?: string;
  /** Language scope for this task. Optional. */
  lang?: "en" | "de";

  // ----- Claude-prompt copy-button field (added 2026-04-26) -----
  /**
   * Self-contained Claude prompt the user can paste to ask Claude to
   * implement / draft / progress this task. The dashboard renders a
   * "Copy prompt" button on every task that carries one.
   *
   * Skills (geo-debug, daily-routine, etc.) populate this when
   * spawning tasks. For derived tasks built at render time from rule
   * pipelines (visibility_improvements, source_gaps), the dashboard
   * fills it in via `deriveClaudePrompt()` in `lib/cluster-fixes.ts`.
   */
  claude_prompt?: string;
}

export interface TasksFile {
  last_updated: ISODateTime | null;
  tasks: Task[];
}

// ---------------------------------------------------------------------
// Config — YAML-sourced
// ---------------------------------------------------------------------

export interface NotionMarketingReportsConfig {
  parent_page_id?: string;
  parent_page_title?: string;
  parent_page_url?: string;
  database_id?: string | null;
  database_url?: string | null;
  data_source_id?: string | null;
  database_title?: string;
}

/**
 * Topic-cluster config shape — the bilingual replacement for
 * TrackedTopic (which was removed on 2026-04-23). Lives in
 * config/topic_clusters.yaml. Each cluster expands to two topic rows
 * (one per lang) at aggregation time.
 */
export interface TopicCluster {
  slug: string;
  names: { en: string; de: string };
  peec_topic_ids: string[];
  gsc_query_patterns: { en: string[]; de: string[] };
  ga4_path_patterns: { en: string[]; de: string[] };
}

// ---------------------------------------------------------------------
// Page-to-cluster assignments — data/processed/page_clusters.json
// ---------------------------------------------------------------------

export type AssignmentConfidence =
  | "url_pattern"
  | "url_pattern_cross_lang"
  | "body_keyword"
  | "default";

export interface PageClusterAssignment {
  url: string;
  cluster: string;
  lang: "en" | "de";
  confidence: AssignmentConfidence;
  title: string | null;
  word_count: number;
  schema_types: string[];
  numeric_claims_count: number;
  has_meta_description: boolean;
  has_h1: boolean;
  internal_links: number;
  external_links: number;
  /** Translated counterpart URL (EN→DE or DE→EN) pulled from
   *  <link rel="alternate" hreflang="..."> in the scraped HTML.
   *  null when the source page didn't declare alternates, or when
   *  scraped before 2026-04-24 (when scrape_site.py started capturing
   *  them). Dashboard uses this — and a fuzzy-title fallback — to
   *  move EN+DE counterparts together when the user reassigns a page. */
  translation_pair_url?: string | null;
}

export interface ClusterContentRollup {
  page_count: number;
  avg_word_count: number;
  schema_article_pct: number;
  pages_with_claims_pct: number;
  pages_missing_meta_pct: number;
  pages_missing_h1_pct: number;
  thin_pages_pct: number;
}

export interface PageClustersFile {
  generated_at: ISODateTime;
  source_inventory: string;
  confidence_counts: Record<AssignmentConfidence, number>;
  assignments: PageClusterAssignment[];
  unassigned: string[];
  /** Key format: `<cluster>::<lang>`. */
  by_cluster: Record<string, ClusterContentRollup>;
}

// ---------------------------------------------------------------------
// Visibility improvements — data/processed/visibility_improvements.json
// ---------------------------------------------------------------------

export type VisibilityRule =
  | "RANK_WITHOUT_SCHEMA"
  | "RANKER_WITHOUT_CLAIMS"
  // THIN_BUT_TRAFFICKED retired 2026-04-26 — word count alone was too
  // crude a signal. Thin-content judgment now lives in Claude-written
  // findings (see `dashboard-sync.md`). Kept absent from this union
  // so any stragglers from old JSON files surface as type errors
  // during refactors; the dashboard runtime also filters them out
  // defensively in `cluster-fixes.ts`.
  | "LOW_CTR_WEAK_META"
  | "BILINGUAL_GAP"
  | "CLUSTER_VISIBILITY_LAG"
  | "ORPHAN_LONGFORM";

export type OpportunitySeverity = "high" | "medium" | "low";

// ---------------------------------------------------------------------
// Prompt issue dismissals — persistent record of suggested-changes
// rows the user has cleared on /strategy/prompts because they made
// the change in Peec themselves (or judged the issue a false positive).
//
// Identity: the issue's stable id `${prompt_id}:${kind}` from
// computePromptIssues. When that exact pair re-appears in a future
// geo-debug pull, it stays hidden until the user restores it. When
// the underlying condition resolves on its own, the dismissal sits
// in the file unused — small bookkeeping cost; we don't auto-clean.
// ---------------------------------------------------------------------

export interface PromptIssueDismissal {
  /** `${prompt_id}:${kind}` — same id PromptIssue.id uses. */
  id: string;
  prompt_id: string;
  /** Stored as a free string so types.ts doesn't depend on
   *  prompts-improvements.ts (which would create an import cycle). */
  kind: string;
  dismissed_at: ISODateTime;
  /** Optional free-text — "fixed in Peec", "false positive", etc. */
  reason?: string;
}

export interface PromptIssueDismissalsFile {
  last_updated: ISODateTime | null;
  dismissals: PromptIssueDismissal[];
}

export interface VisibilityOpportunity {
  id: string;
  rule: VisibilityRule;
  severity: OpportunitySeverity;
  cluster: string;
  lang: "en" | "de";
  url: string; // empty string for cluster-scoped rules (BILINGUAL_GAP, CLUSTER_VISIBILITY_LAG)
  title: string | null;
  evidence: Record<string, unknown>;
  fix: string;
  estimated_lift: string;
}

export interface VisibilityImprovementsFile {
  generated_at: ISODateTime;
  window_days: number;
  source_daily: string;
  opportunities: VisibilityOpportunity[];
  by_cluster_summary: Record<string, {
    opportunities: number;
    high: number;
    medium: number;
    low: number;
  }>;
  rule_definitions: Record<VisibilityRule, string>;
}

// ---------------------------------------------------------------------
// Readiness extras — data/processed/readiness_extras.json
//
// Filled by scripts/compute_readiness_extras.py. Provides the four
// Readiness dimensions that don't need new data sources (fresh, useful,
// differentiated, transactable). Keys are `<cluster>::<lang>`.
// ---------------------------------------------------------------------

export interface ReadinessExtrasClusterRow {
  page_count: number;
  /** 0-1 freshness band based on median days since Last-Modified header. */
  fresh: number | null;
  /** 0-1 engagement band: avg GA4 userEngagementDuration per pageview. */
  useful: number | null;
  /** 0-1 = 1 - mean pairwise Jaccard similarity over body_text vocab. */
  differentiated: number | null;
  /** 0-1 = share of pages hitting the transactability bar
   *  (URL/schema/body-text signals for pricing + plans). */
  transactable: number | null;
  /** Raw counters powering the four scores — surfaced in tooltips. */
  evidence: {
    fresh_median_days_since_modified: number | null;
    useful_avg_seconds_per_view: number | null;
    differentiated_avg_jaccard_similarity: number | null;
    transactable_pages_with_signals: number;
    ga4_pages_matched: number;
    scrape_records_matched: number;
  };
}

export interface ReadinessExtrasFile {
  generated_at: ISODateTime;
  window_days: number;
  scrape_date: ISODate;
  by_cluster: Record<string, ReadinessExtrasClusterRow>;
}

// ---------------------------------------------------------------------
// Source gaps (Peec, Claude-filled) — data/dashboard/source_gaps.json
// ---------------------------------------------------------------------

export interface SourceGapDomain {
  domain: string;
  times_cited: number;
  onino_co_cited_count: number;
  onino_co_cited_pct: number;
  first_seen: ISODate | null;
  example_prompts: string[];
}

export interface SourceGapClusterLang {
  prompts_analyzed: number;
  onino_cited_in: number;
  onino_visibility_pct: number;
  top_cited_domains: SourceGapDomain[];
  never_co_cited_with_onino: string[];
  /** 0-100. 100 = we're absent where everyone else is cited. */
  cluster_gap_score: number;
}

export interface SourceGapsFile {
  last_updated: ISODateTime | null;
  source_mcp: "peec";
  schema_version: number;
  by_cluster: Record<string, {
    en?: SourceGapClusterLang;
    de?: SourceGapClusterLang;
  }>;
}

// ---------------------------------------------------------------------
// Pillar pages — data/dashboard/pillar_pages.json
// ---------------------------------------------------------------------
// User-designated "the page that owns the cluster" per (cluster, lang).
// Drives future pillar-audit rules (are leaf pages linking up to it?
// does it have the most schema / the most claims?). Today, the UI just
// stores + displays it.

export interface PillarPagesFile {
  last_updated: ISODateTime | null;
  /** Key format: `<cluster_slug>::<lang>` → URL of the pillar page. */
  pillars: Record<string, string>;
}

// ---------------------------------------------------------------------
// Cluster overrides — data/dashboard/cluster_overrides.json
// ---------------------------------------------------------------------
// User-authored reassignments of URLs to a different cluster than the
// one scripts/assign_clusters.py chose. Merged over the base
// page_clusters.json at load time.

export interface ClusterOverride {
  url: string;
  cluster: string;
  /** When the override was set. Used for audit + to prefer newer overrides
   *  if an earlier mistake needs revert. */
  updated_at: ISODateTime;
  /** Which user action produced this override (for future UI surfacing). */
  source?: "manual-ui" | "manual-ui-pair" | "api" | "claude";
}

export interface ClusterOverridesFile {
  last_updated: ISODateTime | null;
  overrides: ClusterOverride[];
}

// ---------------------------------------------------------------------
// Custom clusters — data/dashboard/custom_clusters.json
// ---------------------------------------------------------------------
// Clusters created from the dashboard UI. Extend the YAML-editorial
// taxonomy without editing the YAML. `patterns` + `peec_topic_ids` are
// optional (the UI doesn't ask for them on creation; add later in the
// YAML when the cluster is ready to pull Peec/GSC/GA4 metrics).

export interface CustomCluster {
  slug: string;
  names: { en: string; de: string };
  created_at: ISODateTime;
  /** For display — marks this cluster as not coming from the YAML. */
  source: "custom";
}

export interface CustomClustersFile {
  last_updated: ISODateTime | null;
  clusters: CustomCluster[];
}

// ---------------------------------------------------------------------
// GEO debug — data/dashboard/geo_debug.json
// ---------------------------------------------------------------------
// Output of Malte Landwehr's 4-state GEO citation framework, filled by
// Claude's `/geo-debug` skill prompt. Classifies every Peec prompt into
// one of four states, maps each prompt to its cluster + target pages,
// and emits action groups ordered by leverage (D > C > B).

export type GeoPromptState = "A" | "B" | "C" | "D";

export interface GeoPromptDiagnostic {
  prompt_id: string;
  prompt_text: string;
  topic_id: string | null;
  /** Peec tag_ids for this prompt — captured by the geo-debug skill
   *  from list_prompts. Optional because pre-2026-04-26 geo_debug
   *  files don't have it; consumers should fall back gracefully. */
  tag_ids?: string[];
  /** Derived funnel stage from tag_ids. Optional — when missing, the
   *  dashboard's heuristic classifier in analytics.ts:classifyStage
   *  derives one from prompt text instead. */
  stage?: "TOFU" | "MOFU" | "BOFU" | null;
  /** Cluster slug this prompt maps to via topic_id. Null if the prompt's
   *  Peec topic isn't in the cluster config yet. */
  cluster: string | null;
  cluster_display: string | null;
  lang: "en" | "de";
  state: GeoPromptState;
  citation_rate: number;
  retrieved_percentage: number;
  retrieval_rate: number;
  fanout_count: number;
  /** First 3–5 fanout queries — enough for the UI card; skill trims for
   *  call budget reasons. */
  fanout_queries_sample: string[];
  /** Set only on State B prompts, where Claude sampled a chat to inspect
   *  the AI's phrasing. Null for A/C/D. */
  sample_chat_id: string | null;
  ai_language_sample: string | null;
  /** Tailored recommendation string. Empty for State A. */
  recommended_action: string | null;
  /** Pages in the same (cluster, lang) — top 5 by word_count. Used by
   *  the drawer to show "fix these specifically". */
  target_pages: string[];
  /** Pillar page for this (cluster, lang), if designated. Null otherwise. */
  pillar_page: string | null;
}

export interface GeoClusterRollup {
  prompt_count: number;
  state_counts: Record<GeoPromptState, number>;
  /** (state A + B) / total — at least the domain is in play for this
   *  cluster. Higher is better. */
  citeability_score: number;
  /** Which priority needs the most attention: "D" > "C" > "B" > "A". */
  top_priority: GeoPromptState;
  urgent_action_count: number;
}

export interface GeoActionGroupItem {
  prompt_id: string;
  prompt_text: string;
  cluster: string | null;
  cluster_display: string | null;
  lang: "en" | "de";
  fanout_queries_sample: string[];
  recommended_action: string;
  /** Only on P3 (citeability) items. */
  ai_language_sample?: string;
  target_pages: string[];
}

export interface GeoDebugFile {
  generated_at: ISODateTime | null;
  domain: string;
  project_id: string;
  window: {
    start_date: ISODate;
    end_date: ISODate;
    days: number;
  } | null;
  summary: {
    total_prompts: number;
    state_a: number;
    state_b: number;
    state_c: number;
    state_d: number;
    /** (state_a + state_b) / total_prompts. Null when total_prompts = 0. */
    citeability_health_score: number | null;
  };
  prompts: GeoPromptDiagnostic[];
  /** Key: `<cluster>::<lang>`. */
  by_cluster: Record<string, GeoClusterRollup>;
  action_groups: {
    p1_create_pages: GeoActionGroupItem[];
    p2_source_worthiness: GeoActionGroupItem[];
    p3_citeability: GeoActionGroupItem[];
  };
}

// ---------------------------------------------------------------------
// Helpers: the "trend" shape used by the overview chart
// ---------------------------------------------------------------------

export interface TrendPoint {
  date: ISODate;
  seo_score: number | null;
  geo_score: number | null;
  llm_sessions: number | null;
  total_clicks: number | null;
  /** GSC impressions. Nulled on stale-GSC days (same rule as total_clicks)
   *  so the sanity-check totals don't include phantom zeros. */
  total_impressions: number | null;
  sessions: number | null;
  conversions: number | null;
}

// ---------------------------------------------------------------------
// Refresh state — data/dashboard/refresh_state.json
// Dashboard-triggered GSC/GA4/LLM-traffic pulls update this file.
// Peec + Notion are Claude-triggered and don't write here.
// ---------------------------------------------------------------------

export type RefreshStatus = "idle" | "running" | "success" | "failed";

export type RefreshSource = "gsc" | "ga4" | "llm_traffic" | "aggregate";

export interface RefreshSourceState {
  last_run_at: ISODateTime | null;
  latest_date: ISODate | null;          // the newest date we have raw data for
  days_back: number | null;              // last window we pulled
  last_error: string | null;
}

export interface RefreshState {
  status: RefreshStatus;
  started_at: ISODateTime | null;
  completed_at: ISODateTime | null;
  days_back: number | null;
  dates_processed: ISODate[];
  dates_failed: ISODate[];
  sources: Record<RefreshSource, RefreshSourceState>;
  /** Last ~50 lines of stdout from the most recent run, for debugging. */
  log_tail: string[];
  /**
   * Peec + Notion don't refresh from the dashboard. We surface their
   * last-known state so the "Data freshness" panel is complete.
   */
  peec_note: string;
  notion_note: string;
}

// ---------------------------------------------------------------------
// Historical deltas + rolling averages
// ---------------------------------------------------------------------

export interface HistoricalSnapshot {
  /** The most recent non-null daily value. */
  current: number | null;
  /**
   * The date the `current` value came from. Equals the latest trend date
   * when data is fresh. Lags behind when the latest day's source is
   * stale (e.g. GSC 24–48h lag on today). null iff `current` is null.
   */
  current_date: string | null;
  /** Average over a rolling window (e.g., 30 days). */
  window_avg: number | null;
  /** Percent change of current vs window_avg. null if baseline is 0 or missing. */
  delta_pct: number | null;
  /** Direction of the 7-day vs prior-7-day trend, for sparkline arrows. */
  direction: "up" | "down" | "flat" | null;
  /** Number of valid data points used in the window. */
  sample_size: number;
}

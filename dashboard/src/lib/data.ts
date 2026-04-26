/**
 * Filesystem readers — Server-side only.
 *
 * Called from Server Components (and Route Handlers if we add them).
 * The dashboard is a thin viewer over JSON + YAML files the Python
 * pipeline + Claude skill produce. No network calls. No caching
 * outside Next.js's normal fetch/RSC cache (we invalidate manually
 * via the auto-refresh client component).
 */

import path from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import yaml from "js-yaml";

import type {
  ClusterOverridesFile,
  CustomClustersFile,
  DailyAggregate,
  DailyPagesSlice,
  DailyTopicsSlice,
  GeoDebugFile,
  HistoricalSnapshot,
  InsightsFile,
  NotionMarketingReportsConfig,
  PageClusterAssignment,
  PageClustersFile,
  PillarPagesFile,
  PromptIssueDismissalsFile,
  ReadinessExtrasFile,
  SourceGapsFile,
  TasksFile,
  TopicCluster,
  TrendPoint,
  VisibilityImprovementsFile,
  WeeklyAggregate,
} from "./types";

// ---------------------------------------------------------------------
// Repo-root-relative paths. Next.js is served from ./dashboard, so the
// repo root is one level up.
// ---------------------------------------------------------------------

const REPO_ROOT = path.resolve(process.cwd(), "..");

const DATA_PROCESSED_DAILY = path.join(REPO_ROOT, "data", "processed", "daily");
const DATA_PROCESSED_WEEKLY = path.join(REPO_ROOT, "data", "processed", "weekly");
const DATA_DASHBOARD = path.join(REPO_ROOT, "data", "dashboard");
const CONFIG_DIR = path.join(REPO_ROOT, "config");

// ---------------------------------------------------------------------
// Low-level read helpers (tolerant of missing files)
// ---------------------------------------------------------------------

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    const content = await readFile(p, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function readYaml<T>(p: string): Promise<T | null> {
  try {
    const content = await readFile(p, "utf-8");
    return (yaml.load(content) || null) as T | null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Public readers
// ---------------------------------------------------------------------

/**
 * Return the most-recent daily aggregate file, or null if none exist.
 * Tuple [date, payload] — date is the filename stem (e.g. "2026-04-20").
 */
export async function loadLatestDaily(): Promise<[string, DailyAggregate] | null> {
  if (!(await exists(DATA_PROCESSED_DAILY))) return null;
  const files = (await readdir(DATA_PROCESSED_DAILY))
    .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"))
    .sort();
  if (files.length === 0) return null;
  const latest = files[files.length - 1];
  const payload = await readJson<DailyAggregate>(path.join(DATA_PROCESSED_DAILY, latest));
  if (!payload) return null;
  return [latest.replace(".json", ""), payload];
}

/**
 * Return the last N daily aggregates as full [date, payload] tuples,
 * oldest first. Used by the page-level analytics view, which needs the
 * complete daily payload (top_queries × this URL, cross_channel rows)
 * — `loadDailyTopicsSlices` and `loadDailyPagesSlices` both project the
 * payload down to one specific field, which would lose the data we need.
 */
export async function loadDailyAggregates(
  windowDays: number = 30,
): Promise<Array<[string, DailyAggregate]>> {
  if (!(await exists(DATA_PROCESSED_DAILY))) return [];
  const files = (await readdir(DATA_PROCESSED_DAILY))
    .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"))
    .sort();
  const last = files.slice(-windowDays);
  const out: Array<[string, DailyAggregate]> = [];
  for (const f of last) {
    const payload = await readJson<DailyAggregate>(path.join(DATA_PROCESSED_DAILY, f));
    if (!payload) continue;
    out.push([f.replace(".json", ""), payload]);
  }
  return out;
}

/** Return the most-recent weekly aggregate file, or null. */
export async function loadLatestWeekly(): Promise<[string, WeeklyAggregate] | null> {
  if (!(await exists(DATA_PROCESSED_WEEKLY))) return null;
  const files = (await readdir(DATA_PROCESSED_WEEKLY))
    .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"))
    .sort();
  if (files.length === 0) return null;
  const latest = files[files.length - 1];
  const payload = await readJson<WeeklyAggregate>(path.join(DATA_PROCESSED_WEEKLY, latest));
  if (!payload) return null;
  return [latest.replace(".json", ""), payload];
}

/**
 * Detect "stale" source-day pairs where the raw upstream didn't land yet
 * but the aggregator still wrote zeros. Used to turn those zeros into nulls
 * so the dashboard shows the last *real* value on the card instead of a
 * misleading 0 that looks like a crash anomaly.
 *
 * GSC lags 24–48h; GA4 lags a few hours. On a recent day both are likely
 * to run before their respective API serves finalized data.
 */
function detectStaleSources(payload: DailyAggregate): { gsc: boolean; ga4: boolean } {
  const seo = payload.summary?.seo;
  const ga = payload.summary?.traffic;

  // GSC is stale iff: no queries were returned AND both clicks+impressions
  // are zero AND position is null. A real zero-traffic day would normally
  // still have at least one impression for a brand-name query at typical
  // brand scale, so this pattern is effectively GSC-returned-nothing.
  const gscStale =
    !!seo &&
    seo.available !== false &&
    (seo.top_queries?.length ?? 0) === 0 &&
    (seo.total_clicks ?? 0) === 0 &&
    (seo.total_impressions ?? 0) === 0 &&
    (seo.avg_position ?? null) === null;

  // GA4 is stale iff: no pages returned AND sessions AND users are zero.
  // GA4's lag is typically much shorter than GSC, so this rarely fires;
  // kept symmetric for robustness.
  const ga4Stale =
    !!ga &&
    ga.available !== false &&
    (ga.top_pages_ga?.length ?? 0) === 0 &&
    (ga.sessions ?? 0) === 0 &&
    (ga.users ?? 0) === 0;

  return { gsc: gscStale, ga4: ga4Stale };
}

/**
 * Return the last N daily aggregates in chronological order (oldest first),
 * flattened to chart-friendly TrendPoint records. Missing metrics are null.
 *
 * Stale-source handling: if a day's GSC or GA4 raw clearly hadn't landed
 * yet when aggregate_daily ran, the corresponding metrics are returned as
 * null rather than 0. This keeps downstream consumers (snapshotOf, charts)
 * from treating pending-data zeros as real values.
 */
export async function loadTrend(window: number = 14): Promise<TrendPoint[]> {
  if (!(await exists(DATA_PROCESSED_DAILY))) return [];
  const files = (await readdir(DATA_PROCESSED_DAILY))
    .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"))
    .sort();
  const last = files.slice(-window);
  const points: TrendPoint[] = [];
  for (const f of last) {
    const payload = await readJson<DailyAggregate>(path.join(DATA_PROCESSED_DAILY, f));
    if (!payload) continue;

    const stale = detectStaleSources(payload);

    // GSC-derived fields: total_clicks, total_impressions, seo_score.
    const total_clicks = stale.gsc ? null : (payload.summary?.seo?.total_clicks ?? null);
    const total_impressions = stale.gsc ? null : (payload.summary?.seo?.total_impressions ?? null);
    const seo_score = stale.gsc ? null : (payload.scores?.seo_score ?? null);

    // GA4-derived fields: sessions, conversions, and llm_sessions (since
    // LLM-traffic parsing happens over GA4 referrer data).
    const sessions = stale.ga4 ? null : (payload.summary?.traffic?.sessions ?? null);
    const conversions = stale.ga4 ? null : (payload.summary?.traffic?.conversions ?? null);
    const llm_sessions = stale.ga4 ? null : (payload.summary?.llm_traffic?.sessions ?? null);

    points.push({
      date: payload.date,
      seo_score,
      geo_score: payload.scores?.geo_score ?? null,
      llm_sessions,
      total_clicks,
      total_impressions,
      sessions,
      conversions,
    });
  }
  return points;
}

/**
 * Peek at the raw staleness flags for the most recent daily aggregate.
 * Used by the overview to show a "today's GSC is still landing" banner.
 */
export async function loadLatestStaleness(): Promise<{
  date: string;
  gsc: boolean;
  ga4: boolean;
} | null> {
  const latest = await loadLatestDaily();
  if (!latest) return null;
  const [date, payload] = latest;
  const stale = detectStaleSources(payload);
  return { date, ...stale };
}

/**
 * Count the number of daily aggregate files on disk. Used by the
 * timeframe selector to show "(N days available)" and disable window
 * options that exceed what we actually have — otherwise clicking 30d
 * while only 7 files exist silently produces the same rollup as 7d.
 */
export async function countDailyAggregateFiles(): Promise<number> {
  if (!(await exists(DATA_PROCESSED_DAILY))) return 0;
  try {
    const files = (await readdir(DATA_PROCESSED_DAILY))
      .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"));
    return files.length;
  } catch {
    return 0;
  }
}

/**
 * Load per-day cross-channel page slices for the last N days, oldest first.
 *
 * Used by the Overview's Top Pages table to aggregate across a
 * user-selected window client-side. We only ship the fields the
 * table needs (cross_channel.top_pages_all_channels) — the full
 * daily aggregate is ~150 KB and we don't want 30× that crossing
 * the RSC boundary.
 */
export async function loadDailyPagesSlices(
  windowDays: number = 30
): Promise<DailyPagesSlice[]> {
  if (!(await exists(DATA_PROCESSED_DAILY))) return [];
  const files = (await readdir(DATA_PROCESSED_DAILY))
    .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"))
    .sort();
  const last = files.slice(-windowDays);
  const out: DailyPagesSlice[] = [];
  for (const f of last) {
    const payload = await readJson<DailyAggregate>(path.join(DATA_PROCESSED_DAILY, f));
    if (!payload) continue;
    out.push({
      date: payload.date,
      pages: payload.cross_channel?.top_pages_all_channels ?? [],
    });
  }
  return out;
}

/**
 * Load per-day cross-channel topic slices for the last N days.
 * Same rationale as loadDailyPagesSlices — ships only the rows the
 * Topics table needs to compute a windowed rollup.
 */
export async function loadDailyTopicsSlices(
  windowDays: number = 30
): Promise<DailyTopicsSlice[]> {
  if (!(await exists(DATA_PROCESSED_DAILY))) return [];
  const files = (await readdir(DATA_PROCESSED_DAILY))
    .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"))
    .sort();
  const last = files.slice(-windowDays);
  const out: DailyTopicsSlice[] = [];
  for (const f of last) {
    const payload = await readJson<DailyAggregate>(path.join(DATA_PROCESSED_DAILY, f));
    if (!payload) continue;
    out.push({
      date: payload.date,
      topics: payload.cross_channel?.top_topics ?? [],
    });
  }
  return out;
}

/**
 * Tag context from the most recent raw Peec daily.
 *
 * Returns:
 *   - the full tag list (id + name) — used to render tag-name badges
 *     on per-prompt rows in the Prompt Improvements view.
 *   - tag_quality_flags — case-duplicates and malformed-name issues
 *     the Peec project carries, surfaced as Issues at the top of the
 *     Prompt Improvements page.
 *
 * Both come from the raw Peec context block. The processed daily
 * aggregate only ever stores the IDs in `tag_ids` arrays, so this
 * loader is the single place that resolves them to names.
 */
export interface PeecTagsContext {
  tags: { id: string; name: string }[];
  tag_quality_flags: Array<
    | { issue: "case_duplicate"; tag_ids: string[]; names: string[] }
    | { issue: "malformed_name"; tag_id: string; name: string; note?: string }
  >;
}

export async function loadLatestPeecTags(): Promise<PeecTagsContext | null> {
  const dir = path.join(REPO_ROOT, "data", "raw", "peec");
  if (!(await exists(dir))) return null;
  const files = (await readdir(dir))
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  const latest = files[files.length - 1];
  if (!latest) return null;
  const payload = await readJson<{
    context?: {
      tags?: { id: string; name: string }[];
      tag_quality_flags?: PeecTagsContext["tag_quality_flags"];
    };
  }>(path.join(dir, latest));
  if (!payload?.context) return null;
  return {
    tags: payload.context.tags ?? [],
    tag_quality_flags: payload.context.tag_quality_flags ?? [],
  };
}

/**
 * Compute the branded vs non-branded organic-search split across the
 * last `windowDays` daily aggregates. Branded = top_queries text matches
 * a configured brand regex (your brand surfaces). Long-tail brand
 * queries below the daily top-N can leak into "non-branded";
 * tolerable for a directional Layer-3 proxy.
 *
 * Configure your brand terms via the BRAND_REGEX env var (a JS regex
 * source string, e.g. "acme|acmecorp"). Defaults to "acme".
 */
export async function loadBrandedSearchSplit(windowDays: number = 30): Promise<{
  branded_clicks: number;
  total_clicks: number;
}> {
  if (!(await exists(DATA_PROCESSED_DAILY))) {
    return { branded_clicks: 0, total_clicks: 0 };
  }
  const files = (await readdir(DATA_PROCESSED_DAILY))
    .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"))
    .sort();
  const last = files.slice(-windowDays);

  // Branded matchers. Configure your own brand regex via env; the
  // default below is a safe placeholder — replace `acme` with your
  // actual brand surface(s).
  const brandSource = process.env.BRAND_REGEX || "acme";
  const BRAND_RE = new RegExp(`(?:${brandSource})`, "i");

  let branded = 0;
  let total = 0;
  for (const f of last) {
    const payload = await readJson<DailyAggregate>(path.join(DATA_PROCESSED_DAILY, f));
    if (!payload?.summary?.seo) continue;
    total += payload.summary.seo.total_clicks ?? 0;
    for (const q of payload.summary.seo.top_queries ?? []) {
      if (BRAND_RE.test(q.query)) branded += q.clicks ?? 0;
    }
  }
  return { branded_clicks: branded, total_clicks: total };
}

/** Read the Claude-written insights file; empty shape if missing. */
export async function loadInsights(): Promise<InsightsFile> {
  const p = path.join(DATA_DASHBOARD, "insights.json");
  const payload = await readJson<InsightsFile>(p);
  return payload ?? { last_updated: null, insights: [] };
}

/** Read the Claude-written tasks file; empty shape if missing. */
export async function loadTasks(): Promise<TasksFile> {
  const p = path.join(DATA_DASHBOARD, "tasks.json");
  const payload = await readJson<TasksFile>(p);
  return payload ?? { last_updated: null, tasks: [] };
}

/**
 * Read user-dismissed prompt-issue rows from /strategy/prompts.
 * The file is written by the dashboard's API route when the user
 * clears a "Suggested changes" row they fixed directly in Peec.
 * Empty shape when no dismissals have been made yet.
 */
export async function loadPromptIssueDismissals(): Promise<PromptIssueDismissalsFile> {
  const p = path.join(DATA_DASHBOARD, "prompt_issue_dismissals.json");
  const payload = await readJson<PromptIssueDismissalsFile>(p);
  return payload ?? { last_updated: null, dismissals: [] };
}

/** Read the Marketing Reports section from notion_schema.yaml. */
export async function loadNotionConfig(): Promise<NotionMarketingReportsConfig> {
  const p = path.join(CONFIG_DIR, "notion_schema.yaml");
  const doc = await readYaml<{ marketing_reports?: NotionMarketingReportsConfig }>(p);
  return doc?.marketing_reports ?? {};
}

/**
 * Read the topic-cluster config (bilingual). Replaced loadTrackedTopics
 * on 2026-04-23. Returns [] if the file is missing so the Topic Clusters
 * page renders an empty-state rather than crashing.
 */
export async function loadTopicClusters(): Promise<TopicCluster[]> {
  const p = path.join(CONFIG_DIR, "topic_clusters.yaml");
  const doc = await readYaml<{ clusters?: TopicCluster[] }>(p);
  return doc?.clusters ?? [];
}

/**
 * Read the page-to-cluster assignment table written by
 * scripts/assign_clusters.py after each scrape. Returns null when the
 * file is missing — consumers should render a "run assign_clusters"
 * empty-state in that case.
 */
export async function loadPageClusters(): Promise<PageClustersFile | null> {
  const p = path.join(REPO_ROOT, "data", "processed", "page_clusters.json");
  return readJson<PageClustersFile>(p);
}

/**
 * Read the AI-visibility-improvements rule output written by
 * scripts/compute_visibility_improvements.py. Feeds the top panel of
 * the Insights page. Null when the file is missing.
 */
export async function loadVisibilityImprovements(): Promise<VisibilityImprovementsFile | null> {
  const p = path.join(REPO_ROOT, "data", "processed", "visibility_improvements.json");
  return readJson<VisibilityImprovementsFile>(p);
}

/**
 * Read the four derived Readiness dimensions (fresh / useful /
 * differentiated / transactable) written by
 * scripts/compute_readiness_extras.py. Merged into computeReadiness()
 * to fill the slots that used to read as "not yet computed".
 * Null when the file is missing — readiness then falls back to the
 * 4 dimensions we compute directly from page_clusters + source_gaps.
 */
export async function loadReadinessExtras(): Promise<ReadinessExtrasFile | null> {
  const p = path.join(REPO_ROOT, "data", "processed", "readiness_extras.json");
  return readJson<ReadinessExtrasFile>(p);
}

/**
 * Read user-designated pillar pages per (cluster, lang). Mutated via
 * /api/pillar-pages PATCH. Empty shape if never written.
 */
export async function loadPillarPages(): Promise<PillarPagesFile> {
  const p = path.join(DATA_DASHBOARD, "pillar_pages.json");
  const doc = await readJson<PillarPagesFile>(p);
  return doc ?? { last_updated: null, pillars: {} };
}

/**
 * Read user-authored cluster overrides. These replace the cluster on
 * the matching URL at merge time, without touching the Python-written
 * page_clusters.json. Mutated via /api/page-overrides PATCH.
 */
export async function loadClusterOverrides(): Promise<ClusterOverridesFile> {
  const p = path.join(DATA_DASHBOARD, "cluster_overrides.json");
  const doc = await readJson<ClusterOverridesFile>(p);
  return doc ?? { last_updated: null, overrides: [] };
}

/**
 * Read manually-created clusters (from the dashboard UI). Extends the
 * YAML-editorial taxonomy. Mutated via /api/clusters routes.
 */
export async function loadCustomClusters(): Promise<CustomClustersFile> {
  const p = path.join(DATA_DASHBOARD, "custom_clusters.json");
  const doc = await readJson<CustomClustersFile>(p);
  return doc ?? { last_updated: null, clusters: [] };
}

/**
 * Apply cluster overrides over a list of base page assignments.
 * Returns a new array — does not mutate the input. Entries in
 * `overrides` with no matching URL in `base` are ignored (e.g. a
 * page got pruned from the site; the override is stale).
 */
export function applyClusterOverrides(
  base: PageClusterAssignment[],
  overrides: ClusterOverridesFile["overrides"],
): PageClusterAssignment[] {
  if (overrides.length === 0) return base;
  const byUrl = new Map(overrides.map((o) => [o.url, o.cluster]));
  return base.map((a) => {
    const newCluster = byUrl.get(a.url);
    return newCluster ? { ...a, cluster: newCluster, confidence: "default" as const } : a;
  });
}

/**
 * Read the GEO debug report (Malte Landwehr's 4-state citation
 * framework). Filled by Claude's `/geo-debug` skill prompt. Empty
 * shape when not yet run — the UI shows an onboarding state in that
 * case, prompting the user to run the skill.
 */
export async function loadGeoDebug(): Promise<GeoDebugFile> {
  const p = path.join(DATA_DASHBOARD, "geo_debug.json");
  const doc = await readJson<GeoDebugFile>(p);
  return (
    doc ?? {
      generated_at: null,
      domain: "acme.io",
      project_id: "or_REPLACE_WITH_YOUR_PROJECT_ID",
      window: null,
      summary: {
        total_prompts: 0,
        state_a: 0,
        state_b: 0,
        state_c: 0,
        state_d: 0,
        citeability_health_score: null,
      },
      prompts: [],
      by_cluster: {},
      action_groups: {
        p1_create_pages: [],
        p2_source_worthiness: [],
        p3_citeability: [],
      },
    }
  );
}

/**
 * Read the Claude-authored source-gap analysis (Peec MCP-derived).
 * Filled by the `/source-gap-refresh` skill prompt. Empty shape if
 * never run.
 */
export async function loadSourceGaps(): Promise<SourceGapsFile> {
  const p = path.join(DATA_DASHBOARD, "source_gaps.json");
  const doc = await readJson<SourceGapsFile>(p);
  return (
    doc ?? {
      last_updated: null,
      source_mcp: "peec",
      schema_version: 1,
      by_cluster: {},
    }
  );
}

// ---------------------------------------------------------------------
// Historical helpers — rolling averages + 7-vs-prior-7 direction
// ---------------------------------------------------------------------

/**
 * Compute a historical snapshot for a single metric across the trend array:
 *   - current = most recent non-null value
 *   - current_date = the date that `current` came from (may lag the latest
 *     trend date if the newest day's source is stale)
 *   - window_avg = mean of last `windowDays` non-null values
 *   - delta_pct = (current - avg) / avg * 100
 *   - direction = up/down/flat based on last-7-avg vs prior-7-avg
 */
export function snapshotOf(
  points: TrendPoint[],
  key: keyof Omit<TrendPoint, "date">,
  windowDays: number = 30
): HistoricalSnapshot {
  // Walk backwards to find the most recent non-null value AND remember
  // which date it belongs to — this is what drives the "as of X" hint.
  let current: number | null = null;
  let currentDate: string | null = null;
  for (let i = points.length - 1; i >= 0; i--) {
    const v = points[i][key];
    if (typeof v === "number") {
      current = v;
      currentDate = points[i].date;
      break;
    }
  }

  const values = points.map((p) => (typeof p[key] === "number" ? (p[key] as number) : null));
  const windowValues = values.slice(-windowDays).filter((v): v is number => v !== null);
  const windowAvg = windowValues.length > 0
    ? windowValues.reduce((a, b) => a + b, 0) / windowValues.length
    : null;
  const deltaPct =
    windowAvg !== null && windowAvg !== 0 && current !== null
      ? ((current - windowAvg) / windowAvg) * 100
      : null;

  // Direction: 7-day recent avg vs 7 days before that
  const last7 = values.slice(-7).filter((v): v is number => v !== null);
  const prior7 = values.slice(-14, -7).filter((v): v is number => v !== null);
  let direction: HistoricalSnapshot["direction"] = null;
  if (last7.length > 0 && prior7.length > 0) {
    const last7Avg = last7.reduce((a, b) => a + b, 0) / last7.length;
    const prior7Avg = prior7.reduce((a, b) => a + b, 0) / prior7.length;
    const relative = prior7Avg !== 0 ? (last7Avg - prior7Avg) / Math.abs(prior7Avg) : 0;
    if (Math.abs(relative) < 0.05) direction = "flat";
    else direction = relative > 0 ? "up" : "down";
  }

  return {
    current,
    current_date: currentDate,
    window_avg: windowAvg,
    delta_pct: deltaPct,
    direction,
    sample_size: windowValues.length,
  };
}

/**
 * Compute a 7-day rolling mean for a series. Returns an array of same
 * length with null for the first 6 points and the rolling mean thereafter.
 */
export function rollingMean(
  series: (number | null)[],
  window: number = 7
): (number | null)[] {
  return series.map((_, i) => {
    if (i < window - 1) return null;
    const slice = series.slice(i - window + 1, i + 1).filter((v): v is number => v !== null);
    if (slice.length === 0) return null;
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

/**
 * Per-topic historical trend across the last N daily files.
 * Returns a map: topic name → {current, 7d_direction} computed from
 * the topic's `geo_mentions` series (best available signal today —
 * most topics have 0 SEO clicks on most days).
 */
export async function loadTopicTrends(
  windowDays: number = 14
): Promise<Record<string, HistoricalSnapshot>> {
  const { readdir } = await import("node:fs/promises");
  const dir = DATA_PROCESSED_DAILY;
  try {
    await stat(dir);
  } catch {
    return {};
  }
  const files = (await readdir(dir))
    .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"))
    .sort()
    .slice(-windowDays);

  // Build a per-topic series: topic -> array of (geo_mentions | null) per day
  const series: Record<string, (number | null)[]> = {};
  for (const f of files) {
    const payload = await readJson<DailyAggregate>(path.join(dir, f));
    const topics = payload?.cross_channel?.top_topics ?? [];
    const seen = new Set<string>();
    for (const t of topics) {
      seen.add(t.topic);
      (series[t.topic] ??= []).push(t.geo_mentions ?? null);
    }
    // Pad every other known series with null so lengths align
    for (const k of Object.keys(series)) {
      if (!seen.has(k)) {
        series[k].push(null);
      }
    }
  }

  const out: Record<string, HistoricalSnapshot> = {};
  for (const [topic, values] of Object.entries(series)) {
    // Turn into fake TrendPoint-like structure just to reuse snapshotOf
    const fake: TrendPoint[] = values.map((v, i) => ({
      date: `day-${i}`,
      seo_score: null,
      geo_score: null,
      llm_sessions: null,
      total_clicks: null,
      total_impressions: null,
      sessions: null,
      conversions: null,
      // We abuse "conversions" below — just need a field to write to
    }));
    // Overwrite conversions with our series for snapshotOf to read
    values.forEach((v, i) => {
      fake[i].conversions = v;
    });
    out[topic] = snapshotOf(fake, "conversions", windowDays);
  }
  return out;
}

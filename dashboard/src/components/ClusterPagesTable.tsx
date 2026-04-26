"use client";

/**
 * Per-page traffic + AI-answer view.
 *
 * Complements TopicClustersTable (cluster-level) by showing one row
 * per scraped URL. Lives under /topics behind the "Page View" toggle
 * owned by TopicsShell. Shares the same lang selection as the cluster
 * view so toggling between them keeps the user's language in place.
 *
 * Data sources joined:
 *   - `rollPages(slices, window)` → per-URL window rollup of
 *     seo_clicks, seo_impressions, ga_sessions, llm_sessions,
 *     peec_citations, composite_score, days_active.
 *   - `PageClusterAssignment[]` → cluster + lang + title for each URL.
 *     Pages without an assignment are skipped — the page view is a
 *     per-cluster lens, and unassigned URLs don't belong to any cluster.
 *
 * Column philosophy: traffic signals only. Word count, schema %, and
 * claims % were removed from both views (2026-04-24) — those live on
 * the individual page's detail or the Visibility Improvements panel;
 * showing them as columns here clutters the table without driving
 * action. The user ranks pages by composite score by default and
 * drills into cluster membership + traffic distribution from there.
 */

import { useMemo } from "react";
import clsx from "clsx";

import { DataTable, type Column } from "@/components/DataTable";
import { useTimeframe } from "@/components/TimeframeContext";
import { rollPages } from "@/lib/rollup";
import type {
  CustomCluster,
  DailyPagesSlice,
  PageClusterAssignment,
  RolledPage,
  TopicCluster,
} from "@/lib/types";

interface PageRow extends RolledPage {
  cluster: string;
  clusterLabel: string;
  lang: "en" | "de";
  title: string;
  /** Path portion of URL — used for search + display under the title. */
  path: string;
}

const COL_INFO = {
  page: (
    <>The page URL. Click the title to open it in a new tab. Sort alphabetically by path.</>
  ),
  cluster: (
    <>The cluster this URL is assigned to — via scripts/assign_clusters.py plus any manual overrides in data/dashboard/cluster_overrides.json.</>
  ),
  seoClicks: (
    <>Organic Google clicks landing on this page, summed across the topbar&apos;s window.</>
  ),
  seoImpressions: (
    <>GSC impressions for this URL in the selected window.</>
  ),
  gaSessions: (
    <>GA4 sessions that included this URL in the selected window.</>
  ),
  llmSessions: (
    <>GA4 sessions attributed to LLM referrers (chat.openai.com, perplexity.ai, gemini.google.com, etc).</>
  ),
  peecCitations: (
    <>Number of Peec-tracked AI answers that cited this URL as a source.</>
  ),
  score: (
    <>
      Composite 0–1 score blending SEO clicks, GA sessions, Peec
      citations, and LLM sessions. Same formula used by the Python
      aggregator on /overview.
    </>
  ),
  days: (
    <>Number of days in the window where this URL had any non-zero signal across any channel.</>
  ),
};

const COLUMNS: Column<PageRow>[] = [
  {
    key: "page",
    label: "Page",
    align: "left",
    info: COL_INFO.page,
    accessor: (r) => r.path,
    sortDirOnFirstClick: "asc",
    render: (r) => (
      <div className="min-w-0">
        <a
          href={r.url}
          target="_blank"
          rel="noreferrer"
          className="block text-ink-900 font-medium hover:text-primary-700 hover:underline truncate max-w-[22rem]"
          title={r.title || r.path}
          // Opening the URL shouldn't also navigate the row click (if added later).
          onClick={(e) => e.stopPropagation()}
        >
          {r.title || r.path}
        </a>
        <span
          className="block text-[11px] text-ink-400 truncate max-w-[22rem]"
          title={r.path}
        >
          {r.path}
        </span>
      </div>
    ),
  },
  {
    key: "cluster",
    label: "Cluster",
    align: "left",
    info: COL_INFO.cluster,
    accessor: (r) => r.clusterLabel,
    sortDirOnFirstClick: "asc",
    render: (r) => (
      <span className="inline-block text-xs px-2 py-0.5 rounded bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-200">
        {r.clusterLabel}
      </span>
    ),
  },
  {
    key: "seo_clicks",
    label: "SEO clicks",
    align: "right",
    info: COL_INFO.seoClicks,
    accessor: (r) => r.seo_clicks,
    render: (r) => (
      <span className={clsx("tabular-nums", r.seo_clicks === 0 && "text-ink-400")}>
        {r.seo_clicks.toLocaleString()}
      </span>
    ),
  },
  {
    key: "seo_impressions",
    label: "SEO imp.",
    align: "right",
    info: COL_INFO.seoImpressions,
    accessor: (r) => r.seo_impressions,
    render: (r) => (
      <span
        className={clsx("tabular-nums", r.seo_impressions === 0 && "text-ink-400")}
      >
        {r.seo_impressions.toLocaleString()}
      </span>
    ),
  },
  {
    key: "ga_sessions",
    label: "GA sessions",
    align: "right",
    info: COL_INFO.gaSessions,
    accessor: (r) => r.ga_sessions,
    render: (r) => (
      <span className={clsx("tabular-nums", r.ga_sessions === 0 && "text-ink-400")}>
        {r.ga_sessions.toLocaleString()}
      </span>
    ),
  },
  {
    key: "llm_sessions",
    label: "LLM",
    align: "right",
    info: COL_INFO.llmSessions,
    accessor: (r) => r.llm_sessions,
    render: (r) => (
      <span className={clsx("tabular-nums", r.llm_sessions === 0 && "text-ink-400")}>
        {r.llm_sessions.toLocaleString()}
      </span>
    ),
  },
  {
    key: "peec_citations",
    label: "Peec",
    align: "right",
    info: COL_INFO.peecCitations,
    accessor: (r) => r.peec_citations,
    render: (r) => (
      <span
        className={clsx("tabular-nums", r.peec_citations === 0 && "text-ink-400")}
      >
        {r.peec_citations.toLocaleString()}
      </span>
    ),
  },
  {
    key: "composite_score",
    label: "Score",
    align: "right",
    info: COL_INFO.score,
    accessor: (r) => r.composite_score,
    render: (r) => (
      <span
        className={clsx(
          "tabular-nums",
          r.composite_score === 0 && "text-ink-400",
          r.composite_score >= 0.5 && "text-emerald-700 font-medium",
        )}
      >
        {r.composite_score.toFixed(2)}
      </span>
    ),
  },
  {
    key: "days_active",
    label: "Days",
    align: "right",
    info: COL_INFO.days,
    accessor: (r) => r.days_active,
    render: (r) => (
      <span className="tabular-nums text-ink-700">{r.days_active}</span>
    ),
  },
];

export interface ClusterPagesTableProps {
  /** Per-day page slices, oldest first. */
  slices: DailyPagesSlice[];
  /** All page-to-cluster assignments (with manual overrides applied). */
  assignments: PageClusterAssignment[];
  /** Config clusters (for label lookup). */
  configClusters: TopicCluster[];
  /** Custom clusters (for label lookup). */
  customClusters: CustomCluster[];
  /** Active language — controlled by TopicsShell. */
  lang: "en" | "de";
}

export function ClusterPagesTable({
  slices,
  assignments,
  configClusters,
  customClusters,
  lang,
}: ClusterPagesTableProps) {
  const { window } = useTimeframe();

  // slug → display label (EN canonical; matches breadcrumbs convention).
  const clusterLabelBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of configClusters) m.set(c.slug, c.names.en || c.slug);
    for (const c of customClusters) m.set(c.slug, c.names.en || c.slug);
    return m;
  }, [configClusters, customClusters]);

  // URL → assignment lookup (for cluster + lang + title).
  const assignmentByUrl = useMemo(() => {
    const m = new Map<string, PageClusterAssignment>();
    for (const a of assignments) m.set(a.url, a);
    return m;
  }, [assignments]);

  const rows = useMemo<PageRow[]>(() => {
    const rolled = rollPages(slices, window);

    // Start from the traffic rollup so hot pages lead; then union in
    // assigned-but-silent pages (pages the user has scraped + clustered
    // that haven't picked up signal yet). This gives the user a view
    // of "everything in this lang, ranked by score, traffic-first".
    const rows: PageRow[] = [];
    const seen = new Set<string>();

    for (const r of rolled) {
      const a = assignmentByUrl.get(r.url);
      if (!a) continue; // skip URLs with no cluster — not actionable here
      if (a.lang !== lang) continue;
      seen.add(r.url);
      rows.push({
        ...r,
        cluster: a.cluster,
        clusterLabel: clusterLabelBySlug.get(a.cluster) ?? a.cluster,
        lang: a.lang,
        title: a.title ?? "",
        path: pathOf(r.url),
      });
    }

    // Pages with a cluster assignment but no traffic yet — emit zero-rows.
    for (const a of assignments) {
      if (a.lang !== lang) continue;
      if (seen.has(a.url)) continue;
      rows.push({
        url: a.url,
        seo_clicks: 0,
        seo_impressions: 0,
        ga_sessions: 0,
        llm_sessions: 0,
        peec_citations: 0,
        sources: [],
        composite_score: 0,
        days_active: 0,
        first_seen: "",
        last_seen: "",
        cluster: a.cluster,
        clusterLabel: clusterLabelBySlug.get(a.cluster) ?? a.cluster,
        lang: a.lang,
        title: a.title ?? "",
        path: pathOf(a.url),
      });
    }

    return rows;
  }, [slices, window, assignments, assignmentByUrl, clusterLabelBySlug, lang]);

  return (
    <DataTable<PageRow>
      rows={rows}
      rowKey={(r) => r.url}
      columns={COLUMNS}
      defaultSort={{ key: "composite_score", dir: "desc" }}
      defaultPageSize={25}
      pageSizeOptions={[10, 25, 50, 100, "all"]}
      searchPlaceholder="Filter by URL, title, or cluster…"
      emptyLabel={
        assignments.length === 0
          ? "No scraped pages yet. Run the content pipeline from Settings → Data."
          : `No ${lang.toUpperCase()} pages match the current filter.`
      }
    />
  );
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

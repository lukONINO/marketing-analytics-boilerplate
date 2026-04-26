"use client";

/**
 * Topic Clusters table — bilingual cross-channel roll-up.
 *
 * Each row is a (cluster, lang) tuple. A single cluster like
 * "Whitelabel" renders as two rows (EN, DE) so SEO/GA metrics are
 * visible per language; Peec visibility + mentions are language-
 * agnostic (prompts mix languages).
 *
 * Columns shown: Cluster · SEO clicks · SEO imp. · GA views · AI viz
 * · Mentions · Pages · Days · 7d · Pattern. Avg words / Schema % /
 * Claims % were dropped on 2026-04-24 — per-cluster averages of those
 * signals were too noisy to be actionable; per-URL depth lives on
 * the Page view (ClusterPagesTable) and the visibility panel.
 *
 * Lang is a controlled prop driven by the parent (TopicsShell) so the
 * cluster + page views share a single language selection.
 *
 * Why the rollup lives in this Client Component:
 * DataTable columns carry function-valued render/accessor fields
 * which can't cross the RSC boundary. The page passes serializable
 * slices + trends + contentRollups; this component does the
 * windowed rollup and pattern classification.
 */

import { useMemo } from "react";
import clsx from "clsx";

import { useRouter } from "next/navigation";

import { DataTable, type Column } from "@/components/DataTable";
import { useTimeframe } from "@/components/TimeframeContext";
import { rollTopics } from "@/lib/rollup";
import {
  classifyPattern,
  PATTERN_PILL,
  type Pattern,
} from "@/lib/topic-patterns";
import type {
  ClusterContentRollup,
  CustomCluster,
  DailyTopicsSlice,
  HistoricalSnapshot,
  RolledTopic,
  TopicCluster,
} from "@/lib/types";

const COL_INFO = {
  cluster: <>The cluster slug. Bilingual — each cluster produces an EN row and a DE row with independent SEO/GA metrics. Peec visibility and mentions are the same for both lang rows (Peec prompts mix languages).</>,
  seoClicks: <>Clicks from Google organic search for this cluster&apos;s queries in this language, summed across the selected window.</>,
  seoImpressions: <>GSC impressions for this cluster&apos;s queries in this language, summed across the selected window.</>,
  gaViews: <>Page views on this cluster&apos;s URLs in this language, summed across the selected window.</>,
  geoVisibility: <>Peec visibility %: share of prompts in this cluster where your brand is mentioned. Same for EN + DE rows (Peec topic visibility is language-agnostic).</>,
  peecMentions: <>Raw count of brand mentions across Peec prompts + engines in this cluster, summed across the window.</>,
  pageCount: <>Number of scraped pages on your site assigned to this (cluster, lang) by scripts/assign_clusters.py.</>,
  sevenDay: <>7d-vs-prior-7d direction indicator on Peec mentions. Independent of the topbar window.</>,
  pattern: <>Cross-channel classification derived from window totals. Different patterns imply different actions.</>,
  days: <>How many days in the window the cluster&apos;s row had any signal.</>,
};

/** Rank 7d direction: up (favorable)=3, flat=2, down=1, none=0. */
function trendRankOf(trend: HistoricalSnapshot | undefined): number {
  if (!trend || !trend.direction) return 0;
  if (trend.direction === "down") return 1;
  if (trend.direction === "flat") return 2;
  return 3;
}

/** Row shape the table renders. */
interface ClusterRow extends RolledTopic {
  clusterKey: string;       // `${cluster}::${lang}` or fallback topic name
  pattern: Pattern;
  patternLabel: string;
  trend?: HistoricalSnapshot;
  trendRank: number;
  // Content-depth fields pulled in from page_clusters.json
  page_count: number;
  avg_word_count: number;
  schema_article_pct: number;
  pages_with_claims_pct: number;
}

const COLUMNS: Column<ClusterRow>[] = [
  {
    key: "topic",
    label: "Cluster",
    align: "left",
    info: COL_INFO.cluster,
    accessor: (r) => r.topic,
    sortDirOnFirstClick: "asc",
    render: (r) => <span className="font-medium">{r.topic}</span>,
  },
  {
    key: "seo_clicks",
    label: "SEO clicks",
    align: "right",
    info: COL_INFO.seoClicks,
    accessor: (r) => r.seo_clicks,
    render: (r) => (
      <span className={clsx("tabular-nums", r.seo_clicks === 0 && "text-ink-400")}>
        {r.seo_clicks}
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
      <span className={clsx("tabular-nums", r.seo_impressions === 0 && "text-ink-400")}>
        {r.seo_impressions}
      </span>
    ),
  },
  {
    key: "ga_views",
    label: "GA views",
    align: "right",
    info: COL_INFO.gaViews,
    accessor: (r) => r.ga_views,
    render: (r) => (
      <span className={clsx("tabular-nums", r.ga_views === 0 && "text-ink-400")}>
        {r.ga_views}
      </span>
    ),
  },
  {
    key: "geo_visibility",
    label: "AI viz",
    align: "right",
    info: COL_INFO.geoVisibility,
    accessor: (r) => r.geo_visibility,
    render: (r) => {
      const v = r.geo_visibility;
      return (
        <span className={clsx("tabular-nums", v === 0 && "text-ink-400")}>
          {Math.round(v * 100)}%
        </span>
      );
    },
  },
  {
    key: "geo_mentions",
    label: "Mentions",
    align: "right",
    info: COL_INFO.peecMentions,
    accessor: (r) => r.geo_mentions,
    render: (r) => (
      <span className={clsx("tabular-nums", r.geo_mentions === 0 && "text-ink-400")}>
        {r.geo_mentions}
      </span>
    ),
  },
  {
    key: "page_count",
    label: "Pages",
    align: "right",
    info: COL_INFO.pageCount,
    accessor: (r) => r.page_count,
    render: (r) => (
      <span className={clsx("tabular-nums", r.page_count === 0 && "text-ink-400")}>
        {r.page_count}
      </span>
    ),
  },
  // NOTE: Avg words, Schema %, and Claims % columns were removed on
  // 2026-04-24. Per-cluster averages of those signals proved too noisy
  // to be actionable at this level — users look at them per-page when
  // deciding what to fix. Switch to the "Pages" view for URL-level
  // content depth. The fields are still computed in
  // page_clusters.json.by_cluster — just not surfaced here.
  {
    key: "days_active",
    label: "Days",
    align: "right",
    info: COL_INFO.days,
    accessor: (r) => r.days_active,
    render: (r) => <span className="tabular-nums text-ink-600">{r.days_active}</span>,
  },
  {
    key: "trend",
    label: "7d",
    align: "center",
    info: COL_INFO.sevenDay,
    accessor: (r) => r.trendRank,
    sortDirOnFirstClick: "desc",
    render: (r) => <TrendIndicator trend={r.trend} />,
  },
  {
    key: "pattern",
    label: "Pattern",
    align: "left",
    info: COL_INFO.pattern,
    accessor: (r) => r.patternLabel,
    sortDirOnFirstClick: "asc",
    render: (r) => {
      const p = PATTERN_PILL[r.pattern];
      return (
        <span className={clsx("text-xs px-2 py-0.5 rounded", p.cls)}>{p.label}</span>
      );
    },
  },
];

function TrendIndicator({ trend }: { trend?: HistoricalSnapshot }) {
  if (!trend || !trend.direction) return <span className="text-ink-400">—</span>;
  if (trend.direction === "up")   return <span className="text-emerald-600" title="7d avg up vs prior 7d">↑</span>;
  if (trend.direction === "down") return <span className="text-red-600"     title="7d avg down vs prior 7d">↓</span>;
  return <span className="text-ink-500" title="flat (±5%)">→</span>;
}

export interface TopicClustersTableProps {
  slices: DailyTopicsSlice[];
  trends: Record<string, HistoricalSnapshot>;
  /** Key format: `<cluster>::<lang>` — mirrors the Python rollup. */
  contentRollups: Record<string, ClusterContentRollup>;
  /** Config clusters from topic_clusters.yaml. */
  configClusters: TopicCluster[];
  /** User-created clusters from data/dashboard/custom_clusters.json. */
  customClusters: CustomCluster[];
  /**
   * Active language tab — controlled by the parent (TopicsShell) so the
   * Cluster and Page views share a single lang selection. Tabs + counts
   * are rendered one level up.
   */
  lang: "en" | "de";
}

export function TopicClustersTable({
  slices,
  trends,
  contentRollups,
  configClusters,
  customClusters,
  lang,
}: TopicClustersTableProps) {
  const { window } = useTimeframe();
  const router = useRouter();

  const allRows = useMemo<ClusterRow[]>(() => {
    const rolled = rollTopics(slices, window);
    // Annotate the map callback return as ClusterRow so the optional
    // `trend?` is preserved on the array's element type. Otherwise TS
    // infers `trend: HistoricalSnapshot` (non-optional) from the literal
    // and rejects the synthetic rows below — which legitimately have no
    // trend data — at the rows.push() call.
    const rows: ClusterRow[] = rolled.map((t): ClusterRow => {
      const key =
        t.cluster && t.lang ? `${t.cluster}::${t.lang}` : t.topic;
      const pattern = classifyPattern(t);
      // Trends may still be keyed by topic display name (pre-migration),
      // so fall back to that when there's no cluster-keyed match.
      const trend = trends[key] ?? trends[t.topic];
      const content = contentRollups[key] ?? {
        page_count: 0,
        avg_word_count: 0,
        schema_article_pct: 0,
        pages_with_claims_pct: 0,
        pages_missing_meta_pct: 0,
        pages_missing_h1_pct: 0,
        thin_pages_pct: 0,
      };
      // Conditional spread for trend — `exactOptionalPropertyTypes`
      // rejects an explicit `trend: undefined` against `trend?:`.
      return {
        ...t,
        clusterKey: key,
        pattern,
        patternLabel: PATTERN_PILL[pattern].label,
        trendRank: trendRankOf(trend),
        page_count: content.page_count,
        avg_word_count: content.avg_word_count,
        schema_article_pct: content.schema_article_pct,
        pages_with_claims_pct: content.pages_with_claims_pct,
        ...(trend !== undefined ? { trend } : {}),
      };
    });

    // Inject synthetic rows for every (cluster × lang) pair the table
    // could possibly need: both config clusters and custom ones. Without
    // this, a cluster with no Peec prompts yet (e.g. a freshly created
    // custom cluster, or one with no Peec topics yet wired) is completely
    // invisible — defeating the purpose of letting the user move pages
    // into it. Real Peec-derived rows from `rolled` take precedence;
    // synthetic rows only fill the gaps.
    const seen = new Set(rows.map((r) => r.clusterKey));
    const allClusterDefs: { slug: string; names: { en: string; de: string } }[] = [
      ...configClusters.map((c) => ({ slug: c.slug, names: c.names })),
      ...customClusters.map((c) => ({ slug: c.slug, names: c.names })),
    ];
    for (const c of allClusterDefs) {
      for (const langKey of ["en", "de"] as const) {
        const key = `${c.slug}::${langKey}`;
        if (seen.has(key)) continue;
        const content = contentRollups[key] ?? {
          page_count: 0,
          avg_word_count: 0,
          schema_article_pct: 0,
          pages_with_claims_pct: 0,
          pages_missing_meta_pct: 0,
          pages_missing_h1_pct: 0,
          thin_pages_pct: 0,
        };
        const blank: RolledTopic = {
          topic: c.names[langKey] || c.slug,
          cluster: c.slug,
          lang: langKey,
          seo_clicks: 0,
          seo_impressions: 0,
          ga_views: 0,
          geo_visibility: 0,
          geo_mentions: 0,
          peec_topic_ids: [],
          days_active: 0,
        };
        const pattern = classifyPattern(blank);
        rows.push({
          ...blank,
          clusterKey: key,
          pattern,
          patternLabel: PATTERN_PILL[pattern].label,
          // trend omitted — `trend?: HistoricalSnapshot` is optional, and
          // `exactOptionalPropertyTypes` doesn't accept an explicit
          // `trend: undefined`. trendRank stays 0 → row sorts to bottom.
          trendRank: 0,
          page_count: content.page_count,
          avg_word_count: content.avg_word_count,
          schema_article_pct: content.schema_article_pct,
          pages_with_claims_pct: content.pages_with_claims_pct,
        });
      }
    }
    return rows;
  }, [slices, window, trends, contentRollups, configClusters, customClusters]);

  // Drop pre-migration rows (those without cluster + lang) — they come
  // from daily files written before the bilingual cluster config and no
  // longer belong to the current taxonomy. Without this filter, old
  // topic names from the legacy taxonomy leak through as ghost rows
  // alongside the new cluster names. Re-running
  // `python scripts/aggregate_daily.py` replaces them with rows that
  // carry cluster + lang.
  const migratedRows = useMemo(
    () => allRows.filter((r) => !!r.cluster && !!r.lang),
    [allRows],
  );

  const rows = useMemo(
    () => migratedRows.filter((r) => r.lang === lang),
    [migratedRows, lang],
  );

  return (
    <DataTable<ClusterRow>
      rows={rows}
      rowKey={(r) => r.clusterKey}
      columns={COLUMNS}
      defaultSort={{ key: "geo_mentions", dir: "desc" }}
      defaultPageSize={25}
      pageSizeOptions={[10, 25, 50, "all"]}
      searchPlaceholder="Filter by cluster or pattern…"
      emptyLabel={
        slices.length === 0
          ? "No daily data yet. Click Refresh data in the topbar."
          : `No clusters in ${lang.toUpperCase()} match the current filter.`
      }
      onRowClick={(row) => {
        if (!row.cluster) return;
        // Navigate to the cluster's dedicated overview page. The
        // overview owns its own lang tabs; we don't pass lang via
        // query string — it'd lock the user into the table's active
        // tab when they might want to toggle once they land.
        router.push(`/topics/${row.cluster}`);
      }}
    />
  );
}

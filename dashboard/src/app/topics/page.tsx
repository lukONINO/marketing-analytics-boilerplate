import Link from "next/link";

import { DataRefreshGuide } from "@/components/DataRefreshGuide";
import { SiteAnalytics } from "@/components/SiteAnalytics";
import { computeSiteAnalytics, rankClusters } from "@/lib/analytics";
import {
  applyClusterOverrides,
  loadClusterOverrides,
  loadCustomClusters,
  loadDailyAggregates,
  loadDailyTopicsSlices,
  loadGeoDebug,
  loadLatestDaily,
  loadPageClusters,
  loadReadinessExtras,
  loadSourceGaps,
  loadTopicClusters,
} from "@/lib/data";
import { computeReadiness } from "@/lib/framework";
import { rollTopics } from "@/lib/rollup";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;

/**
 * Topic Clusters — site-level analytics dashboard.
 *
 * Top of a three-level drill: site → cluster → individual page. Read-only.
 * All cluster + page setup actions live in /settings/clusters and are
 * called out via the "Manage clusters" link in the header.
 */
export default async function TopicClustersPage() {
  const [
    geoDebug,
    topicSlices,
    pageClusters,
    overridesFile,
    configClusters,
    customClustersFile,
    latestDailyTuple,
    recentDailies,
    sourceGaps,
    readinessExtras,
  ] = await Promise.all([
    loadGeoDebug(),
    loadDailyTopicsSlices(WINDOW_DAYS),
    loadPageClusters(),
    loadClusterOverrides(),
    loadTopicClusters(),
    loadCustomClusters(),
    loadLatestDaily(),
    loadDailyAggregates(7), // 7-day window for impression-weighted avg position
    loadSourceGaps(),
    loadReadinessExtras(),
  ]);

  const assignments = applyClusterOverrides(
    pageClusters?.assignments ?? [],
    overridesFile.overrides,
  );
  const allClusters = [
    ...configClusters.map((c) => ({ slug: c.slug, names: c.names })),
    ...customClustersFile.clusters.map((c) => ({ slug: c.slug, names: c.names })),
  ];

  const rolled = rollTopics(topicSlices, WINDOW_DAYS);
  const analytics = computeSiteAnalytics(
    geoDebug,
    topicSlices,
    WINDOW_DAYS,
    latestDailyTuple ? latestDailyTuple[1] : null,
    recentDailies.map(([, payload]) => payload),
  );

  // Build a cluster-slug → average-readiness-composite map by averaging
  // EN + DE readiness scores per cluster. This gives `rankClusters` the
  // input it needs to compute cross-layer diagnostic patterns
  // (audit fix #21 / E2). We average across language because the
  // ranking surface shows one row per cluster, not per (cluster, lang).
  const readinessScores = computeReadiness(
    pageClusters,
    sourceGaps,
    configClusters,
    customClustersFile.clusters,
    assignments,
    readinessExtras,
  );
  const readinessByCluster = new Map<string, number>();
  const readinessAccum = new Map<string, { sum: number; count: number }>();
  for (const r of readinessScores) {
    if (r.measured_dimensions === 0) continue;
    const acc = readinessAccum.get(r.cluster) ?? { sum: 0, count: 0 };
    acc.sum += r.composite;
    acc.count += 1;
    readinessAccum.set(r.cluster, acc);
  }
  for (const [slug, acc] of readinessAccum) {
    readinessByCluster.set(slug, acc.sum / acc.count);
  }

  const ranking = rankClusters(
    geoDebug,
    rolled,
    assignments,
    allClusters,
    readinessByCluster,
  );

  return (
    <>
      <DataRefreshGuide
        pageKey="topics"
        summary="Cluster traffic + AI visibility metrics on this page come from daily aggregates of GSC, GA4, LLM-traffic, and Peec MCP data. Three different actions update three different layers — open below for the full list."
        actions={[
          {
            label: "Refresh organic search + GA4 traffic",
            description: "Pulls the latest GSC clicks, GA4 sessions, and LLM-referrer data for the freshness window. Skips dates already on disk.",
            kind: "topbar",
            topbar_path: "Refresh data → Load latest only",
          },
          {
            label: "Refresh AI visibility (Peec)",
            description: "Peec MCP runs Claude-side, so the dashboard's Refresh button doesn't cover it. Pull, then re-aggregate to fold the new data into processed dailies.",
            kind: "claude",
            prompt: "pull peec data for the latest day",
          },
          {
            label: "Re-aggregate after a Peec pull",
            description: "Click Refresh data → Re-aggregate last 7 days in the topbar. Fast (~5s); only the aggregator runs.",
            kind: "topbar",
            topbar_path: "Refresh data → Re-aggregate last 7 days",
          },
          {
            label: "Re-scrape site content",
            description: "Updates the page list assigned to each cluster (word counts, schema, claims). Run from Settings → Data when pages change materially.",
            kind: "topbar",
            topbar_path: "Settings → Data → Re-scrape",
          },
        ]}
      />
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <span className="inline-block text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-700 bg-accent-50 px-2 py-0.5 rounded-md ring-1 ring-inset ring-accent-200 mb-2">
            Topic Clusters
          </span>
          <h1 className="font-display text-[28px] md:text-[32px] font-bold tracking-tight text-ink-900">
            Cluster analytics
          </h1>
          <p className="text-sm text-ink-600 mt-2 max-w-3xl leading-relaxed">
            How every topic cluster on your site is performing across AI search
            and Google search. Click any cluster row to drill into its detail,
            then click a page row to drill again to the individual URL. All
            three levels share the same KPIs and funnel-stage breakdown so you
            can compare like-for-like.
          </p>
        </div>
        <Link
          href="/settings/clusters"
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium rounded-lg border border-hairline text-ink-700 bg-surface hover:border-primary-400 hover:text-primary-700 hover:shadow-card transition-all shrink-0"
        >
          Manage clusters &amp; pages
          <span aria-hidden>→</span>
        </Link>
      </div>

      <SiteAnalytics analytics={analytics} ranking={ranking} />
    </>
  );
}

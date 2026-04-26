import Link from "next/link";
import { notFound } from "next/navigation";

import { ClusterAnalytics } from "@/components/ClusterAnalytics";
import { ClusterFixList } from "@/components/ClusterFixList";
import { ClusterWork } from "@/components/ClusterWork";
import { computeClusterAnalytics } from "@/lib/analytics";
import { buildClusterFixList } from "@/lib/cluster-fixes";
import {
  applyClusterOverrides,
  loadClusterOverrides,
  loadCustomClusters,
  loadDailyTopicsSlices,
  loadGeoDebug,
  loadInsights,
  loadPageClusters,
  loadReadinessExtras,
  loadSourceGaps,
  loadTasks,
  loadTopicClusters,
  loadVisibilityImprovements,
} from "@/lib/data";
import { computeReadiness } from "@/lib/framework";
import { rollTopics } from "@/lib/rollup";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;

/**
 * Cluster analytics — /topics/[slug]
 *
 * Middle of the topic-cluster drill: site → cluster → page. Shows AI
 * + SEO performance scoped to one cluster, the funnel-stage breakdown,
 * the prompts in this cluster, and the pages assigned to it.
 *
 * READ-ONLY. All editing actions (re-assign pages, change language,
 * remove cluster) live in /settings/clusters.
 */
export default async function ClusterAnalyticsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [
    configClusters,
    customClustersFile,
    pageClusters,
    overridesFile,
    geoDebug,
    topicSlices,
    sourceGaps,
    visibilityImprovements,
    readinessExtras,
    tasksFile,
    insightsFile,
  ] = await Promise.all([
    loadTopicClusters(),
    loadCustomClusters(),
    loadPageClusters(),
    loadClusterOverrides(),
    loadGeoDebug(),
    loadDailyTopicsSlices(WINDOW_DAYS),
    loadSourceGaps(),
    loadVisibilityImprovements(),
    loadReadinessExtras(),
    loadTasks(),
    loadInsights(),
  ]);

  const configHit = configClusters.find((c) => c.slug === slug);
  const customHit = customClustersFile.clusters.find((c) => c.slug === slug);
  if (!configHit && !customHit) notFound();

  const names = configHit
    ? configHit.names
    : customHit
      ? customHit.names
      : { en: slug, de: slug };

  const allAssignments = applyClusterOverrides(
    pageClusters?.assignments ?? [],
    overridesFile.overrides,
  );

  const rolled = rollTopics(topicSlices, WINDOW_DAYS);
  const analytics = computeClusterAnalytics(
    slug,
    names.en,
    geoDebug,
    rolled,
    allAssignments,
  );

  // Readiness — the 4 measured dimensions for this cluster (en + de
  // rows). The full computeReadiness emits one row per (cluster, lang);
  // we filter to just this cluster and let the panel average across
  // languages so the user sees one number per dimension. Replaces the
  // heatmap that used to live on /insights → /strategy.
  const allReadiness = computeReadiness(
    pageClusters,
    sourceGaps,
    configHit ? [configHit] : [],
    customHit ? [customHit] : [],
    allAssignments,
    readinessExtras,
  );
  const clusterReadiness = allReadiness.filter((r) => r.cluster === slug);

  // Build the per-cluster "Things to fix" list — combines on-page
  // visibility opportunities (rule-computed) and outreach gaps
  // (third-party domains AI cites where your brand is absent). Replaces
  // the dedicated /insights panels for those data sources, scoped
  // to one cluster at a time.
  const clusterOpportunities = (visibilityImprovements?.opportunities ?? [])
    .filter((o) => o.cluster === slug);
  const sourceGapEn = sourceGaps?.by_cluster?.[slug]?.en?.top_cited_domains ?? [];
  const sourceGapDe = sourceGaps?.by_cluster?.[slug]?.de?.top_cited_domains ?? [];
  // Merge en + de domain lists, dedupe by domain, prefer the higher
  // citation count. We don't lang-split the fix list because outreach
  // is per-domain, not per-language (G2 is G2 regardless of which
  // language the prompts were in).
  const mergedDomains = mergeDomainLists(sourceGapEn, sourceGapDe);
  const clusterFixes = buildClusterFixList({
    cluster: slug,
    opportunities: clusterOpportunities,
    topCitedDomains: mergedDomains,
  });

  // ---- Cluster-tagged tasks + insights ----
  // Surface every persisted task tagged with this cluster slug, plus
  // every Claude insight that mentions the cluster slug in its tags.
  // Tasks added before the `cluster` field existed get matched by
  // text-search fallback (description / source_report / title contain
  // the slug or the display name) so historical tasks aren't orphaned.
  const clusterTasks = (tasksFile.tasks ?? []).filter((t) => {
    if (t.cluster === slug) return true;
    const haystack = `${t.title} ${t.description ?? ""} ${t.source_report ?? ""}`.toLowerCase();
    return haystack.includes(slug.toLowerCase()) || haystack.includes(names.en.toLowerCase());
  });
  const clusterInsights = (insightsFile.insights ?? []).filter((i) =>
    (i.tags ?? []).includes(slug),
  );

  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <span className="inline-block text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-700 bg-accent-50 px-2 py-0.5 rounded-md ring-1 ring-inset ring-accent-200 mb-2">
            Cluster
          </span>
          <h1 className="font-display text-[28px] md:text-[32px] font-bold tracking-tight text-ink-900">
            {names.en}
          </h1>
          {names.de && names.de !== names.en && (
            <p className="text-sm text-ink-500 mt-1 italic">
              {names.de}{" "}
              <span className="text-ink-400">· German</span>
            </p>
          )}
          <p className="text-sm text-ink-600 mt-2 max-w-2xl leading-relaxed">
            How this cluster performs across AI search and Google search,
            broken down by funnel stage. Click any page below to drill into
            the individual URL&apos;s analytics.
          </p>
        </div>
        <Link
          href="/settings/clusters"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-hairline text-ink-700 bg-surface hover:border-primary-400 hover:text-primary-700 transition-all shrink-0"
        >
          Manage cluster &amp; pages →
        </Link>
      </div>

      <ClusterAnalytics analytics={analytics} readiness={clusterReadiness} />

      {/* Open work for this cluster — every persisted task + relevant
          insight tagged or text-matched to this cluster. Two-class
          model: every row is a Task (with copyable Claude prompt) or
          an Insight. Tasks come from /tasks; insights come from the
          findings archive — both filtered server-side. */}
      <div className="mt-8">
        <ClusterWork
          clusterSlug={slug}
          clusterDisplay={names.en}
          tasks={clusterTasks}
          insights={clusterInsights}
        />
      </div>

      {/* "Things to fix" — auto-derived task suggestions from the
          rule pipeline + outreach gaps for this cluster. These are
          ephemeral (re-derived every render); promote any of them to
          a persisted task to track work over time. Findings (Claude-
          written insights) are site-wide context, so the "View all
          findings" footer link is hidden here. */}
      <div className="mt-8">
        <ClusterFixList fixes={clusterFixes} showFindingsLink={false} />
      </div>
    </>
  );
}

/**
 * Merge EN + DE source-gap domain lists into one. Dedupe by domain
 * keeping the higher citation count, and union the example_prompts
 * arrays so we don't lose context.
 */
function mergeDomainLists<
  T extends {
    domain: string;
    times_cited: number;
    onino_co_cited_count: number;
    onino_co_cited_pct: number;
    first_seen: string | null;
    example_prompts: string[];
  },
>(en: T[], de: T[]): T[] {
  const map = new Map<string, T>();
  for (const d of [...en, ...de]) {
    const existing = map.get(d.domain);
    if (!existing || d.times_cited > existing.times_cited) {
      map.set(d.domain, d);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.times_cited - a.times_cited);
}

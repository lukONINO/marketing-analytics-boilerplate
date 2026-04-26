import Link from "next/link";
import { notFound } from "next/navigation";

import { PageAnalytics } from "@/components/PageAnalytics";
import { computePageAnalytics } from "@/lib/analytics";
import {
  applyClusterOverrides,
  loadClusterOverrides,
  loadCustomClusters,
  loadDailyAggregates,
  loadGeoDebug,
  loadPageClusters,
  loadTopicClusters,
} from "@/lib/data";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;

/**
 * Page-level analytics — bottom of the topic-cluster drill.
 *
 * Route: /topics/[slug]/page/[...path]
 *   - `slug` is the cluster slug
 *   - `path` is the URL pathname segments, URL-encoded
 *
 * Example: /topics/whitelabel/page/blog/example-platform-comparison
 *   reconstructs to https://acme.io/blog/example-platform-comparison
 *
 * The cluster slug is preserved in the URL so the back-link to the
 * cluster's analytics works without a separate lookup, and so a
 * page that's been re-assigned still resolves cleanly.
 */
export default async function PageAnalyticsRoute({
  params,
}: {
  params: Promise<{ slug: string; path: string[] }>;
}) {
  const { slug, path } = await params;

  // Reconstruct the full URL from the route segments. Resolves against
  // your canonical origin — the dashboard only tracks one domain.
  // Set SITE_CANONICAL_ORIGIN in your env (e.g. https://acme.io) to
  // override the default placeholder.
  const decoded = path.map((s) => decodeURIComponent(s));
  const origin = (process.env.SITE_CANONICAL_ORIGIN || "https://acme.io").replace(/\/$/, "");
  const url = `${origin}/${decoded.join("/")}`;

  const [
    pageClusters,
    overridesFile,
    geoDebug,
    dailies,
    configClusters,
    customClustersFile,
  ] = await Promise.all([
    loadPageClusters(),
    loadClusterOverrides(),
    loadGeoDebug(),
    loadDailyAggregates(WINDOW_DAYS),
    loadTopicClusters(),
    loadCustomClusters(),
  ]);

  const allAssignments = applyClusterOverrides(
    pageClusters?.assignments ?? [],
    overridesFile.overrides,
  );
  const page = allAssignments.find((a) => a.url === url);
  if (!page) notFound();

  // Cluster display name — try config first, then custom.
  const configHit = configClusters.find((c) => c.slug === slug);
  const customHit = customClustersFile.clusters.find((c) => c.slug === slug);
  const clusterDisplay = configHit?.names.en ?? customHit?.names.en ?? slug;

  const analytics = computePageAnalytics(url, page, dailies);

  // Related prompts: same cluster + same lang. Filter from geo_debug.
  const relatedPrompts = geoDebug.prompts.filter(
    (p) => p.cluster === page.cluster && p.lang === page.lang,
  );

  // Display title: page title falls back to last URL segment
  const lastSegment = decoded[decoded.length - 1] ?? "Page";
  const displayTitle = page.title || lastSegment;

  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <span className="inline-block text-[10px] font-semibold uppercase tracking-[0.18em] text-secondary-600 bg-secondary-50 px-2 py-0.5 rounded-md ring-1 ring-inset ring-secondary-100 mb-2">
            Page
          </span>
          <h1 className="font-display text-[24px] md:text-[28px] font-bold tracking-tight text-ink-900 leading-snug">
            {displayTitle}
          </h1>
          <p className="text-sm text-ink-500 mt-1.5 flex items-center gap-2 flex-wrap">
            <Link
              href={`/topics/${slug}`}
              className="text-primary-700 hover:text-primary-900 underline decoration-dotted underline-offset-2"
            >
              {clusterDisplay}
            </Link>
            <span className="text-ink-300" aria-hidden>·</span>
            <span className="uppercase tracking-wider text-[10px] font-semibold">{page.lang}</span>
          </p>
        </div>
        <Link
          href={`/topics/${slug}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-hairline text-ink-700 bg-surface hover:border-primary-400 hover:text-primary-700 transition-all shrink-0"
        >
          ← All pages in cluster
        </Link>
      </div>

      <PageAnalytics analytics={analytics} relatedPrompts={relatedPrompts} />
    </>
  );
}

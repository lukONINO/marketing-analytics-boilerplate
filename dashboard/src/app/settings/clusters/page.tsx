import { ClusterSetupShell } from "@/components/ClusterSetupShell";
import {
  applyClusterOverrides,
  loadClusterOverrides,
  loadCustomClusters,
  loadPageClusters,
  loadTopicClusters,
} from "@/lib/data";

export const dynamic = "force-dynamic";

/**
 * Settings → Clusters.
 *
 * The single home for all cluster + page setup. Replaces the old
 * "Website pages" settings page and pulls page-management actions out
 * of the analytics surface at /topics. The /topics tree is now
 * read-only analytics; everything that *changes* the model lives here.
 *
 * What you can do here:
 *   - See every topic cluster with its page count per language
 *   - Create a new custom cluster
 *   - Move a page between clusters (auto-pairs translations via hreflang)
 *   - Switch a page's language
 *   - Remove a custom cluster
 */
export default async function SettingsClustersPage() {
  const [pageClusters, configClusters, customClustersFile, overridesFile] =
    await Promise.all([
      loadPageClusters(),
      loadTopicClusters(),
      loadCustomClusters(),
      loadClusterOverrides(),
    ]);

  const assignments = applyClusterOverrides(
    pageClusters?.assignments ?? [],
    overridesFile.overrides,
  );

  return (
    <>
      <header className="mb-8">
        <span className="inline-block text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-700 bg-primary-50 px-2 py-0.5 rounded-md ring-1 ring-inset ring-primary-200 mb-2">
          Settings
        </span>
        <h1 className="font-display text-[28px] md:text-[32px] font-bold text-ink-900 tracking-tight">
          Clusters &amp; page assignments
        </h1>
        <p className="text-sm text-ink-600 mt-2 max-w-3xl leading-relaxed">
          {assignments.length > 0 ? (
            <>
              <strong className="text-ink-900 tabular-nums">
                {assignments.length}
              </strong>{" "}
              scraped URLs, organised across{" "}
              <strong className="text-ink-900 tabular-nums">
                {configClusters.length + customClustersFile.clusters.length}
              </strong>{" "}
              topic clusters. This is the only place to{" "}
              <strong className="text-ink-900">create</strong> a cluster or{" "}
              <strong className="text-ink-900">move</strong> a page —
              the Topic Clusters analytics view at{" "}
              <code className="text-primary-700 bg-surface-muted border border-hairline px-1 py-0.5 rounded font-mono text-[11px]">
                /topics
              </code>{" "}
              is read-only.
            </>
          ) : (
            <>
              No scraped pages yet. Run the content pipeline from{" "}
              <strong className="text-ink-900">
                Settings → Data
              </strong>{" "}
              first — once assignments exist they&apos;ll appear here.
            </>
          )}
        </p>
      </header>

      <ClusterSetupShell
        assignments={assignments}
        configClusters={configClusters}
        customClusters={customClustersFile.clusters}
        overrideCount={overridesFile.overrides.length}
      />
    </>
  );
}

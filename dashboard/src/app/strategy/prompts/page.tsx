import Link from "next/link";

import { DataRefreshGuide } from "@/components/DataRefreshGuide";
import { PromptsView } from "@/components/PromptsView";
import {
  loadCustomClusters,
  loadGeoDebug,
  loadLatestPeecTags,
  loadPromptIssueDismissals,
  loadTopicClusters,
} from "@/lib/data";
import {
  computePromptIssues,
  computePromptsHealthSummary,
} from "@/lib/prompts-improvements";

export const dynamic = "force-dynamic";

/**
 * /strategy/prompts — Prompt Improvements page.
 *
 * The Peec prompt set is the most expensive-to-curate input in the
 * pipeline. Bad prompts (branded contamination, missing tags,
 * unmapped clusters, malformed phrasing) silently distort every
 * downstream metric on the dashboard. This page is where the user
 * audits and fixes the prompt set itself.
 *
 * Surfaces (PromptsView handles layout):
 *   1. Quick stats              — health-of-set summary tiles
 *   2. 4-state distribution     — Malte A/B/C/D site-wide breakdown
 *   3. Suggested changes        — every detected issue with copy-prompt
 *                                 + Dismiss action when fixed in Peec
 *   4. All tracked prompts      — filterable table; row-click opens drawer
 *
 * Mostly read-only: prompt / tag mutations happen in Peec via the
 * copied Claude prompt. Two writes the dashboard does itself:
 *   - Issue dismissals → `data/dashboard/prompt_issue_dismissals.json`
 *     so a row stays cleared after the user fixes it directly in Peec,
 *     even across geo-debug pulls that still detect the same issue.
 *   - The "Restore" action removes a dismissal record — same file.
 */
export default async function PromptsPage() {
  const [
    geoDebug,
    peecTags,
    configClusters,
    customClustersFile,
    dismissalsFile,
  ] = await Promise.all([
    loadGeoDebug(),
    loadLatestPeecTags(),
    loadTopicClusters(),
    loadCustomClusters(),
    loadPromptIssueDismissals(),
  ]);

  // Build the set of cluster slugs the dashboard knows about — used
  // by the unmapped-cluster detector to flag prompts whose topic_id
  // points to a slug not in our config.
  const knownClusterSlugs = new Set<string>();
  for (const c of configClusters) knownClusterSlugs.add(c.slug);
  for (const c of customClustersFile.clusters) knownClusterSlugs.add(c.slug);

  // Cluster slug → display label, used by the table + filters.
  const labelByCluster: Record<string, string> = {};
  for (const c of configClusters) labelByCluster[c.slug] = c.names.en;
  for (const c of customClustersFile.clusters) labelByCluster[c.slug] = c.names.en;

  const issues = computePromptIssues(geoDebug, peecTags, knownClusterSlugs);
  // The summary still counts every detected issue (dismissed or not)
  // so the "With issues" tile reflects the real-world prompt-set
  // hygiene rather than what the user has chosen to hide.
  const summary = computePromptsHealthSummary(geoDebug, issues);
  const prompts = geoDebug?.prompts ?? [];

  // Pass the dismissed-id set down so PromptsView can hide rows by
  // default and offer a "Show dismissed" toggle to bring them back
  // with a Restore button.
  const dismissedIds = dismissalsFile.dismissals.map((d) => d.id);

  return (
    <>
      <DataRefreshGuide
        pageKey="prompts"
        summary="Prompt-set health depends on what Peec has on disk. Run the actions below in order to refresh the underlying classification + tag context."
        actions={[
          {
            label: "Refresh AI visibility (Peec)",
            description: "Pulls the latest Peec context (tags, prompts, classifications). Required before issue detection reflects any changes you make in the Peec project.",
            kind: "claude",
            prompt: "pull peec data for the latest day",
          },
          {
            label: "Re-run AI Citation Health (4-state)",
            description: "Recomputes per-prompt 4-state classification + funnel-stage derivation from the latest Peec data.",
            kind: "claude",
            prompt: "run geo debug",
          },
          {
            label: "Apply prompt fixes (per-row)",
            description: "Click any issue row → drawer → 'Copy Claude prompt'. Paste into Claude to re-tag / rephrase / retire.",
            kind: "claude",
            prompt: "(per-row, copied from the drawer)",
          },
        ]}
      />

      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <span className="inline-block text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-700 bg-primary-50 px-2 py-0.5 rounded-md ring-1 ring-inset ring-primary-200 mb-2">
            Strategy
          </span>
          <h1 className="font-display text-[28px] md:text-[32px] font-bold tracking-tight text-ink-900">
            Prompt improvements
          </h1>
          <p className="text-sm text-ink-600 mt-2 max-w-3xl leading-relaxed">
            Every Peec-tracked prompt with its cluster, funnel stage, and
            performance — plus a list of detected issues (branded
            contamination, missing tags, unmapped clusters, stale state-D)
            and the Claude prompt to fix each one. The Peec prompt set is
            the input that distorts every other metric when it&apos;s wrong.
          </p>
        </div>
        <Link
          href="/strategy"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-hairline text-ink-700 bg-surface hover:border-primary-400 hover:text-primary-700 transition-all shrink-0"
        >
          ← Back to Strategy
        </Link>
      </div>

      {prompts.length === 0 ? (
        <section className="bg-warning-50 border border-warning/25 rounded-2xl p-8 text-center shadow-card">
          <p className="text-ink-900 font-semibold">No prompt data yet.</p>
          <p className="text-ink-600 text-sm mt-2 leading-relaxed max-w-xl mx-auto">
            Ask Claude{" "}
            <code className="bg-surface-muted border border-hairline text-primary-700 px-1.5 py-0.5 rounded font-mono text-[12px]">
              run geo debug
            </code>{" "}
            to populate the per-prompt classification, then refresh this page.
          </p>
        </section>
      ) : (
        <PromptsView
          prompts={prompts}
          issues={issues}
          summary={summary}
          labelByCluster={labelByCluster}
          initialDismissedIds={dismissedIds}
        />
      )}
    </>
  );
}

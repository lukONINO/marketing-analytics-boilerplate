"use client";

/**
 * Cluster + page setup shell — the single editing surface.
 *
 * Composes:
 *   - Header action bar with "+ New cluster"
 *   - <WebsitePagesManager> for the per-page table + cluster coverage strip
 *   - <NewClusterDialog> for creating a custom cluster
 *
 * The Topic Clusters analytics page (/topics tree) used to host these
 * actions inline. Pulling them out keeps that surface read-only and
 * gives the user one place to find every "edit cluster setup" affordance.
 */

import { useMemo, useState } from "react";

import { NewClusterDialog } from "@/components/NewClusterDialog";
import { WebsitePagesManager } from "@/components/WebsitePagesManager";
import type {
  CustomCluster,
  PageClusterAssignment,
  TopicCluster,
} from "@/lib/types";

export interface ClusterSetupShellProps {
  assignments: PageClusterAssignment[];
  configClusters: TopicCluster[];
  customClusters: CustomCluster[];
  overrideCount: number;
}

export function ClusterSetupShell({
  assignments,
  configClusters,
  customClusters,
  overrideCount,
}: ClusterSetupShellProps) {
  const [newClusterOpen, setNewClusterOpen] = useState(false);

  const existingSlugs = useMemo(
    () => [
      ...configClusters.map((c) => c.slug),
      ...customClusters.map((c) => c.slug),
    ],
    [configClusters, customClusters],
  );

  return (
    <>
      {/* Action bar — separates editing affordances from the data view below */}
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div className="text-xs text-ink-500">
          {customClusters.length > 0 ? (
            <>
              <strong className="text-ink-700">{customClusters.length}</strong>{" "}
              custom cluster{customClusters.length === 1 ? "" : "s"} ·{" "}
              <strong className="text-ink-700">{configClusters.length}</strong>{" "}
              from cluster config
            </>
          ) : (
            <>
              <strong className="text-ink-700">{configClusters.length}</strong>{" "}
              clusters from{" "}
              <code className="text-primary-700 bg-surface-muted border border-hairline px-1 py-0.5 rounded font-mono text-[11px]">
                config/topic_clusters.yaml
              </code>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setNewClusterOpen(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium rounded-lg bg-gradient-to-b from-primary-600 to-primary-700 text-white hover:from-primary-700 hover:to-primary-800 shadow-card hover:shadow-card-hover active:translate-y-[0.5px] transition-all"
        >
          <span aria-hidden className="text-base leading-none">+</span>
          <span>New cluster</span>
        </button>
      </div>

      <WebsitePagesManager
        assignments={assignments}
        configClusters={configClusters}
        customClusters={customClusters}
        overrideCount={overrideCount}
      />

      <NewClusterDialog
        open={newClusterOpen}
        onClose={() => setNewClusterOpen(false)}
        existingSlugs={existingSlugs}
      />
    </>
  );
}

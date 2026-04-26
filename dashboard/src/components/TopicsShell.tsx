"use client";

/**
 * Shell wrapping the /topics page.
 *
 * Owns:
 *   - viewMode: "cluster" | "page" — the top-level toggle between
 *     cluster-level roll-ups and per-URL performance.
 *   - lang: "en" | "de" — shared across both views so switching modes
 *     keeps the user's language in place.
 *   - New-cluster dialog trigger — only relevant to the cluster view,
 *     but mounted here so the button lives in the shared toolbar.
 *
 * Renders:
 *   <toolbar>                          lang tabs · view toggle · +New
 *   <legacy-migration-nudge />         only when old-schema rows slip in
 *   <TopicClustersTable lang=...>  OR  <ClusterPagesTable lang=...>
 *
 * Legend moves up to the page; it's tied to the cluster view (patterns
 * + 7d indicator + Pages column) so we hide it when viewMode === "page".
 */

import clsx from "clsx";
import { useMemo, useState } from "react";

import { ClusterPagesTable } from "@/components/ClusterPagesTable";
import { NewClusterDialog } from "@/components/NewClusterDialog";
import { TopicClustersTable } from "@/components/TopicClustersTable";
import type {
  ClusterContentRollup,
  CustomCluster,
  DailyPagesSlice,
  DailyTopicsSlice,
  HistoricalSnapshot,
  PageClusterAssignment,
  TopicCluster,
} from "@/lib/types";

type ViewMode = "cluster" | "page";
type Lang = "en" | "de";

export interface TopicsShellProps {
  // Cluster-view inputs
  topicSlices: DailyTopicsSlice[];
  trends: Record<string, HistoricalSnapshot>;
  contentRollups: Record<string, ClusterContentRollup>;
  // Page-view inputs
  pageSlices: DailyPagesSlice[];
  assignments: PageClusterAssignment[];
  // Shared
  configClusters: TopicCluster[];
  customClusters: CustomCluster[];
}

export function TopicsShell({
  topicSlices,
  trends,
  contentRollups,
  pageSlices,
  assignments,
  configClusters,
  customClusters,
}: TopicsShellProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("cluster");
  // Default EN — same rationale as before: international-first, Peec
  // visibility/mentions are lang-agnostic, so EN is the comparison
  // baseline.
  const [lang, setLang] = useState<Lang>("en");
  const [newClusterOpen, setNewClusterOpen] = useState(false);

  const existingSlugs = useMemo(
    () => [
      ...configClusters.map((c) => c.slug),
      ...customClusters.map((c) => c.slug),
    ],
    [configClusters, customClusters],
  );

  // Per-language counts for the lang tabs. Cluster view counts config +
  // custom cluster slots (constant across langs). Page view counts
  // actual per-language page assignments so the number reflects the
  // cost of switching.
  const counts = useMemo(() => {
    if (viewMode === "cluster") {
      const n = configClusters.length + customClusters.length;
      return { en: n, de: n };
    }
    let en = 0;
    let de = 0;
    for (const a of assignments) {
      if (a.lang === "en") en += 1;
      else if (a.lang === "de") de += 1;
    }
    return { en, de };
  }, [viewMode, configClusters, customClusters, assignments]);

  // Pre-migration rows slipped through the cluster aggregation? Count
  // distinct legacy topic names across the topic slices and show a
  // nudge. Only meaningful in cluster view — in page view the data
  // pathway bypasses cluster-keyed topic rows entirely.
  const legacyRowCount = useMemo(() => {
    if (viewMode !== "cluster") return 0;
    const legacy = new Set<string>();
    for (const slice of topicSlices) {
      for (const t of slice.topics) {
        if (!t.cluster || !t.lang) legacy.add(t.topic);
      }
    }
    return legacy.size;
  }, [viewMode, topicSlices]);

  return (
    <>
      <section className="bg-surface rounded-ds border border-hairline overflow-hidden shadow-card">
        {/* Toolbar: lang tabs · view toggle · + New cluster */}
        <div className="flex items-center gap-2 flex-wrap p-3 border-b border-hairline bg-surface-muted/30">
          <div className="flex items-center gap-1">
            <LangTabButton
              active={lang === "en"}
              onClick={() => setLang("en")}
              label="English"
              count={counts.en}
            />
            <LangTabButton
              active={lang === "de"}
              onClick={() => setLang("de")}
              label="Deutsch"
              count={counts.de}
            />
          </div>

          <div className="md:ml-4 flex items-center gap-0.5 bg-surface-muted rounded-lg p-0.5 border border-hairline">
            <ViewToggleButton
              active={viewMode === "cluster"}
              onClick={() => setViewMode("cluster")}
              label="Cluster view"
            />
            <ViewToggleButton
              active={viewMode === "page"}
              onClick={() => setViewMode("page")}
              label="Page view"
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            {viewMode === "cluster" && (
              <button
                type="button"
                onClick={() => setNewClusterOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-full border border-hairline text-ink-700 bg-surface hover:border-primary-400 hover:text-primary-700 hover:shadow-card transition-all font-medium"
              >
                <span aria-hidden>+</span>
                <span>New cluster</span>
              </button>
            )}
          </div>
        </div>

        {legacyRowCount > 0 && (
          <div className="px-4 py-2.5 bg-warning-50/80 border-b border-warning/25 text-[11px] text-ink-700 leading-relaxed">
            <strong className="text-warning-600">
              {legacyRowCount} pre-migration topic
              {legacyRowCount === 1 ? "" : "s"} hidden.
            </strong>{" "}
            Daily aggregates written before the cluster rename still carry old topic
            names. Rebuild them with:{" "}
            <code className="bg-primary-950 text-primary-100 px-1.5 py-0.5 rounded font-mono text-[11px]">
              python scripts/aggregate_daily.py --days-back 30
            </code>
          </div>
        )}

        {viewMode === "cluster" ? (
          <TopicClustersTable
            slices={topicSlices}
            trends={trends}
            contentRollups={contentRollups}
            configClusters={configClusters}
            customClusters={customClusters}
            lang={lang}
          />
        ) : (
          <ClusterPagesTable
            slices={pageSlices}
            assignments={assignments}
            configClusters={configClusters}
            customClusters={customClusters}
            lang={lang}
          />
        )}
      </section>

      <NewClusterDialog
        open={newClusterOpen}
        onClose={() => setNewClusterOpen(false)}
        existingSlugs={existingSlugs}
      />
    </>
  );
}

// ---------------------------------------------------------------------

function LangTabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-all font-medium",
        active
          ? "bg-primary-600 text-white shadow-card"
          : "text-ink-600 hover:bg-surface-muted hover:text-ink-900",
      )}
      aria-pressed={active}
    >
      <span>{label}</span>
      <span
        className={clsx(
          "text-[11px] tabular-nums",
          active ? "text-primary-100/80" : "text-ink-400",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function ViewToggleButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "px-3 py-1 text-xs rounded-md transition-all font-medium",
        active
          ? "bg-surface text-primary-800 shadow-card"
          : "text-ink-600 hover:text-ink-900",
      )}
    >
      {label}
    </button>
  );
}

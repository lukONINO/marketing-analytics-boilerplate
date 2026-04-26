"use client";

/**
 * Findings view — full archive of Claude-written insights.
 *
 * Used by /strategy/findings. Mirrors the action-stream drawer pattern
 * from `ClusterFixList` but renders all insights (every severity, every
 * status) with a filter strip on top.
 *
 * Click any row to open the side drawer with the full body, tags, and
 * any linked references. Filters are URL-state-free (kept in component
 * state) — bookmarking a filtered view is not a real use case yet.
 */

import clsx from "clsx";
import Link from "next/link";
import { useMemo, useState } from "react";

import { DetailDrawer } from "@/components/DetailDrawer";
import { InsightActions } from "@/components/InsightActions";
import type { Insight, InsightSeverity, InsightStatus } from "@/lib/types";

export interface FindingsViewProps {
  insights: Insight[];
}

type SeverityFilter = "all" | InsightSeverity;
type StatusFilter = "all" | InsightStatus;

export function FindingsView({ insights }: FindingsViewProps) {
  // Local mirror of the prop list so status mutations + deletes reflect
  // immediately (the parent is server-rendered; without a router refresh
  // the prop won't change). On a hard reload we re-hydrate from the
  // canonical insights.json.
  const [items, setItems] = useState<Insight[]>(insights);
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("open");
  const [openInsight, setOpenInsight] = useState<Insight | null>(null);

  const filtered = useMemo(() => {
    return items.filter((ins) => {
      if (severity !== "all" && ins.severity !== severity) return false;
      if (status !== "all" && ins.status !== status) return false;
      return true;
    });
  }, [items, severity, status]);

  const counts = useMemo(() => {
    const c = { critical: 0, warning: 0, info: 0 };
    for (const ins of items) {
      if (status !== "all" && ins.status !== status) continue;
      c[ins.severity] = (c[ins.severity] ?? 0) + 1;
    }
    return c;
  }, [items, status]);

  function handleInsightChange(updated: Insight) {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    setOpenInsight((cur) => (cur && cur.id === updated.id ? updated : cur));
  }
  function handleInsightDelete(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setOpenInsight(null);
  }

  return (
    <>
      {/* ===== Filter strip ===== */}
      <section className="mb-6 flex flex-wrap items-center gap-3 text-xs">
        <div className="inline-flex items-center gap-1 bg-surface border border-hairline rounded-lg p-0.5">
          <FilterChip
            active={severity === "all"}
            onClick={() => setSeverity("all")}
            count={counts.critical + counts.warning + counts.info}
            label="All"
          />
          <FilterChip
            active={severity === "critical"}
            onClick={() => setSeverity("critical")}
            count={counts.critical}
            label="Critical"
            tone="danger"
          />
          <FilterChip
            active={severity === "warning"}
            onClick={() => setSeverity("warning")}
            count={counts.warning}
            label="Warning"
            tone="warning"
          />
          <FilterChip
            active={severity === "info"}
            onClick={() => setSeverity("info")}
            count={counts.info}
            label="Info"
          />
        </div>
        <div className="inline-flex items-center gap-1 bg-surface border border-hairline rounded-lg p-0.5">
          <FilterChip active={status === "open"}     onClick={() => setStatus("open")}     label="Open"     />
          <FilterChip active={status === "reviewed"} onClick={() => setStatus("reviewed")} label="Reviewed" />
          <FilterChip active={status === "archived"} onClick={() => setStatus("archived")} label="Archived" />
          <FilterChip active={status === "all"}      onClick={() => setStatus("all")}      label="All statuses" />
        </div>
        <span className="ml-auto text-ink-500 tabular-nums">
          {filtered.length} of {insights.length} insight{insights.length === 1 ? "" : "s"}
        </span>
      </section>

      {/* ===== Findings list ===== */}
      {filtered.length === 0 ? (
        <section className="bg-surface border border-hairline rounded-2xl p-10 text-center">
          <p className="text-sm text-ink-600">
            No insights match the current filters. Loosen the filter or ask
            Claude to log a new finding.
          </p>
        </section>
      ) : (
        <section className="bg-surface border border-hairline rounded-2xl shadow-card overflow-hidden">
          <ul className="divide-y divide-hairline">
            {filtered.map((ins) => (
              <FindingRow
                key={ins.id}
                insight={ins}
                onSelect={() => setOpenInsight(ins)}
              />
            ))}
          </ul>
        </section>
      )}

      {/* ===== Drawer ===== */}
      <FindingDrawer
        insight={openInsight}
        onClose={() => setOpenInsight(null)}
        onChange={handleInsightChange}
        onDelete={handleInsightDelete}
      />
    </>
  );
}

// ---------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------

function FindingRow({
  insight,
  onSelect,
}: {
  insight: Insight;
  onSelect: () => void;
}) {
  function handleKey(e: React.KeyboardEvent<HTMLLIElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect();
    }
  }
  const preview = (insight.body ?? "").split(/\n\n/)[0].slice(0, 220);
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKey}
      className="px-5 py-3.5 hover:bg-surface-muted/40 focus:bg-surface-muted/40 focus:outline-none transition-colors cursor-pointer"
    >
      <div className="flex items-start gap-3">
        <SeverityDot severity={insight.severity} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-ink-900 leading-tight">
              {insight.title}
            </h3>
            <SeverityPill severity={insight.severity} />
            {insight.status !== "open" && <StatusPill status={insight.status} />}
            {insight.source_date && (
              <span className="text-[11px] text-ink-500 tabular-nums">
                {insight.source_date}
              </span>
            )}
          </div>
          {preview && (
            <p className="text-[12px] text-ink-600 mt-1 leading-relaxed">
              {preview}
              {(insight.body ?? "").length > 220 ? "…" : ""}
            </p>
          )}
          {insight.tags && insight.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {insight.tags.slice(0, 5).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center text-[10px] uppercase tracking-[0.12em] font-semibold px-1.5 py-0.5 rounded bg-surface-muted text-ink-700 ring-1 ring-inset ring-hairline"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <ChevronIcon className="mt-1 shrink-0 text-ink-400" />
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------

function FindingDrawer({
  insight,
  onClose,
  onChange,
  onDelete,
}: {
  insight: Insight | null;
  onClose: () => void;
  onChange?: (updated: Insight) => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <DetailDrawer
      open={!!insight}
      onClose={onClose}
      eyebrow={
        insight && (
          <div className="inline-flex items-center gap-2">
            <SeverityPill severity={insight.severity} />
            <StatusPill status={insight.status} />
            {insight.source_date && (
              <span className="text-[11px] text-ink-500 tabular-nums">
                {insight.source_date}
              </span>
            )}
            <span className="text-[11px] text-ink-500">·</span>
            <span className="text-[11px] text-ink-500">{insight.source}</span>
          </div>
        )
      }
      title={insight?.title}
    >
      {insight && (
        <div className="px-5 py-4 space-y-4">
          <div className="text-[11px] text-ink-500 tabular-nums">
            {insight.id} · created {insight.created_at?.slice(0, 10)}
          </div>
          {insight.body && (
            <div className="prose prose-sm max-w-none text-ink-700 whitespace-pre-wrap leading-relaxed">
              {insight.body}
            </div>
          )}
          <InsightActions
            insightId={insight.id}
            status={insight.status}
            onChange={onChange}
            onDelete={onDelete}
          />
          {insight.tags && insight.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {insight.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center text-[10px] uppercase tracking-[0.12em] font-semibold px-1.5 py-0.5 rounded bg-surface-muted text-ink-700 ring-1 ring-inset ring-hairline"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          {insight.linked_urls && insight.linked_urls.length > 0 && (
            <div className="border-t border-hairline pt-4">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-ink-500 mb-2">
                Linked references
              </div>
              <ul className="space-y-1">
                {insight.linked_urls.map((url) => (
                  <li key={url} className="text-xs">
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary-700 hover:text-primary-900 underline decoration-dotted underline-offset-2 break-all"
                    >
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </DetailDrawer>
  );
}

// ---------------------------------------------------------------------
// Atoms
// ---------------------------------------------------------------------

function FilterChip({
  active,
  onClick,
  count,
  label,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  label: string;
  tone?: "danger" | "warning";
}) {
  const activeStyle =
    tone === "danger" ? "bg-danger-50 text-danger-600 ring-danger/20"
    : tone === "warning" ? "bg-warning-50 text-warning-600 ring-warning/25"
    : "bg-surface-muted text-ink-900 ring-hairline";
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-colors",
        active ? `ring-1 ring-inset ${activeStyle}` : "text-ink-600 hover:text-ink-900",
      )}
    >
      <span>{label}</span>
      {typeof count === "number" && (
        <span className="tabular-nums text-[10px] opacity-70">{count}</span>
      )}
    </button>
  );
}

function SeverityDot({ severity }: { severity: InsightSeverity }) {
  const cls = severity === "critical" ? "bg-danger-500 ring-danger/20"
    : severity === "warning"  ? "bg-warning-500 ring-warning/25"
    : "bg-primary-500 ring-primary-500/15";
  return <span className={clsx("mt-1.5 w-2 h-2 rounded-full shrink-0 ring-4", cls)} aria-hidden />;
}

function SeverityPill({ severity }: { severity: InsightSeverity }) {
  const styles = severity === "critical" ? "bg-danger-50 text-danger-600 ring-danger/20"
    : severity === "warning"  ? "bg-warning-50 text-warning-600 ring-warning/25"
    : "bg-primary-50 text-primary-700 ring-primary-200";
  const label = severity === "critical" ? "Critical" : severity === "warning" ? "Warning" : "Info";
  return (
    <span className={clsx(
      "inline-flex items-center text-[10px] uppercase tracking-[0.12em] font-semibold px-1.5 py-0.5 rounded ring-1 ring-inset",
      styles,
    )}>
      {label}
    </span>
  );
}

function StatusPill({ status }: { status: InsightStatus }) {
  const labels = { open: "Open", reviewed: "Reviewed", archived: "Archived" } as const;
  const styles = status === "archived"
    ? "bg-surface-muted text-ink-500 ring-hairline opacity-80"
    : status === "reviewed"
    ? "bg-success-50 text-success-600 ring-success/25"
    : "bg-primary-50 text-primary-700 ring-primary-200";
  return (
    <span className={clsx(
      "inline-flex items-center text-[10px] uppercase tracking-[0.12em] font-semibold px-1.5 py-0.5 rounded ring-1 ring-inset",
      styles,
    )}>
      {labels[status]}
    </span>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      className={clsx("w-3.5 h-3.5", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

"use client";

/**
 * Recent Anomalies — Claude-written warnings/criticals from the last 7 days.
 *
 * This is the "what needs attention right now" widget on Overview.
 * Reads `insights.json`, filters to severity ∈ {warning, critical}
 * AND created_at within the last 7 days, sorts most-recent-first,
 * caps at 3.
 *
 * Each row is clickable: opens the existing DetailDrawer (same UI as
 * the Strategy action stream / findings page) so the full insight body
 * is one click away — the user doesn't have to navigate to /strategy
 * to read why something needs attention.
 *
 * Empty state when no fresh anomalies — that's good news, render it
 * as such rather than hiding the section.
 */

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";

import { DetailDrawer } from "@/components/DetailDrawer";
import { InsightActions } from "@/components/InsightActions";
import type { Insight, InsightSeverity } from "@/lib/types";

export interface RecentAnomaliesProps {
  insights: Insight[];
}

const FRESH_DAYS = 7;
const MAX_ITEMS = 3;

export function RecentAnomalies({ insights }: RecentAnomaliesProps) {
  // Local mirror so archive/delete from the drawer reflects without a
  // page reload. Same pattern as FindingsView + ClusterWork.
  const [items, setItems] = useState<Insight[]>(insights);
  const [openInsight, setOpenInsight] = useState<Insight | null>(null);

  function handleChange(updated: Insight) {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    setOpenInsight((cur) => (cur && cur.id === updated.id ? updated : cur));
  }
  function handleDelete(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setOpenInsight(null);
  }

  const recent = pickRecentAnomalies(items);

  return (
    <>
      <section className="mb-8 bg-surface border border-hairline rounded-2xl shadow-card overflow-hidden">
        <header className="px-5 py-3.5 border-b border-hairline bg-surface-muted/30 flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
            Recent anomalies · last {FRESH_DAYS} days
          </h2>
          <Link
            href="/strategy/findings"
            className="text-[11px] text-primary-700 hover:text-primary-900 font-medium inline-flex items-center gap-1 group"
          >
            View all findings
            <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>
              →
            </span>
          </Link>
        </header>
        {recent.length === 0 ? (
          <div className="px-5 py-6 text-center">
            <p className="text-sm text-ink-600">
              No critical or warning insights in the last {FRESH_DAYS} days. The
              data is being watched — Claude flags anomalies during routines.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {recent.map((ins) => (
              <AnomalyRow key={ins.id} insight={ins} onSelect={() => setOpenInsight(ins)} />
            ))}
          </ul>
        )}
      </section>

      <AnomalyDrawer
        insight={openInsight}
        onClose={() => setOpenInsight(null)}
        onChange={handleChange}
        onDelete={handleDelete}
      />
    </>
  );
}

function pickRecentAnomalies(insights: Insight[]): Insight[] {
  const cutoff = Date.now() - FRESH_DAYS * 24 * 60 * 60 * 1000;
  return insights
    .filter((i) => i.severity === "critical" || i.severity === "warning")
    .filter((i) => {
      const t = Date.parse(i.created_at);
      return Number.isFinite(t) && t >= cutoff;
    })
    .filter((i) => i.status === "open" || i.status === undefined)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, MAX_ITEMS);
}

// ---------------------------------------------------------------------

function AnomalyRow({
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
  const preview = (insight.body ?? "").split(/\n\n/)[0].slice(0, 180);
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKey}
      className="px-5 py-3 hover:bg-surface-muted/40 focus:bg-surface-muted/40 focus:outline-none transition-colors cursor-pointer"
    >
      <div className="flex items-start gap-3">
        <SeverityDot severity={insight.severity} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-ink-900 leading-tight">
              {insight.title}
            </h3>
            <SeverityPill severity={insight.severity} />
            {insight.source_date && (
              <span className="text-[11px] text-ink-500 tabular-nums">
                {insight.source_date}
              </span>
            )}
          </div>
          {preview && (
            <p className="text-[12px] text-ink-600 mt-1 leading-relaxed">
              {preview}
              {(insight.body ?? "").length > 180 ? "…" : ""}
            </p>
          )}
        </div>
        <span className="text-ink-400 mt-1 shrink-0 text-sm" aria-hidden>›</span>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------

function AnomalyDrawer({
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
          {insight.body && (
            <div className="prose prose-sm max-w-none text-ink-700 whitespace-pre-wrap leading-relaxed">
              {insight.body}
            </div>
          )}
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
          <InsightActions
            insightId={insight.id}
            status={insight.status}
            onChange={onChange}
            onDelete={onDelete}
          />
        </div>
      )}
    </DetailDrawer>
  );
}

// ---------------------------------------------------------------------
// Atoms (mirror the FindingsView style for visual consistency)
// ---------------------------------------------------------------------

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

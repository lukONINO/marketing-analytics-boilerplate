"use client";

/**
 * Cluster-level "things that need attention" — the unified action stream.
 *
 * On the Strategy page this combines three sources into one ranked list:
 *   1. Visibility opportunities (rule-computed) — on-page fixes.
 *   2. Source gaps (Peec MCP) — outreach / placement opportunities.
 *   3. Claude-written findings (insights with severity ≥ warning).
 *
 * On per-cluster pages (/topics/[slug]) the same component renders just
 * the first two — `findings` are site-wide context, not cluster-scoped.
 *
 * Rows are clickable: clicking opens a side drawer with the full body
 * and any links the source carries. The cluster chip and the inline
 * URL link inside a row are independently clickable (their handlers
 * stopPropagation so the drawer doesn't open when you actually meant
 * to navigate).
 *
 * The footer carries a "View all findings →" link to /strategy/findings
 * so the section never traps the user — they can always escape to the
 * full archive of Claude-written insights.
 *
 * Builders + types live in `@/lib/cluster-fixes` so server components
 * can call them without tripping the `"use client"` boundary.
 */

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";

import { CopyPromptButton } from "@/components/CopyPromptButton";
import { DetailDrawer } from "@/components/DetailDrawer";
import { InsightActions } from "@/components/InsightActions";
import type { ClusterFix } from "@/lib/cluster-fixes";
import type { Insight } from "@/lib/types";

export interface ClusterFixListProps {
  fixes: ClusterFix[];
  /**
   * Show the "View all findings →" footer link. Defaults to true on
   * site-wide lists (Strategy page), false on per-cluster lists where
   * findings aren't shown anyway.
   */
  showFindingsLink?: boolean;
}

export function ClusterFixList({ fixes, showFindingsLink = true }: ClusterFixListProps) {
  // Local mutation overlay: when the user archives or deletes a finding
  // from inside the drawer, we patch the displayed list immediately
  // (the prop is server-rendered; without this overlay the change
  // would only show after a hard reload).
  const [overlay, setOverlay] = useState<Map<string, "deleted" | { status: Insight["status"] }>>(new Map());
  const [openFix, setOpenFix] = useState<ClusterFix | null>(null);

  function handleInsightChange(updated: Insight) {
    setOverlay((prev) => {
      const next = new Map(prev);
      next.set(updated.id, { status: updated.status });
      return next;
    });
    // Keep the drawer in sync if it's open on this insight.
    setOpenFix((cur) => (
      cur && cur.insight_id === updated.id
        ? { ...cur, insight_status: updated.status }
        : cur
    ));
  }
  function handleInsightDelete(id: string) {
    setOverlay((prev) => {
      const next = new Map(prev);
      next.set(id, "deleted");
      return next;
    });
    setOpenFix(null);
  }

  // Apply overlay: drop deleted findings, override status for changed ones.
  const visibleFixes = fixes
    .filter((f) => {
      if (f.kind !== "finding" || !f.insight_id) return true;
      return overlay.get(f.insight_id) !== "deleted";
    })
    .map((f) => {
      if (f.kind !== "finding" || !f.insight_id) return f;
      const o = overlay.get(f.insight_id);
      if (o && o !== "deleted") {
        return { ...f, insight_status: o.status };
      }
      return f;
    });
  fixes = visibleFixes;

  if (fixes.length === 0) {
    return (
      <section className="bg-surface border border-hairline rounded-2xl p-6 text-center">
        <p className="text-sm text-ink-600">
          Nothing flagged right now. Either we&apos;re in good shape here, or
          the upstream data sources (visibility audit, source-gap pull,
          Claude insights) haven&apos;t been refreshed yet.
        </p>
      </section>
    );
  }

  // Composition breakdown for the header — helps the reader know
  // what mix of sources this list is drawing from at a glance.
  const counts = fixes.reduce(
    (acc, f) => {
      acc[f.kind] += 1;
      return acc;
    },
    { "on-page": 0, outreach: 0, finding: 0 } as Record<ClusterFix["kind"], number>,
  );
  const breakdown = [
    counts["on-page"] > 0 ? `${counts["on-page"]} on-page` : null,
    counts.outreach > 0 ? `${counts.outreach} outreach` : null,
    counts.finding > 0 ? `${counts.finding} finding${counts.finding === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <section className="bg-surface border border-hairline rounded-2xl shadow-card overflow-hidden">
        <header className="px-5 py-3.5 border-b border-hairline bg-surface-muted/30 flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
            Things that need attention
          </h2>
          <span className="text-[11px] text-ink-500 tabular-nums">
            {fixes.length} item{fixes.length === 1 ? "" : "s"} · {breakdown}
          </span>
        </header>
        <ul className="divide-y divide-hairline">
          {fixes.map((fix) => (
            <FixRow key={fix.id} fix={fix} onSelect={() => setOpenFix(fix)} />
          ))}
        </ul>
        {showFindingsLink && (
          <footer className="px-5 py-2.5 border-t border-hairline bg-surface-muted/20 flex items-center justify-between gap-3">
            <span className="text-[11px] text-ink-500">
              Click any row for the full detail
            </span>
            <Link
              href="/strategy/findings"
              className="text-[11px] text-primary-700 hover:text-primary-900 font-medium inline-flex items-center gap-1 group"
            >
              View all findings
              <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>
                →
              </span>
            </Link>
          </footer>
        )}
      </section>
      <FixDrawer
        fix={openFix}
        onClose={() => setOpenFix(null)}
        onInsightChange={handleInsightChange}
        onInsightDelete={handleInsightDelete}
      />
    </>
  );
}

// ---------------------------------------------------------------------
// Row
//
// The whole row is a click target (opens the drawer). The cluster chip
// and URL link inside it are independently clickable — their onClick
// handlers stopPropagation so navigation works without also opening
// the drawer.
//
// Accessibility: role="button" + tabIndex=0 + keyboard handler so the
// row is reachable + activatable from the keyboard. We can't use a
// real <button> for the wrapper because the cluster chip and URL link
// are nested anchors and <button><a /></button> is invalid HTML.
// ---------------------------------------------------------------------

function FixRow({ fix, onSelect }: { fix: ClusterFix; onSelect: () => void }) {
  const severity = SEVERITY_STYLES[fix.severity];
  function handleKey(e: React.KeyboardEvent<HTMLLIElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect();
    }
  }
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKey}
      className="px-5 py-3 hover:bg-surface-muted/40 focus:bg-surface-muted/40 focus:outline-none transition-colors cursor-pointer"
    >
      <div className="flex items-start gap-3">
        <span
          className={clsx("mt-1.5 w-2 h-2 rounded-full shrink-0 ring-4", severity.dot, severity.ring)}
          aria-hidden
          title={severity.label}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-ink-900 leading-tight">
              {fix.title}
            </h3>
            <KindBadge kind={fix.kind} />
            {fix.cluster_slug && fix.cluster_label && (
              <a
                href={`/topics/${fix.cluster_slug}`}
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 inline-flex items-center text-[10px] uppercase tracking-[0.12em] font-semibold px-1.5 py-0.5 rounded bg-surface-muted text-ink-700 ring-1 ring-inset ring-hairline hover:ring-primary-300 hover:text-primary-700 transition-colors"
              >
                {fix.cluster_label}
              </a>
            )}
          </div>
          <p className="text-[12px] text-ink-600 mt-1 leading-relaxed">{fix.detail}</p>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            {fix.url && (
              <a
                href={fix.url}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-primary-700 hover:text-primary-900 underline decoration-dotted underline-offset-2 truncate max-w-full"
                onClick={(e) => e.stopPropagation()}
              >
                {shortPath(fix.url)} ↗
              </a>
            )}
            {fix.claude_prompt && (
              <CopyPromptButton prompt={fix.claude_prompt} variant="inline" />
            )}
          </div>
        </div>
        <ChevronIcon className="mt-1.5 shrink-0 text-ink-400 group-hover:text-ink-700" />
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------
// Drawer — full detail per row
//
// All three kinds share the same shell (severity pill, title, cluster
// chip, kind badge, body, URL block). Findings get a richer body
// (full insight body + tags + linked-urls list); fixes show the
// already-truncated `detail` text since the source data doesn't
// carry a richer payload at the dashboard layer.
// ---------------------------------------------------------------------

function FixDrawer({
  fix,
  onClose,
  onInsightChange,
  onInsightDelete,
}: {
  fix: ClusterFix | null;
  onClose: () => void;
  onInsightChange?: (updated: Insight) => void;
  onInsightDelete?: (id: string) => void;
}) {
  const open = !!fix;
  return (
    <DetailDrawer
      open={open}
      onClose={onClose}
      eyebrow={
        <div className="inline-flex items-center gap-2">
          {fix && <KindBadge kind={fix.kind} />}
          {fix && <SeverityPill severity={fix.severity} />}
          {fix?.source_date && (
            <span className="text-[11px] text-ink-500 tabular-nums">{fix.source_date}</span>
          )}
        </div>
      }
      title={fix?.title}
      headerTrailing={
        fix?.cluster_slug && fix.cluster_label ? (
          <Link
            href={`/topics/${fix.cluster_slug}`}
            className="text-[11px] text-primary-700 hover:text-primary-900 font-medium"
          >
            {fix.cluster_label} →
          </Link>
        ) : null
      }
      footer={fix?.kind === "finding" ? (
        <div className="px-5 py-3 flex items-center justify-end">
          <Link
            href="/strategy/findings"
            className="text-xs text-primary-700 hover:text-primary-900 font-medium inline-flex items-center gap-1 group"
          >
            View all findings
            <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>→</span>
          </Link>
        </div>
      ) : null}
    >
      {fix && (
        <FixDrawerBody
          fix={fix}
          onInsightChange={onInsightChange}
          onInsightDelete={onInsightDelete}
        />
      )}
    </DetailDrawer>
  );
}

function FixDrawerBody({
  fix,
  onInsightChange,
  onInsightDelete,
}: {
  fix: ClusterFix;
  onInsightChange?: (updated: Insight) => void;
  onInsightDelete?: (id: string) => void;
}) {
  const body = fix.body_full || fix.detail;
  return (
    <div className="px-5 py-4 space-y-4">
      <div className="prose prose-sm max-w-none text-ink-700 whitespace-pre-wrap leading-relaxed">
        {body}
      </div>
      {fix.claude_prompt && (
        <div className="border-t border-hairline pt-4">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-ink-500 mb-2">
            Hand off to Claude
          </div>
          <div className="bg-ink-900 text-white text-[12px] font-mono p-3 rounded-lg overflow-x-auto whitespace-pre-wrap leading-relaxed mb-2">
            {fix.claude_prompt}
          </div>
          <CopyPromptButton prompt={fix.claude_prompt} variant="block" />
        </div>
      )}
      {fix.tags && fix.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {fix.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center text-[10px] uppercase tracking-[0.12em] font-semibold px-1.5 py-0.5 rounded bg-surface-muted text-ink-700 ring-1 ring-inset ring-hairline"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      {fix.linked_urls && fix.linked_urls.length > 0 && (
        <div className="border-t border-hairline pt-4">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-ink-500 mb-2">
            Linked references
          </div>
          <ul className="space-y-1">
            {fix.linked_urls.map((url) => (
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
      {fix.url && !fix.linked_urls?.includes(fix.url) && (
        <div className="border-t border-hairline pt-4">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-ink-500 mb-2">
            Page in question
          </div>
          <a
            href={fix.url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary-700 hover:text-primary-900 underline decoration-dotted underline-offset-2 break-all"
          >
            {fix.url}
          </a>
        </div>
      )}
      {fix.kind === "finding" && fix.insight_id && fix.insight_status && (
        <InsightActions
          insightId={fix.insight_id}
          status={fix.insight_status}
          onChange={onInsightChange}
          onDelete={onInsightDelete}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Small visual atoms
// ---------------------------------------------------------------------

function KindBadge({ kind }: { kind: ClusterFix["kind"] }) {
  // Two-class model: every row is either a Task (on-page / outreach
  // sub-kind) or an Insight. The top-level word is what the user
  // reads first; the sub-kind explains the flavour of work.
  const styles = {
    "on-page": "bg-primary-50 text-primary-700 ring-primary-200",
    outreach: "bg-accent-50 text-accent-700 ring-accent-200",
    finding:  "bg-warning-50 text-warning-600 ring-warning/25",
  } as const;
  const labels = {
    "on-page": "Task · On-page",
    outreach:  "Task · Outreach",
    finding:   "Insight",
  } as const;
  return (
    <span
      className={clsx(
        "shrink-0 inline-flex items-center text-[10px] uppercase tracking-[0.12em] font-semibold px-1.5 py-0.5 rounded ring-1 ring-inset",
        styles[kind],
      )}
    >
      {labels[kind]}
    </span>
  );
}

function SeverityPill({ severity }: { severity: ClusterFix["severity"] }) {
  const s = SEVERITY_STYLES[severity];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] font-semibold px-1.5 py-0.5 rounded ring-1 ring-inset",
        severity === "high" ? "bg-danger-50 text-danger-600 ring-danger/20"
        : severity === "medium" ? "bg-warning-50 text-warning-600 ring-warning/25"
        : "bg-surface-muted text-ink-600 ring-hairline",
      )}
    >
      <span className={clsx("w-1.5 h-1.5 rounded-full", s.dot)} aria-hidden />
      {s.label}
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

const SEVERITY_STYLES = {
  high:   { label: "High",   dot: "bg-danger-500",  ring: "ring-danger/20" },
  medium: { label: "Medium", dot: "bg-warning-500", ring: "ring-warning/25" },
  low:    { label: "Low",    dot: "bg-ink-400",     ring: "ring-hairline" },
} as const;

// ---------------------------------------------------------------------

function shortPath(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

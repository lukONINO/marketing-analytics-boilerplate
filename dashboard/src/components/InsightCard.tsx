"use client";

import clsx from "clsx";
import Link from "next/link";

import type { Insight, InsightSeverity } from "@/lib/types";

/**
 * Severity visual tokens shared by the list row + the drawer header pill.
 * Kept intentionally calm — loud colors on every row create fatigue; the
 * info tier is slate-neutral so only actual warnings + critical pop.
 */
const SEVERITY_STYLES: Record<InsightSeverity, { pill: string; dot: string; dotRing: string; label: string }> = {
  critical: { pill: "bg-danger-50 text-danger-600 ring-1 ring-inset ring-danger/20",     dot: "bg-danger-500",  dotRing: "ring-danger-500/15",  label: "Critical" },
  warning:  { pill: "bg-warning-50 text-warning-600 ring-1 ring-inset ring-warning/25",  dot: "bg-warning-500", dotRing: "ring-warning-500/15", label: "Warning"  },
  info:     { pill: "bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-200", dot: "bg-primary-500", dotRing: "ring-primary-500/15", label: "Info"     },
};

export interface InsightCardProps {
  insight: Insight;
  /** "compact" = used in Overview's right rail (4-line card). "row" = used in the Insights list (dense row). Default row. */
  variant?: "row" | "compact";
  /** Provide `onClick` to make the card a clickable button (opens a local drawer, etc.). */
  onClick?: (insight: Insight) => void;
  /** Provide `href` to make the card a Next Link (navigates on click). Takes precedence over onClick if both are supplied. */
  href?: string;
}

/**
 * List-row or compact-card representation of an insight.
 *
 * Renders as `<Link>` if `href` is given, `<button>` if `onClick` is
 * given, and a plain `<div>` otherwise — so we don't nest buttons
 * inside anchors (invalid HTML) when the Overview wraps a compact card
 * in a link to /insights.
 *
 * Full body is NOT rendered here — the full list page opens a
 * DetailDrawer; the Overview's compact variant navigates instead.
 */
export function InsightCard({ insight, variant = "row", onClick, href }: InsightCardProps) {
  const s = SEVERITY_STYLES[insight.severity] ?? SEVERITY_STYLES.info;
  const isInteractive = !!onClick || !!href;

  const handleClick = () => {
    if (onClick) onClick(insight);
  };

  if (variant === "compact") {
    // Headline-only compact row: severity dot · title (single line,
    // truncated) · optional source-date on the far right. Body preview,
    // severity pill, and tag row are intentionally omitted — this row
    // is meant to be glanceable in the Overview sidebar; click-through
    // to /insights surfaces the full detail.
    const compactClasses = clsx(
      "block w-full text-left px-5 py-2.5 flex items-center gap-3 transition-colors",
      isInteractive && "hover:bg-surface-muted cursor-pointer",
      !isInteractive && "cursor-default",
    );
    const compactInner = (
      <>
        <span
          className={clsx("w-1.5 h-1.5 rounded-full shrink-0 ring-4", s.dot, s.dotRing)}
          aria-hidden
          title={s.label}
        />
        <span className="flex-1 min-w-0 text-sm font-medium text-ink-900 leading-snug truncate">
          {insight.title}
        </span>
        {insight.source_date && (
          <span className="text-[11px] text-ink-400 tabular-nums shrink-0">
            {insight.source_date}
          </span>
        )}
      </>
    );
    if (href) return <Link href={href} className={compactClasses}>{compactInner}</Link>;
    if (onClick) return <button type="button" onClick={handleClick} className={compactClasses}>{compactInner}</button>;
    return <div className={compactClasses}>{compactInner}</div>;
  }

  // "row" variant — dense, scannable, meta on the right.
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!isInteractive}
      className={clsx(
        "group w-full text-left bg-surface border border-hairline rounded-ds px-5 py-4 shadow-card",
        "transition-all duration-200",
        isInteractive && "hover:border-hairline-subtle hover:shadow-card-hover cursor-pointer hover:-translate-y-0.5",
        !isInteractive && "cursor-default",
        insight.status === "reviewed" && "opacity-60",
      )}
      aria-label={`Open insight: ${insight.title}`}
    >
      <div className="flex items-start gap-4">
        {/* Severity indicator */}
        <span className={clsx("mt-1.5 w-2 h-2 rounded-full shrink-0 ring-4", s.dot, s.dotRing)} aria-hidden />

        <div className="flex-1 min-w-0">
          {/* Eyebrow: severity + source + date */}
          <div className="flex items-center gap-2 flex-wrap text-[11px] text-ink-500 mb-1.5">
            <span className={clsx("px-1.5 py-0.5 rounded-md font-semibold uppercase tracking-wide", s.pill)}>
              {s.label}
            </span>
            {insight.source && (
              <span>
                <span className="text-ink-400">·</span> {insight.source}
              </span>
            )}
            {insight.source_date && (
              <span className="tabular-nums">
                <span className="text-ink-400">·</span> for {insight.source_date}
              </span>
            )}
            {insight.status && insight.status !== "open" && (
              <span className="text-ink-500">
                <span className="text-ink-400">·</span> {insight.status}
              </span>
            )}
          </div>

          {/* Title */}
          <h3 className="font-semibold text-ink-900 text-[15px] leading-snug group-hover:text-primary-800 transition-colors tracking-tight">
            {insight.title}
          </h3>

          {/* Body preview */}
          {insight.body && (
            <p className="text-sm text-ink-600 mt-1.5 line-clamp-2 leading-relaxed">{insight.body}</p>
          )}

          {/* Tags */}
          {insight.tags && insight.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-3">
              {insight.tags.slice(0, 6).map((t) => (
                <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-surface-muted text-ink-600 ring-1 ring-inset ring-hairline-subtle">
                  {t}
                </span>
              ))}
              {insight.tags.length > 6 && (
                <span className="text-[11px] text-ink-500">+{insight.tags.length - 6}</span>
              )}
            </div>
          )}
        </div>

        {/* Chevron */}
        {isInteractive && (
          <svg
            className="w-4 h-4 text-ink-400 group-hover:text-primary-600 group-hover:translate-x-0.5 mt-1 shrink-0 transition-all"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        )}
      </div>
    </button>
  );
}

/** Expose the severity tokens for the drawer / legends. */
export { SEVERITY_STYLES };

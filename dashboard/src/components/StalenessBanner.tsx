"use client";

/**
 * Data-freshness banner for the Overview page.
 *
 * Renders one row per stale source (GSC, Peec, content scrape) with a
 * per-source action hint. Behavior by action kind:
 *   - `refresh_topbar`: inline hint pointing up-right at the topbar's
 *     Refresh button — we don't embed a second Refresh button here
 *     because the one in the topbar is authoritative.
 *   - `claude`: copy-to-clipboard button that yanks a prewritten
 *     prompt the user can paste into Claude.
 *   - `link`: in-app navigation to the fix page (Settings → Data,
 *     Onboarding, etc.).
 *
 * If `alerts` is empty the component renders nothing — the whole
 * strip disappears once everything is fresh. No dismiss UI on purpose:
 * we WANT the user to act, not hide.
 */

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";

import type { StalenessAction, StalenessAlert, StalenessSeverity } from "@/lib/staleness";

export interface StalenessBannerProps {
  alerts: StalenessAlert[];
}

const SEVERITY_STYLES: Record<
  StalenessSeverity,
  { ring: string; bg: string; dot: string; pill: string; label: string }
> = {
  info: {
    ring: "ring-hairline-subtle",
    bg: "bg-surface-muted/60",
    dot: "bg-ink-500",
    pill: "bg-surface text-ink-700 ring-hairline-subtle",
    label: "Info",
  },
  warning: {
    ring: "ring-warning/25",
    bg: "bg-warning-50/80",
    dot: "bg-warning-500",
    pill: "bg-warning-50 text-warning-600 ring-warning/30",
    label: "Stale",
  },
  critical: {
    ring: "ring-danger/25",
    bg: "bg-danger-50/80",
    dot: "bg-danger-500",
    pill: "bg-danger-50 text-danger-600 ring-danger/30",
    label: "Critical",
  },
};

export function StalenessBanner({ alerts }: StalenessBannerProps) {
  if (alerts.length === 0) return null;

  // Highest severity drives the container's tint so the whole strip
  // carries the right visual weight at a glance.
  const topSeverity: StalenessSeverity = alerts.some((a) => a.severity === "critical")
    ? "critical"
    : alerts.some((a) => a.severity === "warning")
      ? "warning"
      : "info";
  const containerStyle = SEVERITY_STYLES[topSeverity];

  return (
    <section
      className={clsx(
        "mb-6 rounded-ds border ring-1 ring-inset",
        containerStyle.bg,
        containerStyle.ring,
        "border-transparent",
      )}
      aria-label="Data freshness alerts"
    >
      <header className="px-4 md:px-5 pt-4 pb-2 flex items-start gap-3">
        <WarningIcon className="w-4 h-4 text-ink-700 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink-900 leading-tight">
            Your data isn&apos;t fully up to date
          </h2>
          <p className="text-xs text-ink-600 mt-0.5 leading-relaxed">
            {alerts.length === 1
              ? "One source needs a refresh — follow the action below."
              : `${alerts.length} sources need a refresh — follow the actions below to catch up.`}
          </p>
        </div>
      </header>

      <ul className="px-4 md:px-5 pb-4 pt-1 space-y-2">
        {alerts.map((alert) => (
          <AlertRow key={alert.id} alert={alert} />
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------

function AlertRow({ alert }: { alert: StalenessAlert }) {
  const s = SEVERITY_STYLES[alert.severity];
  return (
    <li className="flex flex-col md:flex-row md:items-start gap-2 md:gap-4 bg-surface border border-hairline rounded-xl px-3.5 py-3 shadow-card">
      <div className="flex items-start gap-2.5 min-w-0 flex-1">
        <span className={clsx("w-2 h-2 rounded-full shrink-0 mt-1.5", s.dot)} aria-hidden />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={clsx("text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-md ring-1 ring-inset font-semibold", s.pill)}>
              {s.label}
            </span>
            <h3 className="text-sm font-semibold text-ink-900 leading-tight">
              {alert.title}
            </h3>
          </div>
          <p className="text-xs text-ink-600 mt-1 leading-relaxed">
            {alert.description}
          </p>
        </div>
      </div>
      <div className="md:self-center shrink-0">
        <ActionButton action={alert.action} />
      </div>
    </li>
  );
}

function ActionButton({ action }: { action: StalenessAction }) {
  if (action.kind === "refresh_topbar") {
    return (
      <div className="inline-flex items-center gap-1.5 text-xs text-ink-700 bg-surface border border-hairline rounded-lg px-3 py-1.5">
        <ArrowUpRightIcon className="w-3.5 h-3.5 text-primary-600" />
        <span>
          Click <strong className="text-ink-900">{action.label}</strong> in the topbar
        </span>
      </div>
    );
  }

  if (action.kind === "claude") {
    return <CopyPromptButton label={action.label} prompt={action.claude_prompt ?? ""} />;
  }

  if (action.kind === "link") {
    return (
      <Link
        href={action.href ?? "/"}
        className="inline-flex items-center gap-1.5 text-xs bg-primary-600 text-white px-4 py-1.5 rounded-full hover:bg-primary-700 shadow-card transition-all font-medium"
      >
        {action.label}
        <svg
          className="w-3 h-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </Link>
    );
  }

  return null;
}

function CopyPromptButton({ label, prompt }: { label: string; prompt: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers: select + execCommand. We skip that
      // and just leave the prompt visible below so the user can copy manually.
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <code className="text-[11px] bg-primary-950 text-primary-100 px-2 py-1 rounded-md font-mono max-w-[18rem] truncate">
        {prompt}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex items-center gap-1.5 text-xs bg-primary-600 text-white px-4 py-1.5 rounded-full hover:bg-primary-700 shadow-card transition-all font-medium"
      >
        {copied ? (
          <>
            <CheckIcon className="w-3 h-3" /> Copied
          </>
        ) : (
          <>
            <ClipboardIcon className="w-3 h-3" /> {label}
          </>
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------
// Icons (inline so we don't drag in a third-party icon library)
// ---------------------------------------------------------------------

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.7 3.86a2 2 0 00-3.4 0z" />
    </svg>
  );
}

function ArrowUpRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 17L17 7M17 7H9M17 7v8" />
    </svg>
  );
}

function ClipboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

"use client";

/**
 * Weekly Narrative — the most-recent Claude-written weekly summary.
 *
 * Reads `data/dashboard/insights.json`, finds the latest insight with
 * `source: "weekly-routine"` (created in the last 8 days), and renders
 * its body as a calm 2-paragraph card on the Overview page.
 *
 * If no recent weekly narrative exists, renders an empty-state CTA
 * pointing at the `/run weekly marketing report` Claude prompt. This
 * makes the freshness state explicit instead of silently rendering
 * stale or empty.
 */

import Link from "next/link";

import type { Insight } from "@/lib/types";

export interface WeeklyNarrativeProps {
  insights: Insight[];
}

/** Days a weekly narrative is considered "current". Past this, we
 *  prefer the empty state over rendering stale narrative. */
const FRESH_DAYS = 8;

export function WeeklyNarrative({ insights }: WeeklyNarrativeProps) {
  const narrative = pickLatestWeeklyNarrative(insights);

  if (!narrative) {
    return (
      <section className="mb-8 bg-surface-muted/30 border border-hairline rounded-2xl px-5 py-6 text-center">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500 mb-2">
          Weekly narrative
        </h2>
        <p className="text-sm text-ink-600 max-w-2xl mx-auto leading-relaxed">
          No fresh weekly narrative yet. Ask Claude{" "}
          <code className="font-mono text-[12px] bg-surface-muted px-1.5 py-0.5 rounded">
            run weekly marketing report
          </code>{" "}
          and the dashboard will pick up the resulting insight here.
        </p>
      </section>
    );
  }

  return (
    <section className="mb-8 bg-surface border border-hairline rounded-2xl shadow-card overflow-hidden">
      <header className="px-5 py-3.5 border-b border-hairline bg-surface-muted/30 flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
          Weekly narrative
        </h2>
        <span className="text-[11px] text-ink-500 tabular-nums">
          {narrative.source_date ?? narrative.created_at?.slice(0, 10)}
        </span>
      </header>
      <div className="px-5 py-4">
        <h3 className="text-base font-semibold text-ink-900 leading-snug">
          {narrative.title}
        </h3>
        {narrative.body && (
          <div className="mt-2 text-sm text-ink-700 whitespace-pre-wrap leading-relaxed">
            {narrative.body}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex flex-wrap gap-1.5">
            {(narrative.tags ?? []).slice(0, 5).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center text-[10px] uppercase tracking-[0.12em] font-semibold px-1.5 py-0.5 rounded bg-surface-muted text-ink-700 ring-1 ring-inset ring-hairline"
              >
                {tag}
              </span>
            ))}
          </div>
          <Link
            href="/strategy/findings"
            className="text-[11px] text-primary-700 hover:text-primary-900 font-medium inline-flex items-center gap-1 group"
          >
            View all findings
            <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>
              →
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}

function pickLatestWeeklyNarrative(insights: Insight[]): Insight | null {
  const cutoff = Date.now() - FRESH_DAYS * 24 * 60 * 60 * 1000;
  const candidates = insights
    .filter((i) => i.source === "weekly-routine")
    .filter((i) => {
      const t = Date.parse(i.created_at);
      return Number.isFinite(t) && t >= cutoff;
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return candidates[0] ?? null;
}

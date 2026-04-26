"use client";

import { useMemo } from "react";

import { InfoTooltip } from "@/components/InfoTooltip";
import { useTimeframe } from "@/components/TimeframeContext";
import type { TrendPoint } from "@/lib/types";

/**
 * Sanity-check strip above the Top Pages table.
 *
 * Aggregates the SEO totals (clicks, impressions, CTR) + GA sessions
 * + LLM sessions across the currently-selected window. Designed to be
 * pasted against GSC's Performance report and GA4's Acquisition report
 * for the same date range, so you can spot pipeline drift at a glance.
 *
 * Key design choices:
 * - Uses the `summary.seo.total_clicks` / `total_impressions` stream
 *   from the daily aggregate, NOT a sum of `top_pages_all_channels`.
 *   The top-N cutoff in the table (200 URLs) would understate totals
 *   for very-long-tail sites; GSC's own totals include every URL.
 * - Skips null days (stale GSC) when computing sums, so the numbers
 *   match what GSC actually reports for the same date range.
 * - CTR is weighted by impressions automatically via sum(clicks) /
 *   sum(impressions) — matches GSC's weighted CTR calculation.
 * - Date range is derived from the first/last non-null contribution
 *   so the label shows the real cross-check window (not the requested
 *   one, which may be longer than the data on disk).
 */

interface SummaryTotals {
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  ga_sessions: number | null;
  llm_sessions: number | null;
  days_with_gsc: number;
  days_with_ga: number;
  range_start: string | null;
  range_end: string | null;
}

function computeTotals(trend: TrendPoint[], windowDays: number): SummaryTotals {
  const slice = trend.slice(-windowDays);

  // GSC: sum clicks + impressions across days where both are non-null.
  let clicks = 0;
  let impressions = 0;
  let gscDays = 0;
  let gscStart: string | null = null;
  let gscEnd: string | null = null;
  for (const p of slice) {
    if (p.total_clicks === null || p.total_impressions === null) continue;
    clicks += p.total_clicks;
    impressions += p.total_impressions;
    gscDays += 1;
    if (gscStart === null) gscStart = p.date;
    gscEnd = p.date;
  }

  // GA4: sum sessions on days GA4 had data.
  let gaSessions = 0;
  let gaDays = 0;
  for (const p of slice) {
    if (p.sessions === null) continue;
    gaSessions += p.sessions;
    gaDays += 1;
  }

  // LLM: sum sessions (depends on GA4 being present).
  let llmSessions = 0;
  for (const p of slice) {
    if (p.llm_sessions === null) continue;
    llmSessions += p.llm_sessions;
  }

  const ctr = impressions > 0 ? (clicks / impressions) * 100 : null;

  return {
    clicks: gscDays > 0 ? clicks : null,
    impressions: gscDays > 0 ? impressions : null,
    ctr,
    ga_sessions: gaDays > 0 ? gaSessions : null,
    llm_sessions: gaDays > 0 ? llmSessions : null,
    days_with_gsc: gscDays,
    days_with_ga: gaDays,
    range_start: gscStart,
    range_end: gscEnd,
  };
}

export function TopPagesSummary({ trend }: { trend: TrendPoint[] }) {
  const { window } = useTimeframe();
  const totals = useMemo(() => computeTotals(trend, window), [trend, window]);

  const rangeLabel =
    totals.range_start && totals.range_end
      ? totals.range_start === totals.range_end
        ? formatShortDate(totals.range_start)
        : `${formatShortDate(totals.range_start)} → ${formatShortDate(totals.range_end)}`
      : "no GSC data in window";

  return (
    <div className="px-5 py-4 bg-surface-muted/40 border-b border-hairline">
      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-ink-500">
            Sanity check · totals over window
          </span>
          <InfoTooltip
            widthClass="w-80"
            label="About sanity check"
            content={
              <>
                These totals should match the <strong>Performance</strong> report in Google Search Console and the <strong>Acquisition</strong> report in GA4 when set to the same date range ({rangeLabel}).
                <br /><br />
                Sums are taken over the raw <code>summary.seo</code> / <code>summary.traffic</code> fields in each daily aggregate, NOT the capped Top Pages table — so they cover every URL, not just the top 200.
                <br /><br />
                Differences under ~2% are normal (GSC sampling, URL normalization, GA4 attribution windows). Bigger gaps indicate a pipeline issue.
              </>
            }
          />
        </div>
        <div className="text-[11px] text-ink-500 tabular-nums">
          {rangeLabel}
          {totals.days_with_gsc > 0 && (
            <span className="text-ink-400"> · {totals.days_with_gsc} day{totals.days_with_gsc === 1 ? "" : "s"} with GSC data</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
        <Stat
          label="SEO clicks"
          value={totals.clicks}
          accent="emerald"
          tooltip={<>GSC clicks summed across the window. Compare against GSC Performance → Total clicks for the same date range.</>}
        />
        <Stat
          label="SEO impressions"
          value={totals.impressions}
          accent="blue"
          tooltip={<>GSC impressions summed across the window. Compare against GSC Performance → Total impressions.</>}
        />
        <Stat
          label="CTR"
          value={totals.ctr}
          unit="%"
          precision={2}
          accent="slate"
          tooltip={<>Sum(clicks) ÷ sum(impressions) × 100. Matches GSC&apos;s weighted-CTR formula.</>}
        />
        <Stat
          label="GA sessions"
          value={totals.ga_sessions}
          accent="slate"
          tooltip={<>GA4 sessions summed across the window. Compare against GA4 Reports → Acquisition → Sessions.</>}
        />
        <Stat
          label="LLM sessions"
          value={totals.llm_sessions}
          accent="fuchsia"
          tooltip={<>Sessions referred from ChatGPT / Copilot / Perplexity / etc., summed across the window.</>}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------

function Stat({
  label,
  value,
  unit,
  precision = 0,
  accent = "slate",
  tooltip,
}: {
  label: string;
  value: number | null;
  unit?: string;
  precision?: number;
  accent?: "slate" | "emerald" | "blue" | "fuchsia";
  tooltip?: React.ReactNode;
}) {
  const colorCls = {
    slate:   "text-ink-900",
    emerald: "text-success-600",
    blue:    "text-primary-800",
    fuchsia: "text-accent-700",
  }[accent];

  const display =
    value === null
      ? "—"
      : value.toLocaleString(undefined, {
          minimumFractionDigits: precision,
          maximumFractionDigits: precision,
        });

  return (
    <div>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-ink-500 font-semibold">
        <span>{label}</span>
        {tooltip && <InfoTooltip size={10} widthClass="w-64" content={tooltip} label={`About ${label}`} />}
      </div>
      <div className={`text-lg font-semibold tabular-nums leading-tight tracking-tight ${colorCls} mt-0.5`}>
        {display}
        {unit && value !== null && <span className="text-sm font-normal text-ink-500 ml-0.5">{unit}</span>}
      </div>
    </div>
  );
}

function formatShortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, , mm, dd] = m;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${MONTHS[parseInt(mm, 10) - 1] ?? mm} ${parseInt(dd, 10)}`;
}

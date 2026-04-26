"use client";

/**
 * Overview Time Delta — three big numbers + week-over-week deltas.
 *
 * The Overview page is now the "what changed" surface, not a second
 * KPI dashboard (Strategy holds the framework-structured KPIs).
 * This component pulls the last 14 daily TrendPoints and computes
 * sum-aggregated last-7d-vs-prior-7d for the metrics that matter to
 * the daily check-in:
 *
 *   - Organic clicks  (Aleyda L3)
 *   - LLM sessions    (Aleyda L3 — direct AI attribution)
 *   - GEO score       (Aleyda L1 composite, averaged not summed)
 *
 * Each card shows the latest 7d total + delta vs the prior 7d. Tone
 * depends on direction × magnitude. If <14 days of data, we render
 * what we have and label "partial window".
 */

import { InfoTooltip } from "@/components/InfoTooltip";
import type { TrendPoint } from "@/lib/types";

export interface OverviewTimeDeltaProps {
  /** Last 14+ trend points, sorted ascending by date. */
  trend: TrendPoint[];
}

interface MetricSpec {
  key: keyof TrendPoint;
  label: string;
  aggregation: "sum" | "avg";
  /** How to format the value for display. */
  format: (v: number | null) => string;
  tooltip: string;
  /** When delta > 0, is that good? Some metrics flip (avg position would
   *  but we don't include it here). */
  upIsGood: boolean;
}

const METRICS: MetricSpec[] = [
  {
    key: "total_clicks",
    label: "Organic clicks",
    aggregation: "sum",
    format: (v) => (v === null ? "—" : v.toLocaleString()),
    tooltip: "GSC organic clicks summed over the last 7 days vs the prior 7. (Aleyda L3 / Impact.)",
    upIsGood: true,
  },
  {
    key: "llm_sessions",
    label: "LLM sessions",
    aggregation: "sum",
    format: (v) => (v === null ? "—" : v.toLocaleString()),
    tooltip: "GA4 sessions referred from AI tools (ChatGPT, Claude, Perplexity, Gemini, Copilot, etc.). The closest thing to direct AI attribution. (Aleyda L3.)",
    upIsGood: true,
  },
  {
    key: "geo_score",
    label: "GEO score",
    aggregation: "avg",
    format: (v) => (v === null ? "—" : v.toFixed(0)),
    tooltip: "Daily 0-100 composite of Peec visibility, share-of-voice, sentiment, and citation count, averaged over the last 7 days. (Aleyda L1 / Presence proxy.)",
    upIsGood: true,
  },
];

export function OverviewTimeDelta({ trend }: OverviewTimeDeltaProps) {
  if (trend.length === 0) {
    return null;
  }

  // Slice last 7 vs prior 7 (or whatever's available).
  const sorted = [...trend].sort((a, b) => a.date.localeCompare(b.date));
  const last7 = sorted.slice(-7);
  const prior7 = sorted.slice(-14, -7);
  const partialWindow = last7.length < 7 || prior7.length < 7;

  return (
    <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
      {METRICS.map((m) => {
        const latestVal = aggregate(last7, m.key, m.aggregation);
        const priorVal = aggregate(prior7, m.key, m.aggregation);
        const deltaPct =
          priorVal !== null && priorVal !== 0 && latestVal !== null
            ? ((latestVal - priorVal) / priorVal) * 100
            : null;
        const direction =
          deltaPct === null ? "flat"
          : Math.abs(deltaPct) < 1 ? "flat"
          : deltaPct > 0 ? "up"
          : "down";
        return (
          <DeltaTile
            key={m.key as string}
            metric={m}
            value={m.format(latestVal)}
            deltaPct={deltaPct}
            direction={direction}
            partialWindow={partialWindow}
          />
        );
      })}
    </section>
  );
}

function aggregate(
  points: TrendPoint[],
  key: keyof TrendPoint,
  mode: "sum" | "avg",
): number | null {
  const vals = points
    .map((p) => p[key])
    .filter((v): v is number => typeof v === "number");
  if (vals.length === 0) return null;
  if (mode === "sum") return vals.reduce((a, b) => a + b, 0);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function DeltaTile({
  metric,
  value,
  deltaPct,
  direction,
  partialWindow,
}: {
  metric: MetricSpec;
  value: string;
  deltaPct: number | null;
  direction: "up" | "down" | "flat";
  partialWindow: boolean;
}) {
  const isPositive =
    direction === "flat" ? "neutral"
    : direction === "up" ? (metric.upIsGood ? "good" : "bad")
    : (metric.upIsGood ? "bad" : "good");
  const deltaColor =
    isPositive === "good" ? "text-emerald-600"
    : isPositive === "bad" ? "text-danger-600"
    : "text-ink-500";
  const arrow =
    direction === "flat" ? "→"
    : direction === "up" ? "↑"
    : "↓";
  return (
    <article className="bg-surface border border-hairline rounded-2xl px-5 py-4 shadow-card">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-500">
          {metric.label}
        </span>
        <InfoTooltip widthClass="w-72" label={`About ${metric.label}`} content={metric.tooltip} />
      </div>
      <div className="flex items-baseline gap-3">
        <div className="font-display text-[28px] font-bold tabular-nums leading-none text-ink-900">
          {value}
        </div>
        {deltaPct !== null && (
          <div className={`text-sm font-semibold tabular-nums ${deltaColor}`}>
            {arrow} {Math.abs(deltaPct).toFixed(0)}%
          </div>
        )}
      </div>
      <p className="text-[11px] text-ink-500 mt-2 leading-relaxed">
        last 7 days vs prior 7
        {partialWindow && (
          <span className="text-warning-600"> · partial window</span>
        )}
      </p>
    </article>
  );
}

"use client";

import clsx from "clsx";

import { InfoTooltip } from "@/components/InfoTooltip";
import { useTimeframe } from "@/components/TimeframeContext";
import { computeWindowSnapshot } from "@/lib/window-snapshot";
import type {
  AggregationMode,
  TrendPoint,
  WindowSnapshot,
} from "@/lib/types";
import { useMemo, useState } from "react";

/**
 * Optional breakdown for composite scores (SEO / GEO).
 *
 * When provided, the card renders a "Show breakdown" toggle that
 * exposes each component's raw value, weight, and contribution to
 * the score. Audit fix #13 (B3) — keeps the at-a-glance composite
 * but makes it inspectable instead of opaque.
 */
export interface ScoreBreakdown {
  components: Array<{
    label: string;        // e.g. "Clicks"
    raw_value: string;    // e.g. "10" or "—"
    weight_pct: number;   // 0-100 — share of the total score
    contribution: number; // 0-100 — points this component added
    note?: string;        // e.g. "capped at 50/day", "neutral fallback (no data)"
  }>;
  total: number;          // 0-100 — should match `current` (latest-day score)
  source_date?: string;   // ISO date the raw values were measured on
  /** One-line context shown above the breakdown (e.g. "Latest day"). */
  caveat?: string;
}

type Accent = "blue" | "purple" | "fuchsia" | "emerald" | "slate" | "amber" | "red";

/**
 * Accent palette — maps logical accent names to the design tokens.
 * Each accent owns a literal Tailwind class path (no dynamic concat) so
 * the JIT compiler picks every class up.
 */
const ACCENT: Record<
  Accent,
  {
    glow: string;        // radial-gradient wash in the top-right corner
    ring: string;        // top edge accent line
    haloBg: string;
    haloText: string;
    value: string;
    spark: string;       // sparkline stroke color (inline hex)
  }
> = {
  blue: {
    glow:     "before:bg-gradient-to-br before:from-primary-100 before:to-transparent",
    ring:     "after:bg-primary-500",
    haloBg:   "bg-primary-50",
    haloText: "text-primary-700",
    value:    "text-primary-800",
    spark:    "#265B66",
  },
  purple: {
    glow:     "before:bg-gradient-to-br before:from-accent-100 before:to-transparent",
    ring:     "after:bg-accent-500",
    haloBg:   "bg-accent-50",
    haloText: "text-accent-700",
    value:    "text-accent-800",
    spark:    "#5754D5",
  },
  fuchsia: {
    glow:     "before:bg-gradient-to-br before:from-accent-100 before:to-transparent",
    ring:     "after:bg-accent-600",
    haloBg:   "bg-accent-50",
    haloText: "text-accent-600",
    value:    "text-accent-700",
    spark:    "#7B7ADE",
  },
  emerald: {
    glow:     "before:bg-gradient-to-br before:from-success-50 before:to-transparent",
    ring:     "after:bg-success-500",
    haloBg:   "bg-success-50",
    haloText: "text-success-600",
    value:    "text-success-600",
    spark:    "#16A34A",
  },
  slate: {
    glow:     "before:bg-gradient-to-br before:from-surface-muted before:to-transparent",
    ring:     "after:bg-ink-400",
    haloBg:   "bg-surface-muted",
    haloText: "text-ink-600",
    value:    "text-ink-900",
    spark:    "#64646C",
  },
  amber: {
    glow:     "before:bg-gradient-to-br before:from-warning-50 before:to-transparent",
    ring:     "after:bg-warning-500",
    haloBg:   "bg-warning-50",
    haloText: "text-warning-600",
    value:    "text-warning-600",
    spark:    "#D97706",
  },
  red: {
    glow:     "before:bg-gradient-to-br before:from-danger-50 before:to-transparent",
    ring:     "after:bg-danger-500",
    haloBg:   "bg-danger-50",
    haloText: "text-danger-500",
    value:    "text-danger-600",
    spark:    "#DC2626",
  },
};

type MetricKey = keyof Omit<TrendPoint, "date">;

export interface HistoricalMetricCardProps {
  label: string;
  trend: TrendPoint[];
  metricKey: MetricKey;
  aggregation: AggregationMode;
  accent?: Accent;
  unit?: string;
  higherIsBetter?: boolean;
  info?: React.ReactNode;
  glyph?: string;
  referenceDate?: string;
  /** When provided, renders a "How is this calculated?" toggle that
   *  reveals each component's contribution to the composite score. */
  breakdown?: ScoreBreakdown;
}

/**
 * Window-aware metric card.
 *
 * Visual additions over the previous version:
 *   - Soft radial wash in the top-right corner (accent-tinted).
 *   - Thin accent line along the top edge (tokenized, not border-left).
 *   - Inline sparkline of the selected-window values under the value.
 *   - Rounded-2xl corners + layered shadow-card / shadow-card-hover.
 */
export function HistoricalMetricCard({
  label,
  trend,
  metricKey,
  aggregation,
  accent = "slate",
  unit,
  higherIsBetter = true,
  info,
  glyph,
  referenceDate,
  breakdown,
}: HistoricalMetricCardProps) {
  const { window } = useTimeframe();
  const palette = ACCENT[accent];
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  const snapshot = useMemo<WindowSnapshot>(
    () => computeWindowSnapshot(trend, metricKey, window, aggregation),
    [trend, metricKey, window, aggregation],
  );
  const { current, current_date, prior, delta_pct, direction_7d, sample_size, per_day_avg } = snapshot;

  // Sparkline source: last `window` daily values from the trend.
  const sparkPoints = useMemo(() => {
    const slice = trend.slice(-window);
    return slice
      .map((p) => {
        const v = p[metricKey];
        return typeof v === "number" ? v : null;
      })
      .filter((v): v is number => v !== null);
  }, [trend, window, metricKey]);

  const displayValue =
    current === null
      ? "—"
      : current.toLocaleString(undefined, { maximumFractionDigits: 1 });

  const deltaIsGood =
    delta_pct === null
      ? null
      : higherIsBetter
      ? delta_pct > 0
      : delta_pct < 0;

  const deltaPill =
    delta_pct === null
      ? "bg-surface-muted text-ink-500"
      : deltaIsGood
      ? "bg-success-50 text-success-600 ring-1 ring-inset ring-success-500/20"
      : "bg-danger-50 text-danger-600 ring-1 ring-inset ring-danger-500/20";

  const dirArrow = direction_7d === "up" ? "↑" : direction_7d === "down" ? "↓" : direction_7d === "flat" ? "→" : "—";
  const dirIsGood =
    !direction_7d || direction_7d === "flat"
      ? null
      : (direction_7d === "up") === higherIsBetter;
  const dirPillCls =
    !direction_7d
      ? "bg-surface-muted text-ink-400"
      : direction_7d === "flat"
      ? "bg-surface-muted text-ink-500"
      : dirIsGood
      ? "bg-success-50 text-success-600 ring-1 ring-inset ring-success-500/15"
      : "bg-danger-50 text-danger-600 ring-1 ring-inset ring-danger-500/15";

  const dirTitle =
    direction_7d === "up"
      ? `7-day direction: up (${higherIsBetter ? "favorable" : "unfavorable"})`
      : direction_7d === "down"
      ? `7-day direction: down (${higherIsBetter ? "unfavorable" : "favorable"})`
      : direction_7d === "flat"
      ? "7-day direction: flat (within ±5%)"
      : "7-day direction: not enough history";

  const deltaTitle = delta_pct !== null
    ? `Current window total vs prior equal window. ${higherIsBetter ? "Higher is better." : "Lower is better."}`
    : "Not enough history to compute a prior-window baseline.";

  const isStale =
    !!referenceDate && !!current_date && current_date !== referenceDate;
  const staleChipLabel = current_date ? formatShortDate(current_date) : null;
  const staleTitle = current_date && referenceDate
    ? `Today's source data (${referenceDate}) hasn't landed yet. Showing the last confirmed value from ${current_date}.`
    : undefined;

  const footerLabel =
    aggregation === "sum" && per_day_avg !== null
      ? (
          <>
            avg{" "}
            <span className="text-ink-900 font-medium tabular-nums">
              {per_day_avg.toLocaleString(undefined, { maximumFractionDigits: 1 })}
            </span>
            <span className="text-ink-400">/day</span>
          </>
        )
      : current !== null
      ? <span className="text-ink-500 tabular-nums">{sample_size}d of data</span>
      : null;

  return (
    <div
      className={clsx(
        "relative isolate overflow-hidden rounded-ds bg-surface border border-hairline",
        "transition-all duration-200 hover:border-hairline-strong hover:-translate-y-0.5",
        "shadow-card hover:shadow-card-hover",
      )}
    >
      <div className="relative p-5">
        {/* Header: label (+ info) · glyph icon */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="text-[12px] font-medium text-ink-600 truncate">
              {label}
            </div>
            {info && <InfoTooltip content={info} label={`About ${label}`} />}
          </div>
          {glyph && (
            <div
              className={clsx(
                "w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0",
                palette.haloBg,
                palette.haloText,
              )}
              aria-hidden="true"
            >
              {glyph}
            </div>
          )}
        </div>

        {/* Hero value (display font) */}
        <div className="flex items-baseline gap-2 mb-3">
          <div className={clsx("font-display text-[28px] md:text-[32px] font-bold tabular-nums leading-none tracking-tight", palette.value)}>
            {displayValue}
          </div>
          {unit && current !== null && (
            <div className="text-sm font-normal text-ink-500 leading-none">{unit}</div>
          )}
          {isStale && staleChipLabel && (
            <span
              className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-warning-50 text-warning-600 ring-1 ring-inset ring-warning/30"
              title={staleTitle}
            >
              <span aria-hidden="true">⏳</span>
              <span>{staleChipLabel}</span>
            </span>
          )}
        </div>

        {/* Sparkline */}
        {sparkPoints.length > 2 && (
          <div className="mb-3 -mx-1 h-8">
            <Sparkline values={sparkPoints} color={palette.spark} />
          </div>
        )}

        {/* Footer: delta + 7d direction + per-day avg */}
        <div className="flex items-center justify-between gap-2 pt-3 border-t border-hairline-subtle">
          <div className="flex items-center gap-1.5">
            <span
              className={clsx(
                "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium tabular-nums",
                deltaPill,
              )}
              title={deltaTitle}
            >
              {delta_pct !== null && prior !== null
                ? `${delta_pct > 0 ? "+" : ""}${delta_pct.toFixed(1)}%`
                : "—"}
            </span>
            <span
              className={clsx(
                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 tabular-nums",
                dirPillCls,
              )}
              title={dirTitle}
            >
              <span aria-hidden="true">{dirArrow}</span>
              <span>7d</span>
            </span>
          </div>
          {footerLabel && (
            <span className="text-[11px] tabular-nums">
              {footerLabel}
            </span>
          )}
        </div>

        {/* Breakdown toggle + panel — only rendered when caller passes
            structured breakdown data (currently only the SEO + GEO
            composite score cards). Audit fix #13 (B3): the score is
            still a one-glance number but now click-to-inspect. */}
        {breakdown && (
          <div className="mt-3 pt-3 border-t border-hairline-subtle">
            <button
              type="button"
              onClick={() => setBreakdownOpen((v) => !v)}
              aria-expanded={breakdownOpen}
              className="text-[11px] font-medium text-primary-700 hover:text-primary-900 inline-flex items-center gap-1 transition-colors"
            >
              {breakdownOpen ? "Hide" : "How is this calculated?"}
              <span
                aria-hidden
                className={clsx(
                  "transition-transform inline-block",
                  breakdownOpen && "rotate-90",
                )}
              >
                ›
              </span>
            </button>

            {breakdownOpen && (
              <div className="mt-3 space-y-2">
                {breakdown.caveat && (
                  <p className="text-[10px] text-ink-500 italic leading-relaxed">
                    {breakdown.caveat}
                    {breakdown.source_date && (
                      <> · as of <span className="tabular-nums">{breakdown.source_date}</span></>
                    )}
                  </p>
                )}
                <ul className="space-y-1.5">
                  {breakdown.components.map((c) => (
                    <BreakdownRow
                      key={c.label}
                      component={c}
                      sparkColor={palette.spark}
                    />
                  ))}
                </ul>
                <div className="flex items-baseline justify-between pt-2 mt-1 border-t border-hairline-subtle">
                  <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-ink-500">
                    Total
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-ink-900">
                    {breakdown.total.toFixed(1)}{unit ?? ""}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One row in the breakdown panel — label, raw value, contribution bar,
 * weighted points contributed.
 */
function BreakdownRow({
  component,
  sparkColor,
}: {
  component: ScoreBreakdown["components"][number];
  sparkColor: string;
}) {
  // Bar width = contribution as % of total possible (which is the weight).
  // E.g. weight=40, contribution=8 → bar fills 20% of the row's bar area.
  const fillPct = component.weight_pct > 0
    ? Math.min(100, (component.contribution / component.weight_pct) * 100)
    : 0;
  return (
    <li className="flex items-center gap-2 text-[11px]">
      <span className="text-ink-700 min-w-[5rem] truncate" title={component.note}>
        {component.label}
      </span>
      <span className="tabular-nums text-ink-500 min-w-[3rem] text-right">
        {component.raw_value}
      </span>
      <div className="flex-1 h-1.5 bg-surface-muted rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            width: `${fillPct}%`,
            background: sparkColor,
            opacity: 0.85,
          }}
        />
      </div>
      <span
        className="tabular-nums text-ink-900 font-semibold min-w-[3.5rem] text-right"
        title={`Weight ${component.weight_pct}% · contributing ${component.contribution.toFixed(1)} of ${component.weight_pct} possible points`}
      >
        +{component.contribution.toFixed(1)}
      </span>
    </li>
  );
}

/**
 * Compact, dot-free sparkline rendered as inline SVG. Uses a smooth
 * polyline over normalized values; degrades gracefully for short slices.
 */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const W = 100;
  const H = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = W / (values.length - 1);

  const points = values.map((v, i) => {
    const x = i * step;
    const y = H - ((v - min) / range) * (H - 4) - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const path = `M ${points[0]} L ${points.slice(1).join(" L ")}`;
  const area = `${path} L ${W},${H} L 0,${H} Z`;
  const gradId = `spark-${color.replace("#", "")}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full overflow-visible">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function formatShortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, , mm, dd] = m;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = MONTHS[parseInt(mm, 10) - 1] ?? mm;
  return `${month} ${parseInt(dd, 10)}`;
}

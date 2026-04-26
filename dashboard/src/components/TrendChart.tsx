"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipProps } from "recharts";

import type { TrendPoint } from "@/lib/types";

/**
 * Interactive trend chart — raw daily values only.
 *
 * One timeframe control, owned by the topbar — the chart reflects
 * whatever window is selected there. Previously we also rendered a
 * Recharts `<Brush>` below the plot, which gave the user *two*
 * timeframe controls with conflicting semantics; removed.
 *
 * Interactivity:
 *   - Custom legend: click a chip to hide/show that series. Hidden
 *     chips dim the color swatch and the label. No strike-through —
 *     cleaner visual, and the dimmed state is already unambiguous.
 *   - Metrics pill (All / Scores / Traffic) still filters the family.
 *   - Hover shows a grouped, date-anchored custom tooltip with a
 *     vertical crosshair on the plot.
 */

type SeriesKey =
  | "seo_score"
  | "geo_score"
  | "llm_sessions"
  | "total_clicks";

type Family = "all" | "score" | "traffic";

interface SeriesSpec {
  key: SeriesKey;
  label: string;
  color: string;
  /** Accent bg used by the legend chip when that series is active. */
  chipBg: string;
  axis: "score" | "count";
  family: "score" | "traffic";
}

const SERIES: SeriesSpec[] = [
  { key: "seo_score",    label: "SEO",    color: "#2D6B78", chipBg: "rgba(45, 107, 120, 0.08)",  axis: "score", family: "score"   },
  { key: "geo_score",    label: "GEO",    color: "#5754D5", chipBg: "rgba(87, 84, 213, 0.08)",   axis: "score", family: "score"   },
  { key: "llm_sessions", label: "LLM",    color: "#8D8BE7", chipBg: "rgba(141, 139, 231, 0.08)", axis: "count", family: "traffic" },
  { key: "total_clicks", label: "Clicks", color: "#188999", chipBg: "rgba(24, 137, 153, 0.08)",  axis: "count", family: "traffic" },
];

export function TrendChart({ data }: { data: TrendPoint[] }) {
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());
  const [family, setFamily] = useState<Family>("all");

  // Family filter + per-series hide: both compose.
  const visibleSeries = useMemo(() => {
    return SERIES.filter((s) => {
      if (hidden.has(s.key)) return false;
      if (family !== "all" && s.family !== family) return false;
      return true;
    });
  }, [hidden, family]);

  // Render axes only when at least one visible line needs them. Avoids
  // an empty axis label hanging in the gutter when the user filters
  // down to a single family.
  const showScoreAxis = visibleSeries.some((s) => s.axis === "score");
  const showCountAxis = visibleSeries.some((s) => s.axis === "count");

  function toggleSeries(key: SeriesKey) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (!data || data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-ink-500 text-sm">
        No trend data yet.
      </div>
    );
  }

  // Smart tick spacing — with 7 days we want every day; with 30, show
  // every 3rd. Keeps the axis legible without overlap.
  const tickCadence = data.length <= 14 ? 1 : Math.ceil(data.length / 10);

  return (
    <div>
      {/* Top controls — family filter + custom interactive legend */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mb-5">
        <FamilyToggle value={family} onChange={setFamily} />
        <CustomLegend
          series={SERIES}
          hidden={hidden}
          family={family}
          onToggle={toggleSeries}
          onResetHidden={() => setHidden(new Set())}
        />
      </div>

      <ResponsiveContainer width="100%" height={340}>
        <LineChart data={data} margin={{ top: 12, right: 20, bottom: 8, left: 0 }}>
          {/* Subtle horizontal grid only — vertical lines felt noisy. */}
          <CartesianGrid
            stroke="#EDEDF0"
            strokeDasharray="2 4"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            stroke="transparent"
            tick={{ fill: "#9494A0", fontSize: 11 }}
            tickLine={false}
            tickMargin={10}
            interval={tickCadence - 1}
            tickFormatter={formatDateTick}
          />
          {showScoreAxis && (
            <YAxis
              yAxisId="score"
              domain={[0, 100]}
              stroke="transparent"
              tick={{ fill: "#9494A0", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              width={40}
            />
          )}
          {showCountAxis && (
            <YAxis
              yAxisId="count"
              orientation="right"
              stroke="transparent"
              tick={{ fill: "#9494A0", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              width={40}
              tickFormatter={formatCountTick}
            />
          )}
          <Tooltip
            content={<CustomTooltip />}
            cursor={{
              stroke: "#2D6B78",
              strokeDasharray: "2 4",
              strokeOpacity: 0.35,
              strokeWidth: 1,
            }}
          />
          {visibleSeries.map((s) => (
            <Line
              key={s.key}
              yAxisId={s.axis}
              type="monotone"
              dataKey={s.key}
              stroke={s.color}
              strokeWidth={2.25}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={{
                r: 5,
                strokeWidth: 2,
                stroke: "#ffffff",
                fill: s.color,
              }}
              name={s.label}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      <p className="text-[11px] text-ink-500 mt-3">
        Click a legend chip to hide that series · hover anywhere for details · window controlled by the topbar.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Family filter — All / Scores / Traffic
// ---------------------------------------------------------------------

function FamilyToggle({
  value,
  onChange,
}: {
  value: Family;
  onChange: (f: Family) => void;
}) {
  const options: { k: Family; l: string }[] = [
    { k: "all",     l: "All"     },
    { k: "score",   l: "Scores"  },
    { k: "traffic", l: "Traffic" },
  ];
  return (
    <div className="inline-flex bg-surface-muted rounded-lg p-0.5 border border-hairline">
      {options.map((o) => (
        <button
          key={o.k}
          type="button"
          onClick={() => onChange(o.k)}
          className={clsx(
            "px-3 py-1 text-xs rounded-md transition-all font-medium",
            value === o.k
              ? "bg-surface text-primary-800 shadow-card"
              : "text-ink-600 hover:text-ink-900",
          )}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// Custom legend — each chip is a real click target with a dimmed state.
// Replaced Recharts' built-in <Legend> so the interactive affordance
// is unambiguous: cursor: pointer, hover highlight, obvious dim when
// hidden.
// ---------------------------------------------------------------------

function CustomLegend({
  series,
  hidden,
  family,
  onToggle,
  onResetHidden,
}: {
  series: SeriesSpec[];
  hidden: Set<SeriesKey>;
  family: Family;
  onToggle: (k: SeriesKey) => void;
  onResetHidden: () => void;
}) {
  return (
    <div className="inline-flex items-center gap-1.5 flex-wrap">
      {series.map((s) => {
        const filteredOut = family !== "all" && s.family !== family;
        const isHidden = hidden.has(s.key);
        // Family-filtered series are visually de-emphasized but still
        // clickable — users can un-filter by clicking, same mental
        // model as the hide toggle.
        const dim = filteredOut || isHidden;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onToggle(s.key)}
            aria-pressed={!isHidden}
            disabled={filteredOut}
            className={clsx(
              "group inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium transition-all border",
              dim
                ? "border-hairline bg-surface text-ink-500 opacity-60"
                : "border-transparent text-ink-900 hover:bg-surface-muted",
              filteredOut && "cursor-not-allowed",
              !filteredOut && "cursor-pointer",
            )}
            style={!dim ? { backgroundColor: s.chipBg } : undefined}
            title={
              filteredOut
                ? `Switch Metrics to "All" or "${s.family === "score" ? "Scores" : "Traffic"}" to show ${s.label}`
                : isHidden
                  ? `Show ${s.label}`
                  : `Hide ${s.label}`
            }
          >
            <span
              className={clsx(
                "w-2.5 h-2.5 rounded-full shrink-0 transition-all",
                dim && "ring-1 ring-inset ring-hairline",
              )}
              style={{
                background: dim ? "transparent" : s.color,
                borderColor: s.color,
              }}
              aria-hidden
            />
            <span>{s.label}</span>
          </button>
        );
      })}
      {hidden.size > 0 && (
        <button
          type="button"
          onClick={onResetHidden}
          className="ml-1 text-[11px] text-primary-700 hover:text-primary-900 underline decoration-dotted underline-offset-2 font-medium"
        >
          Show all
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Custom tooltip — grouped by axis so scores and counts sit side by side.
// ---------------------------------------------------------------------

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;

  const rows = payload
    .filter((p) => p.value !== null && p.value !== undefined)
    .map((p) => {
      const dk = typeof p.dataKey === "string" ? (p.dataKey as SeriesKey) : undefined;
      const spec = dk ? SERIES.find((s) => s.key === dk) : undefined;
      const rawValue = Array.isArray(p.value) ? p.value[0] : p.value;
      return {
        name: (p.name as string) ?? (dk as string) ?? "value",
        value: typeof rawValue === "number" ? rawValue : Number(rawValue),
        color: (p.color as string) ?? spec?.color ?? "#64748b",
        axis: spec?.axis ?? "count",
      };
    });

  const scoreRows = rows.filter((r) => r.axis === "score");
  const countRows = rows.filter((r) => r.axis === "count");

  return (
    <div className="bg-surface border border-hairline rounded-xl shadow-pop px-3.5 py-2.5 text-xs min-w-[11rem]">
      <div className="font-semibold text-ink-900 mb-2 pb-2 border-b border-hairline tabular-nums">
        {formatTooltipDate(typeof label === "string" ? label : String(label))}
      </div>
      {scoreRows.length > 0 && (
        <TooltipSection title="Scores (0–100)" rows={scoreRows} />
      )}
      {countRows.length > 0 && (
        <TooltipSection
          title="Counts"
          rows={countRows}
          className={clsx(scoreRows.length > 0 && "mt-2 pt-2 border-t border-hairline")}
        />
      )}
    </div>
  );
}

function TooltipSection({
  title,
  rows,
  className,
}: {
  title: string;
  rows: { name: string; value: number; color: string }[];
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-[10px] uppercase tracking-[0.12em] text-ink-500 mb-1.5 font-semibold">{title}</div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center justify-between gap-5">
            <span className="flex items-center gap-2 text-ink-700">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color }} />
              {r.name}
            </span>
            <span className="font-semibold text-ink-900 tabular-nums">
              {r.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------

/** "2026-04-23" → "Apr 23". Compact + locale-safe. */
function formatDateTick(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "2026-04-23" → "Wed, Apr 23, 2026" in the tooltip header. */
function formatTooltipDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** 1230 → "1.2k". Keeps the right Y-axis scannable on thousands-scale data. */
function formatCountTick(value: number): string {
  const n = Math.abs(value);
  if (n >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(value / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(value);
}

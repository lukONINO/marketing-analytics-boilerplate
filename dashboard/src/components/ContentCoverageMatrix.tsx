"use client";

/**
 * Content Coverage Matrix — AI visibility (Y) × SEO presence (X).
 *
 * Each dot = one (cluster, lang). Quadrants sliced at 50/50:
 *   ┌──────────────┬──────────────┐
 *   │  AI-only     │  Compounding │   ← AI ≥ 50
 *   ├──────────────┼──────────────┤
 *   │  Blind spot  │  SEO-only    │   ← AI < 50
 *   └──────────────┴──────────────┘
 *      SEO < 50         SEO ≥ 50
 *
 * The pattern of dots tells the user where each cluster is *strong vs.
 * weak across both channels at once*. Most dashboards show SEO and AI
 * in separate panels; that hides the more interesting patterns:
 *   • Blind spots (low/low) — neither channel reaches users
 *   • SEO-only — content ranks but AI never cites it (citeability gap)
 *   • AI-only — AI loves us, but no organic traffic flows in
 *   • Compounding — both channels working, defend and scale
 *
 * Implementation note: the quadrant overlay is a separate absolutely-
 * positioned div *behind* the chart's plot area. We do this rather
 * than Recharts' built-in `<Customized/>` because it lets us use real
 * Tailwind utilities for the tinting + labels (rather than inline SVG).
 */

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { TooltipProps } from "recharts";
import clsx from "clsx";

import { InfoTooltip } from "@/components/InfoTooltip";
import type { CoveragePoint } from "@/lib/framework";
import { QUADRANT_META, summarizeCoverage } from "@/lib/framework";

// Per-quadrant explainers — used in the chip-level InfoTooltips. Each
// adds the "what to do about it" context the short description in the
// QUADRANT_META can't fit.
const QUADRANT_TOOLTIPS: Record<CoveragePoint["quadrant"], React.ReactNode> = {
  compounding: (
    <>
      <strong>The dream state.</strong> Both AI and Google are bringing
      traffic for these clusters — every page-view comes from two
      compounding channels.
      <br /><br />
      <strong>What to do:</strong> defend (don&apos;t neglect maintenance,
      keep schema/citations fresh) and scale (ICP-specific landing pages,
      more content depth on what&apos;s already working).
    </>
  ),
  ai_only: (
    <>
      <strong>AI loves us, Google ignores us.</strong> AI assistants
      surface your brand when answering these questions, but the same queries
      don&apos;t bring organic search traffic.
      <br /><br />
      <strong>What to do:</strong> reverse-engineer the SEO. Look at what
      AI cites us for, then check whether those URLs are actually
      indexable, mobile-friendly, and ranking. Often a small SEO fix
      unlocks a lot of latent demand.
    </>
  ),
  seo_only: (
    <>
      <strong>Google ranks us, AI ignores us.</strong> The cluster gets
      organic traffic, but AI never reaches for our pages when answering
      related questions.
      <br /><br />
      <strong>What to do:</strong> add citation hooks. AI tends to cite
      pages with named authors, numeric claims, schema markup, and
      explicit comparisons. Pure brochure-style copy ranks fine but
      doesn&apos;t get cited.
    </>
  ),
  blind_spot: (
    <>
      <strong>Invisible on both channels.</strong> Neither AI nor Google
      surfaces our pages for this cluster.
      <br /><br />
      <strong>What to do:</strong> hard call. Either kill the cluster
      (consolidate into a stronger one) or rebuild it from scratch with
      a single substantial pillar page that covers the topic deeply.
      Trying to half-rescue blind-spot clusters with thin content
      almost never works.
    </>
  ),
};

export interface ContentCoverageMatrixProps {
  points: CoveragePoint[];
}

const LANG_COLOR: Record<"en" | "de", string> = {
  en: "#2D6B78", // primary teal
  de: "#5754D5", // accent purple
};

type LangFilter = "all" | "en" | "de";

// Plot-area margins. Held as a const so the QuadrantBackdrop and the
// chart can stay in lock-step — every change has to update both.
const PLOT_MARGIN = { top: 24, right: 32, bottom: 56, left: 64 };

export function ContentCoverageMatrix({ points }: ContentCoverageMatrixProps) {
  const [langFilter, setLangFilter] = useState<LangFilter>("all");
  const summary = summarizeCoverage(points);

  // Deterministic jitter so dots that share coordinates fan out a couple
  // of percent instead of stacking into one indistinguishable blob. The
  // jitter is keyed off cluster+lang so it's stable between renders and
  // the same point doesn't move when the user hovers it.
  const jitteredPoints = useMemo(() => {
    return points.map((p) => {
      const seed = hash32(`${p.cluster}|${p.lang}`);
      // ±1.4 on each axis — invisible on a single dot, but enough to
      // separate two dots that would otherwise sit on top of each other.
      const dx = ((seed & 0xff) / 255 - 0.5) * 2.8;
      const dy = (((seed >> 8) & 0xff) / 255 - 0.5) * 2.8;
      return {
        ...p,
        seo_score: clamp(p.seo_score + dx, 0, 100),
        ai_score: clamp(p.ai_score + dy, 0, 100),
      };
    });
  }, [points]);

  const enPoints = useMemo(
    () => jitteredPoints.filter((p) => p.lang === "en"),
    [jitteredPoints],
  );
  const dePoints = useMemo(
    () => jitteredPoints.filter((p) => p.lang === "de"),
    [jitteredPoints],
  );

  const showEn = langFilter === "all" || langFilter === "en";
  const showDe = langFilter === "all" || langFilter === "de";

  if (points.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-ink-500 text-sm">
        No cluster data yet — run a content scrape and refresh aggregates.
      </div>
    );
  }

  return (
    <div>
      {/* Quadrant summary chips above the chart */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {summary.map((q) => {
          const meta = QUADRANT_META[q.quadrant];
          const tone = TONE_STYLES[meta.tone];
          return (
            <div
              key={q.quadrant}
              className={clsx(
                "rounded-xl border px-3.5 py-3 text-xs",
                tone.bg,
                tone.border,
              )}
            >
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span
                  className={clsx(
                    "text-[10px] uppercase tracking-[0.14em] font-semibold inline-flex items-center gap-1",
                    tone.label,
                  )}
                >
                  {meta.label}
                  <InfoTooltip
                    widthClass="w-72"
                    label={`About the ${meta.label} quadrant`}
                    content={QUADRANT_TOOLTIPS[q.quadrant]}
                  />
                </span>
                <span className={clsx("text-base font-semibold tabular-nums", tone.count)}>
                  {q.count}
                </span>
              </div>
              <p className="text-ink-600 leading-snug">{meta.description}</p>
            </div>
          );
        })}
      </div>

      {/* Language filter — interactive chips. "All" is the default;
          clicking English or German isolates that language so dots stop
          stacking on top of each other. */}
      <div className="flex items-center justify-end gap-2 mb-2">
        <span className="text-[11px] text-ink-500">Show:</span>
        <LangChip
          active={langFilter === "all"}
          onClick={() => setLangFilter("all")}
          label="All"
        />
        <LangChip
          active={langFilter === "en"}
          onClick={() => setLangFilter("en")}
          label="English"
          dotColor={LANG_COLOR.en}
        />
        <LangChip
          active={langFilter === "de"}
          onClick={() => setLangFilter("de")}
          label="German"
          dotColor={LANG_COLOR.de}
        />
      </div>

      {/* Chart wrapper with quadrant backdrop. We deliberately don't
          set overflow-hidden here — the Recharts tooltip is absolutely
          positioned inside this container and would be clipped on the
          right/bottom edges if we did. */}
      <div className="relative bg-surface border border-hairline rounded-2xl">
        <QuadrantBackdrop />

        <ResponsiveContainer width="100%" height={420}>
          <ScatterChart margin={PLOT_MARGIN}>
            <CartesianGrid stroke="#EDEDF0" strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="seo_score"
              name="SEO presence"
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tick={{ fill: "#9494A0", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              label={{
                value: "SEO presence (clicks + impressions, log-normalised)",
                position: "insideBottom",
                offset: -8,
                fill: "#64646C",
                fontSize: 11,
              }}
            />
            <YAxis
              type="number"
              dataKey="ai_score"
              name="AI visibility"
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tick={{ fill: "#9494A0", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v}%`}
              // Short label — the long-form explanation lives in the
              // section description and the axis-note caption.
              label={{
                value: "AI visibility (% of prompts)",
                angle: -90,
                position: "insideLeft",
                fill: "#64646C",
                fontSize: 11,
                offset: 0,
                style: { textAnchor: "middle" },
              }}
            />
            {/* Z controls dot size — based on page count. Wider range
                means denser clusters pop. */}
            <ZAxis type="number" dataKey="page_count" range={[80, 360]} name="pages" />
            <Tooltip
              cursor={{ strokeDasharray: "3 3", stroke: "#2D6B78", strokeOpacity: 0.4 }}
              content={<CoverageTooltip />}
              // pointerEvents:none keeps the tooltip from intercepting
              // hover on the dot underneath. Default offset is set to 0
              // because <CoverageTooltip /> applies its own edge-aware
              // transform (see comment in that component).
              wrapperStyle={{ outline: "none", pointerEvents: "none" }}
              allowEscapeViewBox={{ x: true, y: true }}
              offset={0}
            />
            <ReferenceLine
              x={50}
              stroke="#B8B9B6"
              strokeDasharray="4 6"
              strokeWidth={1}
              ifOverflow="extendDomain"
            />
            <ReferenceLine
              y={50}
              stroke="#B8B9B6"
              strokeDasharray="4 6"
              strokeWidth={1}
              ifOverflow="extendDomain"
            />
            {showEn && (
              <Scatter
                name="English"
                data={enPoints}
                fill={LANG_COLOR.en}
                fillOpacity={0.78}
                stroke="#ffffff"
                strokeWidth={1.5}
              />
            )}
            {showDe && (
              <Scatter
                name="German"
                data={dePoints}
                fill={LANG_COLOR.de}
                fillOpacity={0.78}
                stroke="#ffffff"
                strokeWidth={1.5}
              />
            )}
          </ScatterChart>
        </ResponsiveContainer>

        {/* Footer caption — the legend now lives in the active toggles
            above, so this row only needs the dot-size hint. */}
        <div className="px-5 pb-4 -mt-2 text-[11px] text-ink-500">
          Dot size = pages assigned · Hover for cluster detail
        </div>
      </div>

      {/* Axis-scale caveat — the two axes use different math, so a dot
          at (50, 50) doesn't mean "equal performance on both channels".
          Made explicit so users don't read the matrix incorrectly.
          Audit fix #9 (2026-04-26). */}
      <p className="text-[11px] text-ink-500 mt-3 leading-relaxed max-w-3xl">
        <strong className="text-ink-700">Axis note:</strong> AI is a linear share
        (50 = your brand appears in 50% of prompts). SEO is a log-normalised composite
        of clicks + impressions, tuned for typical small-to-medium scale (50 ≈ 100
        weighted units, 100 ≈ 10,000). The two scales aren&apos;t directly
        comparable — &quot;50 on AI&quot; isn&apos;t the same achievement as
        &quot;50 on SEO&quot;. Use the quadrants for direction, not the
        coordinates for absolute comparisons.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Language filter chip
// ---------------------------------------------------------------------

function LangChip({
  active,
  onClick,
  label,
  dotColor,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  dotColor?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors border",
        active
          ? "bg-ink-900 text-white border-ink-900"
          : "bg-surface text-ink-600 border-hairline hover:bg-surface-muted hover:text-ink-900",
      )}
    >
      {dotColor && (
        <span
          className="w-2 h-2 rounded-full"
          style={{ background: dotColor }}
          aria-hidden
        />
      )}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------
// Quadrant backdrop — fixed-position labels behind the dots.
// Labels live in the *centre-top / centre-bottom* of each quadrant
// rather than the corners so they never collide with the rotated
// Y-axis label or the X-axis tick numbers (audit fix, 2026-04-26).
// ---------------------------------------------------------------------

function QuadrantBackdrop() {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      // Inset matches the ResponsiveContainer's plot margin so labels
      // sit IN the plot area (not in the axis gutters).
      style={{
        paddingTop: PLOT_MARGIN.top,
        paddingRight: PLOT_MARGIN.right,
        paddingBottom: PLOT_MARGIN.bottom,
        paddingLeft: PLOT_MARGIN.left,
      }}
      aria-hidden
    >
      <div className="relative w-full h-full">
        {/* Top-left quadrant = AI-only. Centred at 25% horizontal so
            it sits between the Y-axis label and the centre divider. */}
        <div
          className="absolute top-2 text-[10px] uppercase tracking-[0.16em] text-ink-400 font-semibold -translate-x-1/2"
          style={{ left: "25%" }}
        >
          AI-only
        </div>
        {/* Top-right quadrant = Compounding. Centred at 75%. */}
        <div
          className="absolute top-2 text-[10px] uppercase tracking-[0.16em] text-emerald-600 font-semibold -translate-x-1/2"
          style={{ left: "75%" }}
        >
          Compounding
        </div>
        {/* Bottom-left quadrant = Blind spot. Centred at 25%. */}
        <div
          className="absolute bottom-2 text-[10px] uppercase tracking-[0.16em] text-red-600/80 font-semibold -translate-x-1/2"
          style={{ left: "25%" }}
        >
          Blind spot
        </div>
        {/* Bottom-right quadrant = SEO-only. Centred at 75%. */}
        <div
          className="absolute bottom-2 text-[10px] uppercase tracking-[0.16em] text-amber-700 font-semibold -translate-x-1/2"
          style={{ left: "75%" }}
        >
          SEO-only
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Tooltip — show raw metrics, not just the normalised scores, so the
// user can see whether a cluster's "low SEO" is 0 clicks or 5 clicks.
//
// Edge-aware placement: the tooltip flips left/up when the cursor is
// past the chart's midpoint on the corresponding axis. Without this,
// hovering a dot near the right edge of a wide chart pushes the tooltip
// off the page (the chart's wrapper has overflow:visible to allow
// escaping the rounded container, but that just means the overflow
// goes into the page gutter / off-screen). Recharts' default `offset`
// is set to 0 on the <Tooltip> so the transform here is the only
// positioning logic — the wrapper itself sits at the cursor.
// ---------------------------------------------------------------------

const TOOLTIP_GAP_PX = 14;

function CoverageTooltip({
  active,
  payload,
  coordinate,
  viewBox,
}: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]?.payload as CoveragePoint | undefined;
  if (!p) return null;
  const meta = QUADRANT_META[p.quadrant];

  // Plot-area midpoints. viewBox is the chart's content rectangle
  // (excludes axis gutters); coordinate is the cursor in chart pixels.
  const cursorX = coordinate?.x ?? 0;
  const cursorY = coordinate?.y ?? 0;
  const plotMidX = (viewBox?.x ?? 0) + (viewBox?.width ?? 0) / 2;
  const plotMidY = (viewBox?.y ?? 0) + (viewBox?.height ?? 0) / 2;
  const flipLeft = cursorX > plotMidX;
  const flipUp = cursorY > plotMidY;

  // translate(-100% - gap) shifts the tooltip fully to the left of the
  // wrapper origin (cursor); translate(gap) keeps it to the right.
  // Same logic vertical. The sign flip on each axis is independent so
  // we cover all four corners of the chart correctly.
  const tx = flipLeft ? `calc(-100% - ${TOOLTIP_GAP_PX}px)` : `${TOOLTIP_GAP_PX}px`;
  const ty = flipUp ? `calc(-100% - ${TOOLTIP_GAP_PX}px)` : `${TOOLTIP_GAP_PX}px`;

  return (
    <div
      className="rounded-xl border border-hairline shadow-pop px-3.5 py-2.5 text-xs min-w-[14rem] max-w-[18rem]"
      style={{
        backgroundColor: "#ffffff",
        color: "#111111",
        opacity: 1,
        transform: `translate(${tx}, ${ty})`,
      }}
    >
      <div className="flex items-baseline justify-between gap-3 mb-2 pb-2 border-b border-hairline">
        <strong className="text-ink-900 leading-tight">{p.cluster_display}</strong>
        <span className="text-[10px] uppercase tracking-wider text-ink-500 font-medium">
          {p.lang}
        </span>
      </div>

      <div className="space-y-1.5 mb-2">
        <Row label="AI visibility" value={`${(p.ai_visibility * 100).toFixed(0)}%`} sub={`${p.ai_mentions} mentions`} />
        <Row label="SEO clicks" value={p.seo_clicks.toLocaleString()} sub={`${p.seo_impressions.toLocaleString()} imp.`} />
        <Row label="GA views" value={p.ga_views.toLocaleString()} />
        <Row label="Pages" value={String(p.page_count)} />
      </div>

      <div className="pt-2 border-t border-hairline">
        <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold mb-0.5">
          {meta.label}
        </div>
        <p className="text-[11px] text-ink-600 leading-snug">{meta.description}</p>
      </div>
    </div>
  );
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-ink-600">{label}</span>
      <span className="text-right">
        <span className="font-semibold text-ink-900 tabular-nums">{value}</span>
        {sub && <span className="ml-1.5 text-[10px] text-ink-500 tabular-nums">{sub}</span>}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------
// Tone palette for the four quadrant summary chips
// ---------------------------------------------------------------------

const TONE_STYLES = {
  good: {
    bg: "bg-emerald-50/70",
    border: "border-emerald-200",
    label: "text-emerald-700",
    count: "text-emerald-700",
  },
  info: {
    bg: "bg-primary-50/70",
    border: "border-primary-200",
    label: "text-primary-700",
    count: "text-primary-700",
  },
  warn: {
    bg: "bg-warning-50/60",
    border: "border-warning/30",
    label: "text-warning-600",
    count: "text-warning-600",
  },
  bad: {
    bg: "bg-danger-50/60",
    border: "border-danger/30",
    label: "text-danger-600",
    count: "text-danger-600",
  },
} as const;

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// FNV-1a 32-bit. Tiny, deterministic, no deps — used to seed jitter
// from the cluster+lang key so a dot's position is stable between
// renders.
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

import { InfoTooltip } from "@/components/InfoTooltip";
import { OverviewTimeDelta } from "@/components/OverviewTimeDelta";
import { RecentAnomalies } from "@/components/RecentAnomalies";
import { StalenessBanner } from "@/components/StalenessBanner";
import { TopPagesSummary } from "@/components/TopPagesSummary";
import { TopPagesTable } from "@/components/TopPagesTable";
import { TrendChartSection } from "@/components/TrendChartSection";
import { WeeklyNarrative } from "@/components/WeeklyNarrative";
import {
  loadDailyPagesSlices,
  loadInsights,
  loadLatestDaily,
  loadTrend,
} from "@/lib/data";
import { computeStalenessAlerts } from "@/lib/staleness";

/**
 * Overview — the daily check-in surface.
 *
 * Reoriented 2026-04-26 from "second KPI dashboard" to "what changed".
 * The framework-structured KPIs (Aleyda · Malte) live on /strategy;
 * this page is for the operator's morning glance: what's stale, what
 * moved this week, what's the most recent Claude narrative, what
 * needs attention.
 *
 * Surfaces (top to bottom):
 *   1. <StalenessBanner>         — only renders when something's stale
 *   2. <OverviewTimeDelta>       — 3 hero numbers w/w (clicks, LLM, GEO)
 *   3. <WeeklyNarrative>         — latest weekly-routine insight body
 *   4. <RecentAnomalies>         — last 7d warning + critical insights
 *   5. <TrendChartSection>       — full 30d trend across core metrics
 *   6. <TopPagesTable>           — cross-channel page leaders
 *
 * What's gone vs. the previous version:
 *   - 6-tile KPI grid (SEO/GEO/LLM/Clicks/Sessions/Conversions) — those
 *     are now the framework KPI strip on /strategy
 *   - 5-insight + 5-task teasers — replaced by WeeklyNarrative +
 *     RecentAnomalies, both of which actually narrate why the user
 *     should care, instead of dumping raw cards
 */

export const dynamic = "force-dynamic";

const METRIC_INFO = {
  chart: (
    <>
      <strong>Daily values for the four core metrics.</strong>
      <br /><br />
      Each line is one metric over the timeframe in the topbar. The
      left axis (0–100) is for scores; the right axis (count) is for
      session/click totals. Use the Metrics pill to focus on Scores
      or Traffic only. Click a legend chip to hide that line.
    </>
  ),
  topPages: (
    <>
      <strong>Pages winning across multiple channels.</strong>
      <br /><br />
      URLs ranked by a composite score across all four channels —
      Google clicks, GA visits, AI-tool sessions, and Peec citations.
      Values are summed across the timeframe so the latest day&apos;s
      Google-Search-Console reporting lag doesn&apos;t zero out a page
      that had real traffic earlier. Pages winning on multiple
      channels are compounding; single-channel pages are either
      investments to make or candidates to deprioritise.
    </>
  ),
};

export default async function OverviewPage() {
  const daily = await loadLatestDaily();
  const trend = await loadTrend(30); // full 30d; client slices to selected window
  const pageSlices = await loadDailyPagesSlices(30); // for the windowed Top Pages table
  const insights = (await loadInsights()).insights;
  const stalenessAlerts = await computeStalenessAlerts();

  if (!daily || trend.length === 0) {
    return (
      <div className="bg-warning-50 border border-warning/25 rounded-ds p-8 text-center shadow-card">
        <p className="text-ink-900 font-semibold">No daily data yet.</p>
        <p className="text-ink-600 text-sm mt-2 leading-relaxed max-w-xl mx-auto">
          Click <strong className="text-ink-900">Refresh data</strong> in the top right to pull the last 7 days, or in a Claude Code / Cowork
          session say <code className="bg-surface-muted border border-hairline text-primary-700 px-1.5 py-0.5 rounded font-mono text-[12px]">run daily marketing report for yesterday</code>.
        </p>
      </div>
    );
  }

  const [dailyDate, d] = daily;
  const dupes = d.cross_channel?.normalization_duplicates?.length ?? 0;

  return (
    <>
      {/* Top-of-page freshness banner. Renders nothing when every source
          is within its acceptable lag window. Replaced the earlier inline
          "today's GSC hasn't landed" warning — the staleness helper
          covers that case (GSC >3 days behind) plus the multi-day gap
          we were missing. Placed above the header so it's the first
          thing the user sees when any action is needed. */}
      <StalenessBanner alerts={stalenessAlerts} />

      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-700 bg-primary-50 px-2 py-0.5 rounded-md ring-1 ring-inset ring-primary-200">
              Overview
            </span>
            {trend.length < 30 && (
              <span className="text-[10px] font-medium uppercase tracking-wider text-ink-500 bg-surface-muted px-2 py-0.5 rounded-md ring-1 ring-inset ring-hairline">
                {trend.length} days captured
              </span>
            )}
          </div>
          <h1 className="font-display text-[28px] md:text-[32px] font-bold tracking-tight text-ink-900">
            What changed this week
          </h1>
          <p className="text-sm text-ink-600 mt-2 leading-relaxed max-w-3xl">
            Latest data: <strong className="text-ink-900 tabular-nums">{dailyDate}</strong>
            {d.sources_missing.length > 0 && (
              <span className="text-warning-600">
                {" "}· Missing data sources: {d.sources_missing.join(", ")}
              </span>
            )}
            . The framework-structured KPIs (Aleyda · Malte) and the action stream live on{" "}
            <a href="/strategy" className="text-primary-700 hover:text-primary-900 underline decoration-dotted underline-offset-2">
              Strategy
            </a>
            . This page is for the morning check-in: what moved, what Claude wrote, what needs attention.
          </p>
        </div>
        {dupes > 0 && (
          <span className="bg-danger-50 text-danger-600 text-xs px-2.5 py-1.5 rounded-lg ring-1 ring-inset ring-danger/20 shrink-0 font-medium">
            ⚠ Normalization duplicates: {dupes}
          </span>
        )}
      </div>

      {/* Hero deltas — what moved last 7d vs prior 7d */}
      <OverviewTimeDelta trend={trend} />

      {/* Latest weekly narrative (Claude weekly-routine output) +
          recent anomalies (last 7d warning/critical). Two parallel
          surfaces: narrative explains the week qualitatively;
          anomalies surface time-sensitive items. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <WeeklyNarrative insights={insights} />
        <RecentAnomalies insights={insights} />
      </div>

      {/* Trend chart — respects the topbar window */}
      {trend.length > 0 && (
        <section className="bg-surface rounded-ds border border-hairline shadow-card p-6 mb-8">
          <div className="flex items-center gap-1.5 mb-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
              Trend
            </h2>
            <InfoTooltip content={METRIC_INFO.chart} widthClass="w-72" />
          </div>
          <TrendChartSection data={trend} />
        </section>
      )}

      {/* Cross-channel top pages */}
      {pageSlices.length > 0 && (
        <section className="bg-surface rounded-ds border border-hairline shadow-card mb-8 overflow-hidden">
          <div className="border-b border-hairline px-5 py-3.5 flex items-center gap-1.5 bg-surface-muted/30">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
              Top pages across all channels
            </h2>
            <InfoTooltip content={METRIC_INFO.topPages} widthClass="w-72" />
          </div>
          <TopPagesSummary trend={trend} />
          <TopPagesTable slices={pageSlices} />
        </section>
      )}
    </>
  );
}

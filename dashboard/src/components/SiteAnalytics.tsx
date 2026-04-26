"use client";

/**
 * Site-level analytics — top of the topic-cluster drill.
 *
 * Surfaces (post-2026-04-26 trim):
 *   1. Funnel-stage breakdown — how each buying-stage performs across AI
 *   2. Cluster ranking table — every cluster ranked by composite, with
 *      drill-down to /topics/[slug]
 *
 * The previous 4-tile site-level KPI strip (AI prompt coverage, Cited
 * coverage, Organic clicks, Avg position) was retired because it
 * duplicated the framework KPIs that now live on /strategy in their
 * proper Aleyda · Layers 1+3 structure. Cluster ranking is what's
 * unique to this page; that's what stays.
 *
 * The user clicks any cluster row to drill into the cluster level
 * (/topics/<slug>), and from there into individual page level. Setup
 * actions (create cluster, move pages) live in /settings/clusters and
 * are called out with a link in the page header.
 */

import { useRouter } from "next/navigation";
import clsx from "clsx";

import { FunnelStageBreakdown } from "@/components/FunnelStageBreakdown";
import { InfoTooltip } from "@/components/InfoTooltip";
import { QUADRANT_META } from "@/lib/framework";
import type {
  ClusterPattern,
  ClusterRanking,
  FunnelStage,
  SiteAnalytics,
} from "@/lib/analytics";
import { CLUSTER_PATTERN_META, STAGE_META } from "@/lib/analytics";

export interface SiteAnalyticsProps {
  analytics: SiteAnalytics;
  ranking: ClusterRanking[];
}

export function SiteAnalytics({ analytics, ranking }: SiteAnalyticsProps) {
  return (
    <>
      {/* ===== Funnel-stage breakdown ===== */}
      <FunnelStageBreakdown byStage={analytics.by_stage} />

      {/* ===== Cluster ranking table ===== */}
      <section>
        <header className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
              Cluster performance
            </h2>
            <InfoTooltip
              widthClass="w-80"
              label="About cluster ranking"
              content={
                <>
                  Every topic cluster ranked by a composite of AI and SEO
                  performance. AI score is the prompt-coverage % for the
                  cluster; SEO score is a log-normalised blend of clicks and
                  impressions. Composite is the average of the two — a
                  rough &quot;overall health&quot; reading.
                  <br /><br />
                  Click any row to drill into that cluster&apos;s analytics.
                </>
              }
            />
          </div>
          <p className="text-[11px] text-ink-500">
            Click a row to drill into that cluster
          </p>
        </header>

        <ClusterRankingTable rows={ranking} />
      </section>
    </>
  );
}

// ---------------------------------------------------------------------

function ClusterRankingTable({ rows }: { rows: ClusterRanking[] }) {
  const router = useRouter();

  if (rows.length === 0) {
    return (
      <div className="bg-surface border border-hairline rounded-2xl p-6 text-center text-sm text-ink-500">
        No clusters yet — set them up in{" "}
        <a href="/settings/clusters" className="text-primary-700 hover:text-primary-900 underline decoration-dotted underline-offset-2">
          Settings → Clusters
        </a>
        .
      </div>
    );
  }

  return (
    <div className="bg-surface border border-hairline rounded-2xl overflow-hidden shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted/40 text-[10px] uppercase tracking-[0.12em] text-ink-500">
            <tr>
              <th className="text-left px-5 py-3 font-semibold">Cluster</th>
              <th className="text-left px-3 py-3 font-semibold">Top stage</th>
              <th className="text-right px-3 py-3 font-semibold">
                <span className="inline-flex items-center gap-1">
                  AI score
                  <InfoTooltip
                    widthClass="w-72"
                    label="About AI score"
                    content="Prompt coverage % for this cluster. 100 = your brand appears in every tracked AI question for this cluster; 0 = never appears."
                  />
                </span>
              </th>
              <th className="text-right px-3 py-3 font-semibold">
                <span className="inline-flex items-center gap-1">
                  SEO score
                  <InfoTooltip
                    widthClass="w-72"
                    label="About SEO score"
                    content={
                      <>
                        Log-normalised composite of clicks (×10 weight) and
                        impressions, capped at 100. Same scale as the Content
                        Coverage matrix X-axis. Calibrated for typical
                        ranges (50 ≈ 100 weighted units, 100 ≈ 10,000).
                      </>
                    }
                  />
                </span>
              </th>
              <th className="text-right px-3 py-3 font-semibold">
                <span className="inline-flex items-center gap-1">
                  Composite
                  <InfoTooltip
                    widthClass="w-80"
                    label="About the composite score"
                    content={
                      <>
                        <strong>Equal-weighted average of AI score + SEO score.</strong>
                        <br />
                        50/50 by design — there&apos;s no built-in reason
                        to weight one channel above the other. The two
                        component columns to the left show how each side
                        contributes; if you ever want to weight differently,
                        sort by the AI or SEO column directly.
                      </>
                    }
                  />
                </span>
              </th>
              <th className="text-right px-3 py-3 font-semibold">
                <span className="inline-flex items-center gap-1">
                  Readiness
                  <InfoTooltip
                    widthClass="w-80"
                    label="About the readiness score"
                    content={
                      <>
                        Average of the eight measured content-readiness
                        dimensions for this cluster (Accessible,
                        Extractable, Recognisable, Useful, Fresh,
                        Differentiated, Transactable, Corroborated).
                        Higher is better.
                        <br /><br />
                        &mdash; means no dimensions could be measured yet
                        (e.g. no scraped pages assigned to this cluster).
                        Click into the cluster for the full per-dimension
                        breakdown.
                      </>
                    }
                  />
                </span>
              </th>
              <th className="text-right px-3 py-3 font-semibold">Pages</th>
              <th className="text-right px-3 py-3 font-semibold">Prompts</th>
              <th className="text-left px-3 py-3 font-semibold">Pattern</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {rows.map((r) => (
              <tr
                key={r.cluster}
                onClick={() => router.push(`/topics/${r.cluster}`)}
                className="cursor-pointer hover:bg-surface-muted/40 transition-colors"
              >
                <td className="px-5 py-3">
                  <div className="font-medium text-ink-900">{r.cluster_display}</div>
                  <div className="text-[11px] text-ink-500 font-mono">{r.cluster}</div>
                  {r.patterns.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {r.patterns.map((pat) => (
                        <PatternChip key={pat} pattern={pat} />
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-3">
                  {r.top_stage ? (
                    <StageChip stage={r.top_stage} />
                  ) : (
                    <span className="text-ink-400 text-xs">—</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right">
                  <ScoreBadge value={r.ai_score} />
                </td>
                <td className="px-3 py-3 text-right">
                  <ScoreBadge value={r.seo_score} />
                </td>
                <td className="px-3 py-3 text-right">
                  <ScoreBadge value={r.composite} bold />
                </td>
                <td className="px-3 py-3 text-right">
                  {r.readiness === null ? (
                    <span className="text-ink-400 text-xs tabular-nums">—</span>
                  ) : (
                    <ScoreBadge value={r.readiness} />
                  )}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink-700">
                  {r.pages}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink-700">
                  {r.prompts}
                </td>
                <td className="px-3 py-3">
                  <QuadrantChip quadrant={r.quadrant} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StageChip({ stage }: { stage: FunnelStage }) {
  const meta = STAGE_META[stage];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md ring-1 ring-inset bg-surface-muted text-ink-700 text-[11px]"
      title={meta.description}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.color }} aria-hidden />
      {stage}
    </span>
  );
}

function ScoreBadge({ value, bold }: { value: number; bold?: boolean }) {
  const tone = value >= 70 ? "good" : value >= 40 ? "warn" : "bad";
  const cls = TONE_BADGE[tone];
  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center min-w-[2.6rem] h-7 px-2 rounded-md text-xs tabular-nums ring-1 ring-inset",
        cls,
        bold && "font-bold",
      )}
    >
      {value}
    </span>
  );
}

function QuadrantChip({ quadrant }: { quadrant: ClusterRanking["quadrant"] }) {
  const meta = QUADRANT_META[quadrant];
  const cls = QUAD_CHIP[meta.tone];
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ring-1 ring-inset",
        cls,
      )}
      title={meta.description}
    >
      {meta.label}
    </span>
  );
}

const TONE_BADGE = {
  good: "bg-emerald-100 text-emerald-800 ring-emerald-300/60",
  warn: "bg-amber-100  text-amber-800   ring-amber-300/60",
  bad:  "bg-red-100    text-red-800     ring-red-300/60",
} as const;

const QUAD_CHIP = {
  good: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  info: "bg-primary-50 text-primary-700 ring-primary-200",
  warn: "bg-warning-50 text-warning-600 ring-warning/30",
  bad:  "bg-danger-50  text-danger-600  ring-danger/30",
} as const;

/**
 * Cross-layer diagnostic chip — appears next to the cluster name in
 * the ranking table when a cluster matches one of the audit's named
 * patterns (compounding, underdistributed, structural blocker, BOFU
 * gap, TOFU gap). Hover shows the prescribed action.
 */
function PatternChip({ pattern }: { pattern: ClusterPattern }) {
  const meta = CLUSTER_PATTERN_META[pattern];
  const cls = QUAD_CHIP[meta.tone];
  return (
    <span
      className={clsx(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ring-1 ring-inset",
        cls,
      )}
      title={`${meta.description} ${meta.action}`}
    >
      {meta.short}
    </span>
  );
}

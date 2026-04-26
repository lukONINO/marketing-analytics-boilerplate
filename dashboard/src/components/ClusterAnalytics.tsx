"use client";

/**
 * Cluster-level analytics — middle of the topic-cluster drill.
 *
 * Sections:
 *
 *   PERFORMANCE                    KPI strip
 *     · AI prompt coverage + cited count
 *     · Organic clicks
 *     · Substantive pages
 *
 *   READINESS                      8-dimension content-readiness panel
 *
 *   FUNNEL-STAGE BREAKDOWN          for this cluster (TOFU/MOFU/BOFU)
 *
 *   PROMPTS + PAGES                 two-column layout
 *     · Prompts list (rows show per-prompt 4-state chip inline)
 *     · Pages list   (URLs assigned to this cluster)
 *
 * The site-wide 4-state distribution panel that used to live here moved to
 * /strategy/prompts where the prompt set itself is curated. Per-prompt
 * state chips remain inline in the Prompts list — that's the actionable
 * surface at this level.
 *
 * Click handlers:
 *   - Page row → /topics/<cluster>/page/<...path-segments>
 *   - "Manage cluster" → /settings/clusters
 */

import { useRouter } from "next/navigation";
import clsx from "clsx";

import { FunnelStageBreakdown } from "@/components/FunnelStageBreakdown";
import { InfoTooltip } from "@/components/InfoTooltip";
import type { ClusterAnalytics as ClusterAnalyticsData } from "@/lib/analytics";
import { shortPath, urlPathToSegments } from "@/lib/analytics";
import {
  READINESS_DIMENSION_META,
  type ReadinessScore,
} from "@/lib/framework";

export interface ClusterAnalyticsProps {
  analytics: ClusterAnalyticsData;
  /**
   * Per-(cluster, lang) readiness rows for THIS cluster only (filtered
   * by the page). 1 row for English-only clusters, 2 for bilingual.
   * Pass `[]` to hide the panel entirely.
   */
  readiness?: ReadinessScore[];
}

export function ClusterAnalytics({ analytics, readiness = [] }: ClusterAnalyticsProps) {
  return (
    <>
      {/* ===== Performance ===== */}
      <SectionHeader
        title="Performance"
        subtitle="What share of AI answers reach this cluster, what business value flows from it, and what content depth backs it up."
      />
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <KpiTile
          channel="AI"
          label="AI prompt coverage"
          value={
            analytics.ai.prompts_total > 0
              ? `${(analytics.ai.prompt_coverage * 100).toFixed(0)}%`
              : "—"
          }
          sub={
            analytics.ai.prompts_total > 0
              ? `${analytics.ai.state_a + analytics.ai.state_b} of ${analytics.ai.prompts_total} prompts mention us`
              : "no tracked prompts in this cluster"
          }
          tooltip="Of the AI prompts tracked for this cluster, in what share does AI include your brand in the answer?"
        />
        <KpiTile
          channel="AI"
          label="Cited"
          value={String(analytics.ai.state_a)}
          sub={`${analytics.ai.state_b} mentioned-only · ${analytics.ai.state_c + analytics.ai.state_d} never reached`}
          tooltip="Prompts where AI shows a clickable link to your site. The most valuable state — clicks land on your domain and citations carry implicit trust."
        />
        <KpiTile
          channel="SEO"
          label="Organic clicks"
          value={analytics.seo.total_clicks.toLocaleString()}
          sub={`${analytics.seo.total_impressions.toLocaleString()} impressions across the window`}
          tooltip="Google organic clicks landing on pages in this cluster, summed across the timeframe in the topbar."
        />
        <KpiTile
          channel="META"
          label="Substantive pages"
          value={(() => {
            const substantive = analytics.pages.filter((p) => (p.word_count ?? 0) >= 800).length;
            return `${substantive} / ${analytics.pages.length}`;
          })()}
          sub={(() => {
            const thin = analytics.pages.filter(
              (p) => (p.word_count ?? 0) > 0 && (p.word_count ?? 0) < 800,
            ).length;
            const empty = analytics.pages.filter((p) => (p.word_count ?? 0) === 0).length;
            const parts = [];
            if (thin > 0) parts.push(`${thin} thin (<800 words)`);
            if (empty > 0) parts.push(`${empty} not yet scraped`);
            return parts.length > 0 ? parts.join(" · ") : "all pages substantive";
          })()}
          tooltip="Pages with ≥ 800 words counted as 'substantive' — that's the rough floor where AI engines can extract enough content to cite confidently. Thinner pages count as 'placeholder' even if assigned. Re-assign in Settings → Clusters."
        />
      </section>

      {/* ---- Readiness ---- */}
      <Subheader
        title="Readiness"
        description="Eight readiness dimensions averaged across this cluster's pages. Tooltip explains each."
      />
      <ReadinessPanel scores={readiness} />

      {/* ===== Funnel-stage breakdown for this cluster ===== */}
      <FunnelStageBreakdown
        byStage={analytics.by_stage}
        title="Funnel-stage performance · this cluster"
      />

      {/* ===== Two-column layout: AI prompts (Malte 4-state) + Pages ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PromptsPanel cluster={analytics.cluster_display} prompts={analytics.prompts} />
        <PagesPanel cluster={analytics.cluster} pages={analytics.pages} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// Section header atoms — plain titles with optional subtitle / inline
// description. Used to label the Performance KPI strip and Readiness
// rollup sections.
// ---------------------------------------------------------------------

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="mb-4 mt-2">
      <h2 className="font-display text-xl font-bold text-ink-900">{title}</h2>
      {subtitle && (
        <p className="text-xs text-ink-600 mt-1.5 leading-relaxed">{subtitle}</p>
      )}
    </header>
  );
}

function Subheader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-3 flex items-baseline gap-2 flex-wrap">
      <h3 className="text-base font-semibold text-ink-900">{title}</h3>
      <span className="text-[11px] text-ink-500">— {description}</span>
    </div>
  );
}

// ---------------------------------------------------------------------

function KpiTile({
  channel,
  label,
  value,
  sub,
  tooltip,
}: {
  channel: "AI" | "SEO" | "META";
  label: string;
  value: string;
  sub: string;
  tooltip: string;
}) {
  const channelStyle =
    channel === "AI" ? "bg-accent-50 text-accent-700 ring-accent-200"
    : channel === "SEO" ? "bg-primary-50 text-primary-700 ring-primary-200"
    : "bg-surface-muted text-ink-600 ring-hairline";
  return (
    <article className="bg-surface border border-hairline rounded-2xl px-5 py-4 shadow-card">
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5">
          <span
            className={clsx(
              "text-[9px] font-bold uppercase tracking-[0.16em] px-1.5 py-0.5 rounded-md ring-1 ring-inset",
              channelStyle,
            )}
          >
            {channel}
          </span>
          <span className="text-xs font-medium text-ink-700">{label}</span>
        </div>
        <InfoTooltip widthClass="w-72" label={`About ${label}`} content={tooltip} />
      </div>
      <div className="text-3xl font-semibold tabular-nums text-ink-900 leading-none mt-2">
        {value}
      </div>
      <p className="text-[11px] text-ink-500 mt-2 leading-relaxed">{sub}</p>
    </article>
  );
}

// ---------------------------------------------------------------------

/**
 * Content readiness — 4-row strip showing the cluster's readiness across
 * the dimensions we actually measure today.
 *
 * Each row averages across language (en + de) — the cluster's "is our
 * content ready?" answer is one number per dimension, not split by
 * language. If only one language has data, the average is that one
 * value.
 *
 * Rows render as: dimension label + the framework's question (small),
 * a horizontal progress bar, percentage on the right. No fancy charts.
 *
 * Returns null when there's nothing to show (e.g. cluster with no
 * scraped pages yet) so the page doesn't dangle an empty section.
 */
function ReadinessPanel({ scores }: { scores: ReadinessScore[] }) {
  // Order matters — these are the 8 we compute (consistent + credible
  // remain explicit null in the framework module). Fixed order so the
  // panel reads the same on every cluster page. Grouped roughly by
  // theme: structural (accessible / extractable / recognizable),
  // user-side (useful / fresh / differentiated / transactable),
  // ecosystem (corroborated).
  const ORDER = [
    "accessible",
    "extractable",
    "recognizable",
    "useful",
    "fresh",
    "differentiated",
    "transactable",
    "corroborated",
  ] as const;

  // Average non-null values across language rows for each dimension.
  const rows = ORDER.map((key) => {
    const vals = scores
      .map((r) => r.scores[key])
      .filter((v): v is number => v !== null);
    const avg = vals.length > 0
      ? vals.reduce((a, b) => a + b, 0) / vals.length
      : null;
    return {
      key,
      label: READINESS_DIMENSION_META[key].label,
      question: READINESS_DIMENSION_META[key].question,
      value: avg,
    };
  });

  // Hide the panel entirely if every dimension is null (no data yet).
  const anyMeasured = rows.some((r) => r.value !== null);
  if (!anyMeasured) return null;

  return (
    <section className="mb-8 bg-surface border border-hairline rounded-2xl shadow-card overflow-hidden">
      <header className="px-5 py-3 border-b border-hairline bg-surface-muted/40 flex items-center gap-1.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
          Content readiness
        </h2>
        <InfoTooltip
          widthClass="w-96"
          label="About content readiness"
          content={
            <>
              How ready this cluster&apos;s pages are for AI engines to
              cite. Eight dimensions, derived from data we already pull:
              <br /><br />
              <strong>Accessible</strong> — pages with ≥200 words of real
              content (not just JS shells).
              <br />
              <strong>Extractable</strong> — composite of word count, h1,
              meta, schema, numeric claims.
              <br />
              <strong>Recognisable</strong> — pages with entity-classifying
              schema (Organization, Article, etc.).
              <br />
              <strong>Useful</strong> — average GA4 engagement seconds per
              pageview across the cluster.
              <br />
              <strong>Fresh</strong> — median days since each page&apos;s
              Last-Modified header.
              <br />
              <strong>Differentiated</strong> — 1 − mean Jaccard overlap
              between pages in the cluster (higher = pages don&apos;t
              repeat each other).
              <br />
              <strong>Transactable</strong> — share of pages with pricing
              or plan-comparison signals AI can quote.
              <br />
              <strong>Corroborated</strong> — third-party domains co-cite
              your brand instead of ignoring you.
              <br /><br />
              Higher is better. Two dimensions still unmeasured
              (consistent, credible) — see Strategy → Roadmap.
            </>
          }
        />
      </header>
      <ul className="divide-y divide-hairline">
        {rows.map(({ key, ...rest }) => (
          <ReadinessRow key={key} {...rest} />
        ))}
      </ul>
    </section>
  );
}

function ReadinessRow({
  label,
  question,
  value,
}: {
  label: string;
  question: string;
  value: number | null;
}) {
  // Tone bands: <50% danger, 50-80% warn, ≥80% good. Conservative
  // thresholds — getting to 80% on any of these is genuinely good.
  const tone =
    value === null  ? "muted"
    : value >= 0.8  ? "good"
    : value >= 0.5  ? "warn"
    :                 "bad";
  const barColor =
    tone === "good" ? "bg-emerald-500"
    : tone === "warn" ? "bg-amber-500"
    : tone === "bad"  ? "bg-red-500"
    :                   "bg-ink-300";

  const pctLabel = value === null ? "—" : `${Math.round(value * 100)}%`;
  const pctWidth = value === null ? 0 : Math.max(2, Math.round(value * 100));

  return (
    <li className="px-5 py-3 flex items-center gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink-900">{label}</div>
        <div className="text-[11px] text-ink-500 mt-0.5">{question}</div>
      </div>
      <div
        className="h-1.5 w-32 sm:w-48 rounded-full bg-surface-muted overflow-hidden shrink-0"
        aria-hidden
      >
        <div
          className={clsx("h-full rounded-full transition-all", barColor)}
          style={{ width: `${pctWidth}%` }}
        />
      </div>
      <div className="text-sm font-semibold tabular-nums text-ink-900 w-12 text-right shrink-0">
        {pctLabel}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------

function PromptsPanel({
  cluster,
  prompts,
}: {
  cluster: string;
  prompts: ClusterAnalyticsData["prompts"];
}) {
  const sorted = [...prompts].sort((a, b) => {
    // States: A first, B second, C third, D last
    const order = { A: 0, B: 1, C: 2, D: 3 };
    return order[a.state] - order[b.state] || b.citation_rate - a.citation_rate;
  });

  return (
    <section className="bg-surface border border-hairline rounded-2xl shadow-card overflow-hidden">
      <header className="px-5 py-3 border-b border-hairline bg-surface-muted/40 flex items-center gap-1.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
          AI prompts in {cluster}
        </h2>
        <InfoTooltip
          widthClass="w-80"
          label="About AI prompts"
          content={
            <>
              Each row is one buyer question we track in Peec, scoped to
              this cluster. The state tells you what AI does:
              <br /><br />
              <strong>Cited (A)</strong> — AI links to your site. Best.
              <br />
              <strong>Mentioned (B)</strong> — AI names you but no link.
              <br />
              <strong>Never reached (C / D)</strong> — AI doesn&apos;t
              pull from your site. Investigate readiness gaps.
            </>
          }
        />
        <span className="ml-auto text-[11px] text-ink-500 tabular-nums">
          {prompts.length} prompt{prompts.length === 1 ? "" : "s"}
        </span>
      </header>

      {prompts.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-ink-500">
          No tracked prompts in this cluster yet.
        </div>
      ) : (
        <ul className="divide-y divide-hairline max-h-[34rem] overflow-y-auto">
          {sorted.map((p) => (
            <li key={p.prompt_id} className="px-5 py-3 hover:bg-surface-muted/30">
              <div className="flex items-start gap-3">
                <StateChip state={p.state} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink-900 leading-snug">
                    {p.prompt_text}
                  </div>
                  <div className="text-[11px] text-ink-500 mt-1 tabular-nums flex items-center gap-3 flex-wrap">
                    <span className="uppercase tracking-wider text-[10px]">{p.lang}</span>
                    <span>retrieved {(p.retrieved_percentage * 100).toFixed(0)}%</span>
                    <span>citations {p.citation_rate.toFixed(1)}</span>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StateChip({ state }: { state: "A" | "B" | "C" | "D" }) {
  const map = {
    A: { label: "A", title: "Cited — AI shows a clickable link", cls: "bg-emerald-100 text-emerald-800 ring-emerald-300/60" },
    B: { label: "B", title: "Mentioned but not linked", cls: "bg-amber-100 text-amber-800 ring-amber-300/60" },
    C: { label: "C", title: "Search reached but our domain wasn't retrieved", cls: "bg-red-100 text-red-800 ring-red-300/60" },
    D: { label: "D", title: "No relevant page exists for this prompt", cls: "bg-red-200 text-red-900 ring-red-400/60" },
  } as const;
  const m = map[state];
  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-bold ring-1 ring-inset shrink-0",
        m.cls,
      )}
      title={m.title}
    >
      {m.label}
    </span>
  );
}

// ---------------------------------------------------------------------

function PagesPanel({
  cluster,
  pages,
}: {
  cluster: string;
  pages: ClusterAnalyticsData["pages"];
}) {
  const router = useRouter();

  const sorted = [...pages].sort((a, b) => (b.word_count ?? 0) - (a.word_count ?? 0));

  return (
    <section className="bg-surface border border-hairline rounded-2xl shadow-card overflow-hidden">
      <header className="px-5 py-3 border-b border-hairline bg-surface-muted/40 flex items-center gap-1.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
          Pages in this cluster
        </h2>
        <InfoTooltip
          widthClass="w-80"
          label="About cluster pages"
          content={
            <>
              Every scraped URL on your site currently assigned to this
              cluster. Click any row to drill into the page&apos;s
              individual analytics — which Google queries it ranks for,
              which AI prompts cite it, and content-quality signals.
              <br /><br />
              To re-assign a page to a different cluster, go to{" "}
              <strong>Settings → Clusters</strong>.
            </>
          }
        />
        <span className="ml-auto text-[11px] text-ink-500 tabular-nums">
          {pages.length} page{pages.length === 1 ? "" : "s"}
        </span>
      </header>

      {pages.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-ink-500">
          No pages assigned to this cluster yet.{" "}
          <a
            href="/settings/clusters"
            className="text-primary-700 hover:text-primary-900 underline decoration-dotted underline-offset-2"
          >
            Assign in Settings
          </a>
          .
        </div>
      ) : (
        <ul className="divide-y divide-hairline max-h-[34rem] overflow-y-auto">
          {sorted.map((p) => {
            const segments = urlPathToSegments(p.url);
            const href = `/topics/${cluster}/page/${segments.join("/")}`;
            return (
              <li key={p.url}>
                <button
                  type="button"
                  onClick={() => router.push(href)}
                  className="w-full text-left px-5 py-3 hover:bg-surface-muted/30 transition-colors"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="font-medium text-ink-900 truncate">
                      {p.title || shortPath(p.url)}
                    </div>
                    <span className="text-[10px] uppercase tracking-wider text-ink-500 shrink-0">
                      {p.lang}
                    </span>
                  </div>
                  <div className="text-[11px] text-ink-500 mt-1 truncate">
                    {shortPath(p.url)}
                  </div>
                  <div className="text-[11px] text-ink-500 mt-1.5 tabular-nums flex items-center gap-3 flex-wrap">
                    <span>{(p.word_count ?? 0).toLocaleString()} words</span>
                    {(p.schema_types?.length ?? 0) > 0 && (
                      <span>{p.schema_types.length} schema types</span>
                    )}
                    {p.numeric_claims_count > 0 && (
                      <span>{p.numeric_claims_count} claims</span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

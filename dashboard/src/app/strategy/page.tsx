/**
 * Strategy — single executive view of how AI search treats the brand.
 *
 * Surfaces (post-2026-04-26 trim):
 *
 *   1. DataRefreshGuide                   how to update this page
 *   2. Hero                               + nav into prompts / findings
 *   3. Content Coverage matrix            cluster ranking visual
 *   4. Things that need attention         unified action stream
 *   5. Roadmap (collapsed)                metrics not yet computed
 *
 * What's intentionally NOT on this page (moved per-cluster):
 *   - Aleyda L1 + L3 KPI strip + per-engine visibility — now read off
 *     the cluster ranking on /topics, where the same numbers are
 *     tied to the cluster they belong to.
 *   - Layer 2 (Readiness) — Readiness column in the cluster ranking
 *     on /topics; full per-dimension panel on each /topics/[slug].
 *   - Malte 4-state distribution + Funnel × 4-state heatmap + State-D
 *     backlog — the per-prompt 4-state lives on /topics/[slug].
 *
 * Strategy is now a "where do clusters land + what should I act on
 * this week" page. Everything quantitative is per-cluster.
 */

import { ClusterFixList } from "@/components/ClusterFixList";
import { ContentCoverageMatrix } from "@/components/ContentCoverageMatrix";
import { DataRefreshGuide } from "@/components/DataRefreshGuide";
import { InfoTooltip } from "@/components/InfoTooltip";
import { buildSiteFixList } from "@/lib/cluster-fixes";
import {
  loadCustomClusters,
  loadDailyTopicsSlices,
  loadGeoDebug,
  loadInsights,
  loadSourceGaps,
  loadTopicClusters,
  loadVisibilityImprovements,
} from "@/lib/data";
import { computeCoverage } from "@/lib/framework";
import { rollTopics } from "@/lib/rollup";
import type { SourceGapDomain } from "@/lib/types";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;

export default async function StrategyPage() {
  const [
    geoDebug,
    sourceGaps,
    topicSlices,
    configClusters,
    customClustersFile,
    visibilityImprovements,
    insightsFile,
  ] = await Promise.all([
    loadGeoDebug(),
    loadSourceGaps(),
    loadDailyTopicsSlices(WINDOW_DAYS),
    loadTopicClusters(),
    loadCustomClusters(),
    loadVisibilityImprovements(),
    loadInsights(),
  ]);

  // ---- Cluster matrix ----
  // The matrix's AI axis uses prompt coverage = (state A + state B) /
  // total — same metric the cluster ranking table on /topics shows
  // as "AI score". Without this, the matrix would fall back to
  // `geo_visibility` (a weighted Peec prominence number) and disagree
  // with the table about which clusters are "compounding".
  // Note: pageClusters intentionally not loaded — coverage uses the
  // rolled topic slices alone for the X/Y points; assignments only
  // matter for readiness, which now lives per-cluster on /topics.
  const promptCoverageByKey = new Map<string, number>();
  {
    const counts = new Map<string, { hit: number; total: number }>();
    for (const p of geoDebug?.prompts ?? []) {
      if (!p.cluster || !p.lang) continue;
      const key = `${p.cluster}::${p.lang}`;
      const c = counts.get(key) ?? { hit: 0, total: 0 };
      c.total += 1;
      if (p.state === "A" || p.state === "B") c.hit += 1;
      counts.set(key, c);
    }
    for (const [key, c] of counts) {
      promptCoverageByKey.set(key, c.total > 0 ? c.hit / c.total : 0);
    }
  }

  const rolled = rollTopics(topicSlices, WINDOW_DAYS);
  const coveragePoints = computeCoverage(
    rolled,
    null,
    configClusters,
    customClustersFile.clusters,
    promptCoverageByKey,
  );

  // ---- Unified action stream — on-page fixes + outreach gaps + findings ----
  // One section on the page, three sources:
  //   1. Visibility opportunities (rule-computed) — `data/processed/visibility_improvements.json`
  //   2. Outreach gaps (Peec source-gap pull)     — `data/dashboard/source_gaps.json`
  //   3. Claude-written findings (warning+critical only) — `data/dashboard/insights.json`
  // The previous split between "Things to fix" and a separate "Recent
  // findings" widget made the user mentally merge the two anyway.
  const labelByCluster = new Map<string, string>();
  for (const c of configClusters) labelByCluster.set(c.slug, c.names.en);
  for (const c of customClustersFile.clusters) labelByCluster.set(c.slug, c.names.en);

  const domainsByCluster = new Map<string, SourceGapDomain[]>();
  for (const [slug, langs] of Object.entries(sourceGaps?.by_cluster ?? {})) {
    const en = langs.en?.top_cited_domains ?? [];
    const de = langs.de?.top_cited_domains ?? [];
    domainsByCluster.set(slug, mergeDomainLists(en, de));
  }

  const siteFixes = buildSiteFixList({
    opportunities: visibilityImprovements?.opportunities ?? [],
    domainsByCluster,
    labelByCluster,
    insights: insightsFile.insights ?? [],
    limit: 10,
  });

  return (
    <>
      <DataRefreshGuide
        pageKey="strategy"
        summary="Strategy pulls from every other data surface — Peec, GSC, GA4, the content scrape, source-gap analysis, GEO debug. Update those upstream sources and this page refreshes automatically."
        actions={[
          {
            label: "Refresh organic search + GA4 traffic",
            description: "Pulls the latest GSC clicks, GA4 sessions, and LLM-referrer data.",
            kind: "topbar",
            topbar_path: "Refresh data → Load latest only",
          },
          {
            label: "Refresh AI visibility (Peec)",
            description: "Pull, then click Re-aggregate to fold the new data in.",
            kind: "claude",
            prompt: "pull peec data for the latest day",
          },
          {
            label: "Re-run AI Citation Health (4-state)",
            description: "Refreshes the per-prompt classification shown on every Topic Cluster page (/topics/[slug]).",
            kind: "claude",
            prompt: "run geo debug",
          },
          {
            label: "Re-run third-party citation gaps",
            description: "Updates the outreach items in Things-to-fix.",
            kind: "claude",
            prompt: "/source-gap-refresh",
          },
          {
            label: "Refresh the weekly narrative",
            description: "Generates the Overview page's weekly summary insight (source: weekly-routine). Run on Mondays after the weekend's data lands.",
            kind: "claude",
            prompt: "run weekly marketing report",
          },
        ]}
      />

      {/* ===== Hero ===== */}
      <header className="mb-8 max-w-3xl">
        <span className="inline-block text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-700 bg-primary-50 px-2 py-0.5 rounded-md ring-1 ring-inset ring-primary-200 mb-2">
          Strategy
        </span>
        <h1 className="font-display text-[28px] md:text-[32px] font-bold tracking-tight text-ink-900">
          How AI search treats your brand
        </h1>
        <p className="text-sm text-ink-600 mt-3 leading-relaxed">
          Where your topic clusters land across AI answers and Google
          search, plus the specific things to act on this week. Quantitative
          detail (Presence, Readiness, 4-state citation classification,
          per-prompt and per-page metrics) lives in{" "}
          <a
            href="/topics"
            className="text-primary-700 hover:text-primary-900 underline decoration-dotted underline-offset-2"
          >
            Topic Clusters
          </a>{" "}
          — drill into any cluster row to see it.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href="/strategy/prompts"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-hairline text-ink-700 bg-surface hover:border-primary-400 hover:text-primary-700 transition-all"
          >
            Audit prompt set →
          </a>
          <a
            href="/strategy/findings"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-hairline text-ink-700 bg-surface hover:border-primary-400 hover:text-primary-700 transition-all"
          >
            All findings →
          </a>
        </div>
      </header>

      {/* ===== Content Coverage Matrix ===== */}
      <section className="mb-8">
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-ink-900 inline-flex items-center gap-1.5">
            How we show up across channels
            <InfoTooltip
              widthClass="w-[22rem]"
              label="About content coverage"
              content={
                <>
                  Each dot is one topic cluster, plotted on AI visibility (vertical)
                  × SEO presence (horizontal). The four quadrants tell you which
                  clusters are winning, which are blind spots, and where AI and SEO
                  are out of sync. Click any dot to drill into that cluster.
                </>
              }
            />
          </h2>
          <p className="text-xs text-ink-600 mt-1 max-w-2xl">
            Each cluster plotted by AI visibility × SEO presence. Click a dot to
            drill into that cluster.
          </p>
        </div>
        <ContentCoverageMatrix points={coveragePoints} />
      </section>

      {/* ===== Things that need attention — unified action stream =====
          On-page fixes + outreach gaps + Claude findings, sorted by
          severity. Replaces the previous split between "Things to fix"
          and a separate "Recent findings" widget. */}
      <section className="mb-8">
        <ClusterFixList fixes={siteFixes} />
      </section>

      {/* ===== Roadmap (collapsed) ===== */}
      <RoadmapSection />
    </>
  );
}

// ---------------------------------------------------------------------
// Roadmap — what we don't measure yet. Collapsed by default.
//
// These five readiness/visibility metrics still need new data sources
// or LLM-classifier work. The eight readiness dimensions we DO measure
// now live per-cluster (see /topics + /topics/[slug]).
// ---------------------------------------------------------------------

const ROADMAP_ITEMS: Array<{ label: string; need: string }> = [
  {
    label: "Comparative Win Rate",
    need: "Sample chats for vs-prompts and classify which platform AI recommends.",
  },
  {
    label: "Recommendation Rate",
    need: "Detect endorsement language (\"recommend\", \"best for\") in sampled chats.",
  },
  {
    label: "Representation Accuracy",
    need: "LLM classifier checking AI describes your brand correctly ([describe your product positioning]).",
  },
  {
    label: "Cross-source Consistency",
    need: "Wikipedia / G2 / LinkedIn lookups to verify entity description matches.",
  },
  {
    label: "Source Credibility weighting",
    need: "Domain-authority data (Ahrefs / Moz) to weight corroborating publications.",
  },
];

function RoadmapSection() {
  return (
    <details className="bg-surface-muted/30 ring-1 ring-inset ring-hairline rounded-2xl group">
      <summary className="cursor-pointer list-none px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-surface-muted/50 transition-colors rounded-2xl">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
            Roadmap — {ROADMAP_ITEMS.length} metrics not yet computed
          </h2>
          <p className="text-xs text-ink-600 mt-0.5">
            What we&apos;d add to make this dashboard more complete.
          </p>
        </div>
        <span className="text-[11px] text-ink-500 group-open:rotate-90 transition-transform" aria-hidden>
          ›
        </span>
      </summary>
      <div className="px-5 pb-5 pt-1">
        <ul className="space-y-2">
          {ROADMAP_ITEMS.map((item) => (
            <li key={item.label} className="flex items-start gap-3 text-xs">
              <span className="shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full bg-ink-300" aria-hidden />
              <div>
                <div className="font-medium text-ink-900">{item.label}</div>
                <div className="text-ink-600 mt-0.5">{item.need}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------

function mergeDomainLists(en: SourceGapDomain[], de: SourceGapDomain[]): SourceGapDomain[] {
  const map = new Map<string, SourceGapDomain>();
  for (const d of [...en, ...de]) {
    const existing = map.get(d.domain);
    if (!existing || d.times_cited > existing.times_cited) {
      map.set(d.domain, d);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.times_cited - a.times_cited);
}

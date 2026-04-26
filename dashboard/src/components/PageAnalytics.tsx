"use client";

/**
 * Page-level analytics — bottom of the topic-cluster drill.
 *
 * Shows everything we know about one URL:
 *   1. Page metadata strip — title, URL, cluster, lang, word count, schema
 *   2. KPI strip — clicks, impressions, GA sessions, AI sessions, citations
 *   3. AI prompts that retrieved this page (when available)
 *   4. Google queries this page ranks for (top_queries × this URL)
 *   5. Content quality signals — the readiness dimensions for this URL
 *
 * Data sources:
 *   - PageClusterAssignment for metadata
 *   - daily aggregates × cross_channel.top_pages_all_channels for traffic
 *   - daily aggregates × summary.seo.top_queries (filtered to page) for SEO
 *   - geo_debug.json for related AI prompts (cluster-scoped)
 */

import clsx from "clsx";

import { InfoTooltip } from "@/components/InfoTooltip";
import type { PageAnalytics as PageAnalyticsData } from "@/lib/analytics";
import { shortPath } from "@/lib/analytics";
import type { GeoPromptDiagnostic } from "@/lib/types";

export interface PageAnalyticsProps {
  analytics: PageAnalyticsData;
  /** Prompts in the same (cluster, lang) — surfaced as "related AI prompts". */
  relatedPrompts: GeoPromptDiagnostic[];
}

export function PageAnalytics({ analytics, relatedPrompts }: PageAnalyticsProps) {
  const { page, totals, seo_queries } = analytics;

  return (
    <>
      {/* ===== Page metadata strip ===== */}
      <section className="bg-surface border border-hairline rounded-2xl shadow-card mb-8 overflow-hidden">
        <div className="p-5">
          <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
            <a
              href={page.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary-700 hover:text-primary-900 hover:underline font-mono break-all"
            >
              {page.url}
              <span aria-hidden className="ml-1">↗</span>
            </a>
            <span className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold shrink-0">
              {page.lang}
            </span>
          </div>
          <div className="flex items-center gap-4 flex-wrap text-[11px] text-ink-600">
            <MetaField label="Words" value={(page.word_count ?? 0).toLocaleString()} />
            <MetaField
              label="Schema types"
              value={page.schema_types.length}
              detail={page.schema_types.slice(0, 3).join(", ") + (page.schema_types.length > 3 ? "…" : "")}
            />
            <MetaField label="Numeric claims" value={page.numeric_claims_count} />
            <MetaField label="Internal links" value={page.internal_links} />
            <MetaField label="External links" value={page.external_links} />
            <MetaField label="Has H1" value={page.has_h1 ? "yes" : "no"} bad={!page.has_h1} />
            <MetaField label="Has meta" value={page.has_meta_description ? "yes" : "no"} bad={!page.has_meta_description} />
          </div>
        </div>
      </section>

      {/* ===== KPI strip ===== */}
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
        <KpiTile
          label="Organic clicks"
          channel="SEO"
          value={totals.seo_clicks.toLocaleString()}
          sub={`${totals.seo_impressions.toLocaleString()} impressions`}
          tooltip="Clicks from Google organic search to this URL, summed across the timeframe."
        />
        <KpiTile
          label="Total visits"
          channel="GA"
          value={totals.ga_sessions.toLocaleString()}
          sub="every channel combined"
          tooltip={
            <>
              <strong>Every visit to this page from any channel.</strong>
              <br /><br />
              Counts all GA4 sessions regardless of source — Google
              search, direct, AI tools, social, referral, paid.
              <br /><br />
              <em>Note:</em> the &quot;Sessions from AI tools&quot; tile
              to the right is a <em>subset</em> of this total, not a
              separate channel — total visits ≥ AI-tool visits always.
            </>
          }
        />
        <KpiTile
          label="From AI tools"
          channel="AI"
          value={totals.llm_sessions.toLocaleString()}
          sub="ChatGPT / Perplexity / Copilot / Gemini click-throughs"
          tooltip="Sessions where the user clicked through from an AI assistant. Detected via GA4 referrer URL."
        />
        <KpiTile
          label="AI citations"
          channel="AI"
          value={totals.peec_citations.toLocaleString()}
          sub="times Peec saw an inline AI citation"
          tooltip="Number of times Peec recorded an inline AI citation linking to this URL across tracked engines."
        />
        <KpiTile
          label="Active days"
          channel="META"
          value={`${totals.days_active} / ${analytics.daily_metrics.length}`}
          sub="days this page got any signal"
          tooltip="Days during the window where this URL had at least one click, session, or citation across any channel."
        />
      </section>

      {/* ===== Two-column layout: SEO queries + AI prompts ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <SeoQueriesPanel queries={seo_queries} />
        <RelatedPromptsPanel prompts={relatedPrompts} pageUrl={page.url} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------

function MetaField({
  label,
  value,
  detail,
  bad,
}: {
  label: string;
  value: string | number;
  detail?: string;
  bad?: boolean;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.12em] text-ink-500 font-semibold">
        {label}
      </span>
      <span
        className={clsx(
          "tabular-nums font-medium",
          bad ? "text-danger-600" : "text-ink-900",
        )}
        title={detail}
      >
        {value}
      </span>
    </span>
  );
}

function KpiTile({
  label,
  channel,
  value,
  sub,
  tooltip,
}: {
  label: string;
  channel: "AI" | "SEO" | "GA" | "META";
  value: string;
  sub: string;
  tooltip: React.ReactNode;
}) {
  const channelStyle =
    channel === "AI" ? "bg-accent-50 text-accent-700 ring-accent-200"
    : channel === "SEO" ? "bg-primary-50 text-primary-700 ring-primary-200"
    : channel === "GA" ? "bg-secondary-50 text-secondary-600 ring-secondary-100"
    : "bg-surface-muted text-ink-600 ring-hairline";
  return (
    <article className="bg-surface border border-hairline rounded-2xl px-4 py-3.5 shadow-card">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span
          className={clsx(
            "text-[9px] font-bold uppercase tracking-[0.16em] px-1.5 py-0.5 rounded ring-1 ring-inset",
            channelStyle,
          )}
        >
          {channel}
        </span>
        <InfoTooltip widthClass="w-72" label={`About ${label}`} content={tooltip} />
      </div>
      <div className="text-[10px] uppercase tracking-[0.12em] text-ink-500 font-semibold mb-1">
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums text-ink-900 leading-none">
        {value}
      </div>
      <p className="text-[10px] text-ink-500 mt-1.5 leading-relaxed">{sub}</p>
    </article>
  );
}

// ---------------------------------------------------------------------

function SeoQueriesPanel({ queries }: { queries: PageAnalyticsData["seo_queries"] }) {
  return (
    <section className="bg-surface border border-hairline rounded-2xl shadow-card overflow-hidden">
      <header className="px-5 py-3 border-b border-hairline bg-surface-muted/40 flex items-center gap-1.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
          Google queries this page ranks for
        </h2>
        <InfoTooltip
          widthClass="w-80"
          label="About SEO queries"
          content={
            <>
              Search queries from Google Search Console where this URL
              appeared in the results, summed across the timeframe.
              Sorted by clicks. Average position is across the days
              this page ranked.
              <br /><br />
              GSC reports a top-N per day (typically the top 1,000),
              so very long-tail queries can be missing.
            </>
          }
        />
        <span className="ml-auto text-[11px] text-ink-500 tabular-nums">
          {queries.length} {queries.length === 1 ? "query" : "queries"}
        </span>
      </header>

      {queries.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-ink-500">
          No GSC queries logged for this URL yet — either it hasn&apos;t
          ranked in the timeframe, or GSC&apos;s top-N didn&apos;t include
          it. Try widening the timeframe in the topbar.
        </div>
      ) : (
        <div className="overflow-x-auto max-h-[34rem] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface-muted/30 text-[10px] uppercase tracking-[0.12em] text-ink-500 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Query</th>
                <th className="text-right px-2 py-2 font-semibold">Clicks</th>
                <th className="text-right px-2 py-2 font-semibold">Impressions</th>
                <th className="text-right px-2 py-2 font-semibold">CTR</th>
                <th className="text-right px-2 py-2 font-semibold">Pos.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {queries.slice(0, 50).map((q) => (
                <tr key={q.query} className="hover:bg-surface-muted/40">
                  <td className="px-4 py-2 text-ink-900 truncate max-w-[18rem]" title={q.query}>
                    {q.query}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{q.clicks.toLocaleString()}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{q.impressions.toLocaleString()}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {(q.avg_ctr * 100).toFixed(1)}%
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {q.avg_position.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------

function RelatedPromptsPanel({
  prompts,
  pageUrl,
}: {
  prompts: GeoPromptDiagnostic[];
  pageUrl: string;
}) {
  // Sort by state (A first), then by citation_rate
  const sorted = [...prompts].sort((a, b) => {
    const order = { A: 0, B: 1, C: 2, D: 3 };
    return order[a.state] - order[b.state] || b.citation_rate - a.citation_rate;
  });

  // Find prompts that explicitly target this URL (when target_pages includes it)
  const directlyTargeting = sorted.filter((p) =>
    (p.target_pages ?? []).includes(pageUrl),
  );
  const otherCluster = sorted.filter((p) => !directlyTargeting.includes(p));

  return (
    <section className="bg-surface border border-hairline rounded-2xl shadow-card overflow-hidden">
      <header className="px-5 py-3 border-b border-hairline bg-surface-muted/40 flex items-center gap-1.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
          Related AI prompts
        </h2>
        <InfoTooltip
          widthClass="w-80"
          label="About related AI prompts"
          content={
            <>
              AI prompts in the same cluster as this page. The first
              group lists prompts that should logically target this
              URL (when a Claude analysis named it as a recommended
              landing page). The second group is the broader cluster
              context — what other questions AI gets asked here.
              <br /><br />
              Use this to spot pages that <em>could</em> rank for
              specific prompts but don&apos;t — usually a citation-hooks
              fix.
            </>
          }
        />
        <span className="ml-auto text-[11px] text-ink-500 tabular-nums">
          {prompts.length} prompt{prompts.length === 1 ? "" : "s"} in cluster
        </span>
      </header>

      {prompts.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-ink-500">
          No tracked AI prompts in this cluster yet.
        </div>
      ) : (
        <div className="max-h-[34rem] overflow-y-auto">
          {directlyTargeting.length > 0 && (
            <>
              <div className="px-5 py-2 bg-emerald-50/40 border-b border-hairline text-[10px] uppercase tracking-[0.12em] font-semibold text-emerald-700">
                Recommended target ({directlyTargeting.length})
              </div>
              <ul className="divide-y divide-hairline">
                {directlyTargeting.map((p) => (
                  <PromptListRow key={p.prompt_id} prompt={p} highlighted />
                ))}
              </ul>
            </>
          )}

          {otherCluster.length > 0 && (
            <>
              <div className="px-5 py-2 bg-surface-muted/40 border-b border-hairline text-[10px] uppercase tracking-[0.12em] font-semibold text-ink-500">
                Other prompts in cluster ({otherCluster.length})
              </div>
              <ul className="divide-y divide-hairline">
                {otherCluster.slice(0, 25).map((p) => (
                  <PromptListRow key={p.prompt_id} prompt={p} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function PromptListRow({
  prompt,
  highlighted,
}: {
  prompt: GeoPromptDiagnostic;
  highlighted?: boolean;
}) {
  return (
    <li
      className={clsx(
        "px-5 py-2.5",
        highlighted ? "bg-emerald-50/20" : "hover:bg-surface-muted/30",
      )}
    >
      <div className="flex items-start gap-3">
        <StateChip state={prompt.state} />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-ink-900 leading-snug">{prompt.prompt_text}</div>
          <div className="text-[10px] text-ink-500 mt-0.5 tabular-nums flex items-center gap-2">
            <span className="uppercase tracking-wider">{prompt.lang}</span>
            <span>·</span>
            <span>retrieved {(prompt.retrieved_percentage * 100).toFixed(0)}%</span>
            <span>·</span>
            <span>citations {prompt.citation_rate.toFixed(1)}</span>
          </div>
        </div>
      </div>
    </li>
  );
}

function StateChip({ state }: { state: "A" | "B" | "C" | "D" }) {
  const map = {
    A: { cls: "bg-emerald-100 text-emerald-800 ring-emerald-300/60", title: "Cited" },
    B: { cls: "bg-amber-100 text-amber-800 ring-amber-300/60", title: "Mentioned, not linked" },
    C: { cls: "bg-red-100 text-red-800 ring-red-300/60", title: "Search reached but our domain wasn't retrieved" },
    D: { cls: "bg-red-200 text-red-900 ring-red-400/60", title: "No relevant page exists" },
  } as const;
  const m = map[state];
  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ring-1 ring-inset shrink-0",
        m.cls,
      )}
      title={m.title}
    >
      {state}
    </span>
  );
}

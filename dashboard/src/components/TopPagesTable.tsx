"use client";

/**
 * Cross-channel Top Pages table — window-aggregated.
 *
 * The parent (Server Component) passes `slices`: the last 30 days of
 * per-day `{date, pages[]}` arrays loaded via `loadDailyPagesSlices`.
 * This component slices to the currently-selected window from the
 * global `TimeframeContext`, rolls up per-URL totals with `rollPages`,
 * and hands the result to the generic DataTable.
 *
 * Because the rollup is memoized on `{slices, window}`, switching
 * between 7d / 14d / 30d in the topbar is instant — no server
 * round-trip, no re-render of the page shell.
 */

import { useMemo } from "react";

import { DataTable, type Column } from "@/components/DataTable";
import { useTimeframe } from "@/components/TimeframeContext";
import { rollPages } from "@/lib/rollup";
import type { DailyPagesSlice, RolledPage } from "@/lib/types";

const COLUMNS: Column<RolledPage>[] = [
  {
    key: "url",
    label: "URL",
    align: "left",
    accessor: (p) => p.url,
    sortDirOnFirstClick: "asc",
    // Single-line truncation with hover-to-see-full-URL via `title`.
    // The previous `break-all` let long blog URLs wrap to multiple
    // lines, which made that row taller than every other row and
    // broke the table's grid feel on narrow viewports. Now the link
    // is a block element with a responsive max-width — at every
    // breakpoint the URL is clamped and overflow renders as `…`.
    render: (p) => {
      const display = p.url.replace(/^https?:\/\//, "");
      return (
        <a
          href={p.url}
          target="_blank"
          rel="noreferrer"
          title={p.url}
          className="block truncate font-mono text-xs text-primary-700 hover:text-primary-900 hover:underline max-w-[14rem] sm:max-w-[20rem] md:max-w-[28rem] lg:max-w-[36rem]"
        >
          {display}
        </a>
      );
    },
    cellClassName: "max-w-xl overflow-hidden",
  },
  {
    key: "seo_clicks",
    label: "SEO clicks",
    align: "right",
    info: <>Organic clicks from Google Search Console, summed across the selected window. Lag-tolerant: a single-day zero on the latest date doesn&apos;t zero the whole row if earlier days had traffic.</>,
    accessor: (p) => p.seo_clicks,
    render: (p) => <span className="tabular-nums">{p.seo_clicks}</span>,
  },
  {
    key: "seo_impressions",
    label: "SEO imp.",
    align: "right",
    info: <>Impressions from GSC, summed across the selected window.</>,
    accessor: (p) => p.seo_impressions,
    render: (p) => <span className="tabular-nums">{p.seo_impressions}</span>,
  },
  {
    key: "ga_sessions",
    label: "GA views",
    align: "right",
    info: <>Page views from GA4, summed across the selected window.</>,
    accessor: (p) => p.ga_sessions,
    render: (p) => <span className="tabular-nums">{p.ga_sessions}</span>,
  },
  {
    key: "llm_sessions",
    label: "LLM sessions",
    align: "right",
    info: <>Sessions referred from ChatGPT / Copilot / Perplexity / etc., summed across the selected window. Attributed via GA4 landingPage × sessionSource.</>,
    accessor: (p) => p.llm_sessions,
    render: (p) => <span className="tabular-nums">{p.llm_sessions}</span>,
  },
  {
    key: "peec_citations",
    label: "Peec cites",
    align: "right",
    info: <>Citations from Peec AI answers, summed across the selected window.</>,
    accessor: (p) => p.peec_citations,
    render: (p) => <span className="tabular-nums">{p.peec_citations}</span>,
  },
  {
    key: "composite_score",
    label: "Score",
    align: "right",
    info: <>Composite rank combining SEO clicks, GA views, LLM sessions, and Peec citations. Recomputed from the summed window values, so longer windows produce higher scores.</>,
    accessor: (p) => p.composite_score,
    render: (p) => (
      <span className="tabular-nums text-ink-700 font-medium">{p.composite_score.toFixed(3)}</span>
    ),
  },
  {
    key: "days_active",
    label: "Days",
    align: "right",
    info: <>How many days in the selected window the URL had any signal. Out of 7, 14, or 30 depending on your selection.</>,
    accessor: (p) => p.days_active,
    render: (p) => <span className="tabular-nums text-ink-700">{p.days_active}</span>,
  },
  {
    key: "sources",
    label: "Sources",
    align: "left",
    accessor: (p) => p.sources.join(","),
    sortDirOnFirstClick: "asc",
    render: (p) => (
      <span className="text-xs text-ink-500">{p.sources.join(", ")}</span>
    ),
  },
];

export function TopPagesTable({ slices }: { slices: DailyPagesSlice[] }) {
  const { window } = useTimeframe();
  const rows = useMemo(() => rollPages(slices, window), [slices, window]);

  return (
    <DataTable<RolledPage>
      rows={rows}
      rowKey={(p) => p.url}
      columns={COLUMNS}
      defaultSort={{ key: "composite_score", dir: "desc" }}
      defaultPageSize={25}
      pageSizeOptions={[10, 25, 50, 100, "all"]}
      searchPlaceholder="Filter pages (URL, source…)"
      emptyLabel={
        slices.length === 0
          ? "No daily data yet. Click Refresh data in the topbar."
          : "No pages match the current filter."
      }
      // Lock every body row to a uniform height. Without these every
      // row's height is whatever its tallest cell renders, and the
      // Sources cell wraps to 2-3 lines on narrow viewports while
      // shorter rows stay one line — so rows visibly disagreed in
      // height. h-12 sets row min-height; whitespace-nowrap +
      // overflow-hidden on every <td> guarantees no cell can grow
      // beyond a single line, so the row min-height is also its max.
      rowClassName="h-12 [&>td]:whitespace-nowrap [&>td]:overflow-hidden"
    />
  );
}

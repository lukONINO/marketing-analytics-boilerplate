import Link from "next/link";

import { FindingsView } from "@/components/FindingsView";
import { loadInsights } from "@/lib/data";

export const dynamic = "force-dynamic";

/**
 * /strategy/findings — full archive of Claude-written insights.
 *
 * The Strategy page surfaces the top warning + critical findings in
 * the action stream. This page is the long-tail view: every insight
 * ever written, filterable by severity and status. Click any row to
 * open the side drawer with the full body, tags, and linked references.
 *
 * Read-only. Status mutations (mark reviewed / archive / delete) live
 * on the per-insight detail drawer of the existing /api/insights/[id]
 * routes — that hook-up is a follow-up: the drawer here renders text
 * + read-only metadata. When the user wants to mark an insight as
 * reviewed, they currently do it via the next analysis run or by
 * editing the JSON directly.
 */
export default async function FindingsPage() {
  const { insights, last_updated } = await loadInsights();

  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <span className="inline-block text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-700 bg-primary-50 px-2 py-0.5 rounded-md ring-1 ring-inset ring-primary-200 mb-2">
            Findings
          </span>
          <h1 className="font-display text-[28px] md:text-[32px] font-bold tracking-tight text-ink-900">
            All findings
          </h1>
          <p className="text-sm text-ink-600 mt-2 max-w-2xl leading-relaxed">
            Every insight Claude has written about your brand&apos;s AI-search
            performance. Filter by severity or status, click any row for
            the full body and linked evidence.
          </p>
        </div>
        <Link
          href="/strategy"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-hairline text-ink-700 bg-surface hover:border-primary-400 hover:text-primary-700 transition-all shrink-0"
        >
          ← Back to Strategy
        </Link>
      </div>

      <FindingsView insights={insights} />

      {last_updated && (
        <p className="mt-6 text-[11px] text-ink-500 tabular-nums text-right">
          insights.json updated {last_updated.slice(0, 10)}
        </p>
      )}
    </>
  );
}

import { DraftPreview } from "@/components/DraftPreview";
import { ScrapeTrigger } from "@/components/ScrapeTrigger";
import { loadDrafts } from "@/lib/drafts";
import { loadLatestInventory, readScrapeState } from "@/lib/scrape";

export const dynamic = "force-dynamic";

/**
 * Settings → Data.
 *
 * The content pipeline trigger (scrape → assign → viz improvements)
 * and the list of Claude-authored page drafts. Moved here from
 * /settings on 2026-04-24 as part of the settings split.
 *
 * The "Refresh data" button for GSC/GA4/LLM traffic lives in the
 * sticky topbar and is NOT re-rendered here — it's a contextual
 * control, not a settings page.
 */
export default async function SettingsDataPage() {
  const [state, inventory, drafts] = await Promise.all([
    readScrapeState(),
    loadLatestInventory(),
    loadDrafts(),
  ]);

  // Sitemap label — shown in the explanatory copy. Reads from the
  // configured canonical origin or falls back to the placeholder.
  const sitemapOrigin = (process.env.SITE_CANONICAL_ORIGIN || "https://acme.io").replace(/\/$/, "");
  const sitemapLabel = `${sitemapOrigin.replace(/^https?:\/\//, "")}/sitemap.xml`;

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl md:text-3xl font-semibold text-slate-950 tracking-tight">
          Data
        </h1>
        <p className="text-sm text-slate-500 mt-1.5 max-w-2xl">
          Run the content pipeline (scrape → cluster-assign → visibility
          improvements) and preview new-page drafts Claude has written.
        </p>
      </header>

      {/* Content pipeline ------------------------------------------ */}
      <section className="bg-white border border-slate-200 rounded-xl mb-8">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-950">Content pipeline</h2>
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
            One click runs the full content chain:
          </p>
          <ol className="text-xs text-slate-500 mt-2 space-y-1 list-decimal list-inside leading-relaxed">
            <li>
              <strong>Scrape</strong> — walks{" "}
              <code className="text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">
                {sitemapLabel}
              </code>
              , extracts title, meta, headings, body text, schema types, claims,
              hreflang alternates. Writes{" "}
              <code className="text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">
                data/raw/content/&lt;date&gt;/
              </code>
              .
            </li>
            <li>
              <strong>Assign clusters</strong> — tags every page with a cluster +
              lang using the scraped content + URL. Writes{" "}
              <code className="text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">
                data/processed/page_clusters.json
              </code>
              .
            </li>
            <li>
              <strong>Compute visibility improvements</strong> — runs the 7
              opportunity rules (rank-without-schema, cited-but-thin, etc.) over
              the 30-day window. Writes{" "}
              <code className="text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">
                data/processed/visibility_improvements.json
              </code>
              .
            </li>
          </ol>
          <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
            <strong>Retry shell pages only</strong> runs the same 3 steps but
            step 1 re-scrapes only URLs whose last record looks like the CDN
            shell (word count 0, generic site title). Use it when a full run
            finishes with too many thin-page ghosts — it targets exactly the
            URLs that failed and skips the healthy ones.
          </p>
        </div>
        <div className="px-5 py-4">
          <ScrapeTrigger initialState={state} />
        </div>

        {inventory ? (
          <InventorySummary inventory={inventory} />
        ) : (
          <div className="px-5 py-8 text-sm text-slate-500 border-t border-slate-100 bg-slate-50/40">
            No content inventory yet. Click <strong>Run content pipeline</strong>{" "}
            above to build one.
          </div>
        )}
      </section>

      {/* Page drafts ----------------------------------------------- */}
      <section className="bg-white border border-slate-200 rounded-xl">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-950">Page drafts</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              New-page drafts Claude has written, stored in{" "}
              <code className="text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">
                data/drafts/pages/
              </code>
              . Ask Claude:{" "}
              <code className="text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">
                draft a new page for the [your task] content task
              </code>
              .
            </p>
          </div>
          <span className="text-[11px] text-slate-500 tabular-nums bg-slate-50 px-2 py-1 rounded">
            {drafts.length} draft{drafts.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="divide-y divide-slate-100">
          {drafts.length > 0 ? (
            <div className="px-5 py-4 space-y-3">
              {drafts.map((d) => (
                <DraftPreview key={d.filename} draft={d} />
              ))}
            </div>
          ) : (
            <EmptyDrafts />
          )}
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------

function InventorySummary({
  inventory,
}: {
  inventory: NonNullable<Awaited<ReturnType<typeof loadLatestInventory>>>;
}) {
  const schemaEntries = Object.entries(inventory.schema_coverage).slice(0, 8);

  return (
    <div className="border-t border-slate-100">
      <div className="px-5 py-3 bg-slate-50/60 flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
          Latest inventory · {inventory.date}
        </h3>
        <div className="text-[11px] text-slate-500 tabular-nums">
          generated {inventory.generated_at.slice(0, 16).replace("T", " ")}
        </div>
      </div>

      <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="URLs scraped" value={inventory.total_urls} />
        <Stat label="OK responses" value={inventory.ok_count} />
        <Stat label="Total words" value={inventory.total_words} />
        <Stat label="Avg words/page" value={inventory.avg_word_count} />
      </div>

      {/* Schema coverage */}
      {schemaEntries.length > 0 && (
        <div className="px-5 pb-4">
          <h3 className="text-[11px] uppercase tracking-wider text-slate-500 font-medium mb-2">
            Schema coverage
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {schemaEntries.map(([type, count]) => (
              <span
                key={type}
                className="text-xs bg-white border border-slate-200 rounded-md px-2 py-1 text-slate-700 tabular-nums"
              >
                <span className="font-medium text-slate-900">{type}</span>
                <span className="ml-1.5 text-slate-500">{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Gap lists */}
      <div className="grid grid-cols-1 md:grid-cols-3 border-t border-slate-100 md:divide-x md:divide-y-0 divide-y divide-slate-100">
        <GapList
          title="Thin pages (<300 words)"
          urls={inventory.pages_thin_lt_300_words}
          empty="All pages ≥ 300 words."
        />
        <GapList
          title="Missing numeric claims"
          urls={inventory.pages_without_claims}
          empty="All pages have claims."
          caption="Pages without $-values, regulatory marks, or quantified stats."
        />
        <GapList
          title="Missing meta description"
          urls={inventory.pages_missing_meta_description}
          empty="All pages have meta."
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums leading-tight text-slate-950">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function GapList({
  title,
  urls,
  empty,
  caption,
}: {
  title: string;
  urls: string[];
  empty: string;
  caption?: string;
}) {
  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
          {title}
        </h3>
        <span className="text-[11px] text-slate-500 tabular-nums font-medium bg-slate-50 px-2 py-0.5 rounded">
          {urls.length}
        </span>
      </div>
      {caption && <p className="text-[11px] text-slate-400 mt-1 mb-2">{caption}</p>}
      {urls.length > 0 ? (
        <ul className="mt-2 space-y-1 max-h-44 overflow-y-auto">
          {urls.slice(0, 20).map((u) => (
            <li key={u}>
              <a
                href={u}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-600 hover:underline break-all"
              >
                {u.replace(/^https?:\/\//, "")}
              </a>
            </li>
          ))}
          {urls.length > 20 && (
            <li className="text-[11px] text-slate-400">
              … +{urls.length - 20} more
            </li>
          )}
        </ul>
      ) : (
        <p className="text-xs text-slate-400 italic mt-2">{empty}</p>
      )}
    </div>
  );
}

function EmptyDrafts() {
  return (
    <div className="px-5 py-10 text-center">
      <p className="text-sm text-slate-700 font-medium">No page drafts yet.</p>
      <p className="text-xs text-slate-500 mt-2 max-w-md mx-auto">
        Ask Claude:{" "}
        <code className="text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
          draft a new page for tsk_2026_04_23_005
        </code>{" "}
        and the result will appear here. See the{" "}
        <code className="text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
          page-drafts
        </code>{" "}
        skill for the contract.
      </p>
    </div>
  );
}

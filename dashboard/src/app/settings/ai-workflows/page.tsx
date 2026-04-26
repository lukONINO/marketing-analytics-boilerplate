export const dynamic = "force-dynamic";

/**
 * Settings → AI workflows.
 *
 * Catalog of Claude skill prompts that extend the analytics pipeline.
 * Each workflow corresponds to a file under
 *   .claude/skills/marketing-analytics/
 * and runs only inside a Claude session (the MCP clients + reasoning
 * are Claude-side, not dashboard-side).
 *
 * Keep this list in sync when new skills land. Adding a new entry is a
 * two-file change — the .md skill file plus one row below.
 */

interface Workflow {
  name: string;
  /** Exactly what the user types in Claude. */
  trigger: string;
  when: string;
  what: string;
  writes?: string[];
  cadence?: string;
}

const WORKFLOWS: { group: string; items: Workflow[] }[] = [
  {
    group: "Daily & weekly routines",
    items: [
      {
        name: "Daily marketing report",
        trigger: "run daily marketing report",
        when: "Every weekday morning. The scheduled agent can also fire this.",
        what: "Pulls GSC + GA4 + LLM-traffic + Peec for yesterday, joins the four channels, writes a one-page narrative to the Marketing Reports Notion DB, and logs any flagged insights to data/dashboard/insights.json.",
        writes: [
          "Notion page under Marketing Reports",
          "data/dashboard/insights.json (if findings)",
        ],
        cadence: "Daily",
      },
      {
        name: "Weekly deep-dive",
        trigger: "run weekly report",
        when: "Mondays, for the prior ISO week. Long-form narrative with winners/losers + opportunity quadrants.",
        what: "Aggregates the full week, computes cross-channel winners + losers per query/page/cluster, surfaces rank-without-citation + citation-without-rank gaps, writes a longer Notion page with recommendations.",
        writes: ["Notion weekly report page", "knowledge/changelog.md entry"],
        cadence: "Weekly",
      },
      {
        name: "Refresh Peec knowledge",
        trigger: "refresh peec knowledge",
        when: "Weekly or when Peec ships a new engine / tool / anti-pattern note.",
        what: "Scrapes peec.ai's blog + docs, diffs what's new, and proposes edits to the skill's peec-ingest.md / seo-principles.md files. Never auto-edits config/topic_clusters.yaml.",
        writes: ["knowledge/peec-discovery-<date>.md"],
        cadence: "Weekly",
      },
    ],
  },
  {
    group: "Cluster + content workflows",
    items: [
      {
        name: "Analyze cluster",
        trigger: "analyze cluster <slug> [en|de]",
        when: "You want a deep-dive on one cluster — SEO, AI visibility, competitor positioning, content gaps — with 3 concrete actions to take this week.",
        what: "Loads all four data sources for the cluster (daily aggregate, page_clusters, scraped content, Peec MCP), computes competitor domain share via list_chats + get_chat, and writes a severity-tagged insight with 3 priority actions. Optional tasks can be created alongside.",
        writes: [
          "data/dashboard/insights.json (one new insight)",
          "data/dashboard/tasks.json (optional)",
        ],
      },
      {
        name: "Source-gap refresh",
        trigger: "/source-gap-refresh  (or: refresh source gaps)",
        when: "Weekly, or right before a cluster pillar-planning session. Populates the Insights → Source Gaps panel.",
        what: "Walks every Peec prompt in every cluster, fetches the most recent chat per prompt, and tallies which 3rd-party domains get cited in AI answers alongside (or instead of) your brand. Writes per-(cluster, lang) rollups with a gap_score 0-100.",
        writes: ["data/dashboard/source_gaps.json"],
        cadence: "Weekly",
      },
      {
        name: "Visibility lift",
        trigger: "visibility lift [top N | cluster <slug>]",
        when: "You want to act on the AI Visibility Improvements panel — either plan the fixes, draft the exact change sets, or create tasks.",
        what: "Reads data/processed/visibility_improvements.json, filters to the severity/cluster the user asked for, and either (a) produces a ranked list for planning, (b) drafts per-URL change sets with literal title/meta/schema strings, or (c) creates persistent tasks for each opportunity.",
        writes: ["data/dashboard/tasks.json (when asked)"],
      },
      {
        name: "GEO citation debug",
        trigger: "run geo debug",
        when: "You want a page-by-page AI-search relevance audit. Classifies every Peec prompt into one of four states (Cited / Retrieved-not-cited / Ranks-not-retrieved / No-page) and prescribes fixes in priority order.",
        what: "Pulls list_prompts + get_domain_report(dim=prompt_id, filter=domain:<your-domain>) + list_search_queries. Classifies each prompt into one of four states. For State B prompts, samples one get_chat to inspect AI phrasing. Maps prompts to clusters via topic_id, suggests target pages via page_clusters.json, and writes the full diagnostic + action groups to data/dashboard/geo_debug.json. Surfaced as the top panel on /insights.",
        writes: ["data/dashboard/geo_debug.json"],
        cadence: "Weekly or before a GEO planning session",
      },
    ],
  },
  {
    group: "Page drafting",
    items: [
      {
        name: "Draft a new page",
        trigger: "draft a new page for <task-id>",
        when: "You want Claude to write a full page draft for a tsk_... that calls for new content. Follows the page-drafts contract (≥3 numeric claims, schema anchor, comparison table, 4 internal links, EN/DE mirror).",
        what: "Reads the source task, mines proof points from the existing scrape + data/knowledge/proof-points.json, writes markdown with frontmatter to data/drafts/pages/, and surfaces it in Settings → Data → Page drafts.",
        writes: ["data/drafts/pages/<slug>.md"],
      },
    ],
  },
];

export default function SettingsAIWorkflowsPage() {
  const total = WORKFLOWS.reduce((n, g) => n + g.items.length, 0);

  return (
    <>
      <header className="mb-8">
        <span className="inline-block text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-700 bg-accent-50 px-2 py-0.5 rounded-md ring-1 ring-inset ring-accent-200 mb-2">
          Settings · Claude
        </span>
        <h1 className="font-display text-[28px] md:text-[32px] font-bold text-ink-900 tracking-tight">
          AI workflows
        </h1>
        <p className="text-sm text-ink-500 mt-1.5 max-w-2xl">
          {total} Claude skill prompts that extend the analytics pipeline. Each
          corresponds to a file in{" "}
          <code className="text-primary-700 bg-surface-muted border border-hairline px-1.5 py-0.5 rounded text-[11px]">
            .claude/skills/marketing-analytics/
          </code>{" "}
          and runs only inside a Claude session (MCP access + reasoning are
          Claude-side). Copy the <strong>Trigger</strong> line verbatim into
          Claude.
        </p>
      </header>

      <div className="space-y-8">
        {WORKFLOWS.map((group) => (
          <section key={group.group}>
            <h2 className="text-[11px] uppercase tracking-widest text-ink-500 font-medium mb-3">
              {group.group}
            </h2>
            <div className="space-y-3">
              {group.items.map((w) => (
                <WorkflowCard key={w.name} workflow={w} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function WorkflowCard({ workflow: w }: { workflow: Workflow }) {
  return (
    <article className="bg-surface border border-hairline rounded-ds shadow-card hover:shadow-card-hover transition-all px-4 md:px-5 py-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-ink-900 leading-tight">
            {w.name}
          </h3>
          {w.cadence && (
            <span className="mt-1 inline-block text-[10px] uppercase tracking-[0.12em] bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-200 px-2 py-0.5 rounded-md font-semibold">
              {w.cadence}
            </span>
          )}
        </div>
      </div>

      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-wider text-ink-500 font-medium mb-1">
          Trigger
        </div>
        <code className="block font-mono text-xs bg-primary-950 text-primary-100 px-3 py-2 rounded-md overflow-x-auto">
          {w.trigger}
        </code>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <InfoBlock label="When to run" body={w.when} />
        <InfoBlock label="What it does" body={w.what} />
      </div>

      {w.writes && w.writes.length > 0 && (
        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-wider text-ink-500 font-medium mb-1.5">
            Writes
          </div>
          <ul className="space-y-0.5">
            {w.writes.map((p) => (
              <li key={p} className="text-xs text-ink-600">
                <code className="text-primary-700 bg-surface-muted border border-hairline px-1.5 py-0.5 rounded text-[11px]">
                  {p}
                </code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function InfoBlock({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-500 font-medium mb-1">
        {label}
      </div>
      <p className="text-sm text-ink-700 leading-relaxed">{body}</p>
    </div>
  );
}

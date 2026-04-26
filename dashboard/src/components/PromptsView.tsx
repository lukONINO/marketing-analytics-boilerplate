"use client";

/**
 * Prompts view — the body of /strategy/prompts.
 *
 * Stacked surfaces, top-to-bottom:
 *
 *   1. Summary strip — chip-style stats over the whole prompt set
 *      (total tracked, stage-untagged, with-issues).
 *
 *   2. Malte 4-state classification panel — site-wide A/B/C/D
 *      distribution with the "what kind of fix" recommendation per
 *      state. Lives here (rather than per-cluster) because the prompt
 *      set itself is what gets curated; cluster pages still show the
 *      per-prompt state inline.
 *
 *   3. Issues panel — every prompt-set problem we can detect: branded
 *      contamination, mis-tagged, missing stage / lang, unmapped cluster,
 *      tag duplicates / malformed, stale state-D. Each row clickable →
 *      drawer with full detail + a copyable Claude prompt for the fix.
 *      Each row also has a "Dismiss" button — use after fixing the
 *      issue directly in Peec so the row disappears persistently
 *      (until next geo-debug pull, where it stays gone if the issue
 *      no longer triggers; if it does still trigger, the dismissal
 *      keeps it hidden). Dismissed issues are reachable via the
 *      "Show dismissed" toggle in the panel header — Restore brings
 *      them back. Persistence: data/dashboard/prompt_issue_dismissals.json.
 *
 *   4. Prompt table — every tracked Peec prompt with its cluster, funnel
 *      stage, language, 4-state classification, and headline performance
 *      numbers (citation rate, retrieved %). Filterable; click any row
 *      for the per-prompt drawer (full detail + recommended action +
 *      Claude prompt to refine the prompt itself).
 *
 * Inputs are server-loaded (geoDebug + computed issues + summary +
 * dismissed-id set) so the page is one round-trip. Dismiss/restore
 * mutates dismissed_ids via /api/prompt-issue-dismissals and updates
 * the local set optimistically.
 */

import clsx from "clsx";
import Link from "next/link";
import { useMemo, useState } from "react";

import { CopyPromptButton } from "@/components/CopyPromptButton";
import { DetailDrawer } from "@/components/DetailDrawer";
import { InfoTooltip } from "@/components/InfoTooltip";
import {
  ISSUE_KIND_META,
  type PromptIssue,
  type PromptIssueKind,
  type PromptIssueSeverity,
  type PromptsHealthSummary,
} from "@/lib/prompts-improvements";
import type { GeoPromptDiagnostic } from "@/lib/types";

export interface PromptsViewProps {
  prompts: GeoPromptDiagnostic[];
  issues: PromptIssue[];
  summary: PromptsHealthSummary;
  /** Map: cluster slug → display label, for the cluster chip + filter. */
  labelByCluster: Record<string, string>;
  /**
   * Issue ids the user has previously dismissed (loaded server-side
   * from data/dashboard/prompt_issue_dismissals.json). PromptsView
   * hides them by default; the "Show dismissed" toggle in the
   * IssuesPanel reveals them with a Restore action.
   */
  initialDismissedIds?: string[];
}

type StateFilter = "all" | "A" | "B" | "C" | "D";
type StageFilter = "all" | "TOFU" | "MOFU" | "BOFU" | "unknown";
type LangFilter = "all" | "en" | "de";

export function PromptsView({
  prompts,
  issues,
  summary,
  labelByCluster,
  initialDismissedIds = [],
}: PromptsViewProps) {
  // Filter state
  const [clusterFilter, setClusterFilter] = useState<string>("all");
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [langFilter, setLangFilter] = useState<LangFilter>("all");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [issuesOnly, setIssuesOnly] = useState(false);

  // Drawer state
  const [openIssue, setOpenIssue] = useState<PromptIssue | null>(null);
  const [openPrompt, setOpenPrompt] = useState<GeoPromptDiagnostic | null>(null);

  // Dismissed-issue state. Seeded from the server's persisted set;
  // mutates optimistically when the user clicks Dismiss / Restore so
  // the UI feels instant. The /api/prompt-issue-dismissals endpoint
  // is fire-and-forget — if it fails we revert + alert the user.
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(
    () => new Set(initialDismissedIds),
  );
  const [showDismissed, setShowDismissed] = useState(false);

  async function dismissIssue(issue: PromptIssue) {
    // Close the drawer if it was for this issue — no point keeping it
    // open on a row that's about to disappear.
    if (openIssue?.id === issue.id) setOpenIssue(null);
    const before = dismissedIds;
    const next = new Set(before);
    next.add(issue.id);
    setDismissedIds(next);
    try {
      const res = await fetch("/api/prompt-issue-dismissals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: issue.id,
          prompt_id: issue.prompt_id,
          kind: issue.kind,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setDismissedIds(before);
      alert(
        `Could not dismiss: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async function restoreIssue(id: string) {
    const before = dismissedIds;
    const next = new Set(before);
    next.delete(id);
    setDismissedIds(next);
    try {
      const res = await fetch(
        `/api/prompt-issue-dismissals/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      // 404 is fine here — it means the server already had no record
      // (e.g. someone deleted the file). Treat as success so we don't
      // spam the user with errors when their UI is just out of sync.
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setDismissedIds(before);
      alert(
        `Could not restore: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Split issues into active vs dismissed using the current set —
  // memo'd so we don't re-walk the full list on every render.
  const { activeIssues, dismissedIssues } = useMemo(() => {
    const active: PromptIssue[] = [];
    const dismissed: PromptIssue[] = [];
    for (const i of issues) {
      if (dismissedIds.has(i.id)) dismissed.push(i);
      else active.push(i);
    }
    return { activeIssues: active, dismissedIssues: dismissed };
  }, [issues, dismissedIds]);

  // Issue counts grouped by prompt — used to render an "issues" badge
  // count per row in the prompt table without re-iterating every render.
  // Counts only ACTIVE issues so dismissed ones don't inflate the badge
  // (the prompt-table badge tracks open work, not detected-but-cleared).
  const issueCountByPrompt = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of activeIssues) m.set(i.prompt_id, (m.get(i.prompt_id) ?? 0) + 1);
    return m;
  }, [activeIssues]);

  // The cluster filter dropdown lists every cluster that any prompt
  // in the set is assigned to. Sorted alphabetically by display label.
  const clusterOptions = useMemo(() => {
    const slugs = new Set<string>();
    for (const p of prompts) {
      if (p.cluster) slugs.add(p.cluster);
    }
    return Array.from(slugs)
      .map((slug) => ({ slug, label: labelByCluster[slug] ?? slug }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [prompts, labelByCluster]);

  const filteredPrompts = useMemo(() => {
    return prompts.filter((p) => {
      if (clusterFilter !== "all" && p.cluster !== clusterFilter) return false;
      if (stageFilter !== "all") {
        if (stageFilter === "unknown") {
          if (p.stage === "TOFU" || p.stage === "MOFU" || p.stage === "BOFU") return false;
        } else if (p.stage !== stageFilter) {
          return false;
        }
      }
      if (langFilter !== "all" && p.lang !== langFilter) return false;
      if (stateFilter !== "all" && p.state !== stateFilter) return false;
      if (issuesOnly && !issueCountByPrompt.has(p.prompt_id)) return false;
      return true;
    });
  }, [
    prompts,
    clusterFilter,
    stageFilter,
    langFilter,
    stateFilter,
    issuesOnly,
    issueCountByPrompt,
  ]);

  // Sort the filtered list: prompts with issues first, then state-D
  // / state-C, then state-A. Within ties, by citation_rate desc so
  // strong performers float up within their state.
  const sortedPrompts = useMemo(() => {
    const STATE_RANK = { D: 0, C: 1, B: 2, A: 3 } as const;
    return [...filteredPrompts].sort((a, b) => {
      const aIssues = issueCountByPrompt.get(a.prompt_id) ?? 0;
      const bIssues = issueCountByPrompt.get(b.prompt_id) ?? 0;
      if ((aIssues > 0) !== (bIssues > 0)) return bIssues - aIssues;
      const stateDelta = STATE_RANK[a.state] - STATE_RANK[b.state];
      if (stateDelta !== 0) return stateDelta;
      return b.citation_rate - a.citation_rate;
    });
  }, [filteredPrompts, issueCountByPrompt]);

  return (
    <>
      {/* ===== Quick stats ===== */}
      <SummaryStrip summary={summary} />

      {/* ===== Malte 4-state distribution =====
          The aggregate view of where every tracked prompt lands.
          Used to live on each cluster page; moved here because the
          prompt set is what gets curated. Per-prompt state chips
          still appear inline on /topics/[slug] (in the prompt rows). */}
      <FourStateDistributionPanel byState={summary.by_state} total={summary.total} />

      {/* ===== Issues panel =====
          Only renders when at least one issue exists (active OR
          dismissed). The panel itself handles toggling between the
          two views. Dismissed rows include a Restore action to bring
          them back; active rows include a Dismiss action to clear
          them after the user fixes the issue in Peec. */}
      {issues.length > 0 && (
        <IssuesPanel
          activeIssues={activeIssues}
          dismissedIssues={dismissedIssues}
          showDismissed={showDismissed}
          onToggleShowDismissed={() => setShowDismissed((v) => !v)}
          onSelect={setOpenIssue}
          onDismiss={dismissIssue}
          onRestore={restoreIssue}
        />
      )}

      {/* ===== Filters ===== */}
      <section className="mb-4 flex flex-wrap items-center gap-3 text-xs">
        <FilterSelect
          label="Cluster"
          value={clusterFilter}
          onChange={setClusterFilter}
          options={[
            { value: "all", label: "All clusters" },
            ...clusterOptions.map((c) => ({ value: c.slug, label: c.label })),
          ]}
        />
        <FilterSelect
          label="Stage"
          value={stageFilter}
          onChange={(v) => setStageFilter(v as StageFilter)}
          options={[
            { value: "all", label: "All stages" },
            { value: "TOFU", label: "TOFU" },
            { value: "MOFU", label: "MOFU" },
            { value: "BOFU", label: "BOFU" },
            { value: "unknown", label: "Unknown" },
          ]}
        />
        <FilterSelect
          label="Lang"
          value={langFilter}
          onChange={(v) => setLangFilter(v as LangFilter)}
          options={[
            { value: "all", label: "All" },
            { value: "en", label: "EN" },
            { value: "de", label: "DE" },
          ]}
        />
        <FilterSelect
          label="State"
          value={stateFilter}
          onChange={(v) => setStateFilter(v as StateFilter)}
          options={[
            { value: "all", label: "All states" },
            { value: "A", label: "A — Cited" },
            { value: "B", label: "B — Mentioned" },
            { value: "C", label: "C — Reached" },
            { value: "D", label: "D — No page" },
          ]}
        />
        <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-hairline bg-surface cursor-pointer hover:border-primary-400">
          <input
            type="checkbox"
            checked={issuesOnly}
            onChange={(e) => setIssuesOnly(e.target.checked)}
            className="accent-primary-700"
          />
          <span className="text-ink-700 font-medium">Issues only</span>
        </label>
        <span className="ml-auto text-ink-500 tabular-nums">
          {sortedPrompts.length} of {prompts.length} prompt
          {prompts.length === 1 ? "" : "s"}
        </span>
      </section>

      {/* ===== Prompt table ===== */}
      <section className="bg-surface border border-hairline rounded-2xl shadow-card overflow-hidden">
        <header className="px-5 py-3 border-b border-hairline bg-surface-muted/40 flex items-center gap-1.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
            All tracked prompts
          </h2>
          <InfoTooltip
            widthClass="w-96"
            label="About the prompt table"
            content={
              <>
                Every prompt currently tracked in Peec, joined to the latest
                geo-debug 4-state classification + cluster mapping. Click any
                row for the per-prompt drawer with full detail and a Claude
                prompt to help refine the prompt itself.
                <br /><br />
                Sort order: prompts with detected issues first, then by state
                (D / C / B / A), then by citation rate.
              </>
            }
          />
        </header>
        {sortedPrompts.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-ink-500">
            No prompts match the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted/40 text-[10px] uppercase tracking-[0.12em] text-ink-500">
                <tr>
                  <th className="text-left px-5 py-2.5 font-semibold">Prompt</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Cluster</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Stage</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Lang</th>
                  <th className="text-left px-3 py-2.5 font-semibold">State</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Citation</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Retrieved</th>
                  <th className="text-right px-5 py-2.5 font-semibold">Issues</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {sortedPrompts.map((p) => (
                  <PromptRow
                    key={p.prompt_id}
                    prompt={p}
                    issueCount={issueCountByPrompt.get(p.prompt_id) ?? 0}
                    clusterLabel={p.cluster ? labelByCluster[p.cluster] ?? p.cluster : null}
                    onSelect={() => setOpenPrompt(p)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <IssueDrawer
        issue={openIssue}
        onClose={() => setOpenIssue(null)}
        isDismissed={openIssue ? dismissedIds.has(openIssue.id) : false}
        onDismiss={openIssue ? () => dismissIssue(openIssue) : undefined}
        onRestore={openIssue ? () => restoreIssue(openIssue.id) : undefined}
      />
      <PromptDrawer
        prompt={openPrompt}
        onClose={() => setOpenPrompt(null)}
        clusterLabel={
          openPrompt?.cluster ? labelByCluster[openPrompt.cluster] ?? openPrompt.cluster : null
        }
        relatedIssues={
          openPrompt
            ? issues.filter((i) => i.prompt_id === openPrompt.prompt_id)
            : []
        }
      />
    </>
  );
}

// ---------------------------------------------------------------------
// Summary strip — five chip-style stats above the issues panel.
// ---------------------------------------------------------------------

function SummaryStrip({ summary }: { summary: PromptsHealthSummary }) {
  // A/D state counts intentionally NOT in this strip — the 4-state
  // distribution panel below covers all four states with the recommended
  // fix per state, so duplicating Cited / No-page tiles here adds noise.
  return (
    <section className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-6">
      <SummaryTile label="Tracked prompts" value={summary.total.toString()} />
      <SummaryTile
        label="Stage-untagged"
        value={summary.by_stage.unknown.toString()}
        sub={`of ${summary.total}`}
        tone={summary.by_stage.unknown > 0 ? "warn" : "neutral"}
      />
      <SummaryTile
        label="With issues"
        value={summary.with_issues.toString()}
        sub={`of ${summary.total}`}
        tone={summary.with_issues > 0 ? "warn" : "good"}
      />
    </section>
  );
}

function SummaryTile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "warn" | "bad" | "neutral";
}) {
  const valueColor =
    tone === "good" ? "text-emerald-700"
    : tone === "warn" ? "text-warning-600"
    : tone === "bad" ? "text-danger-600"
    : "text-ink-900";
  return (
    <div className="bg-surface border border-hairline rounded-xl px-4 py-3 shadow-card">
      <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-ink-500">
        {label}
      </div>
      <div className={`font-display text-2xl font-bold tabular-nums leading-none mt-1 ${valueColor}`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-ink-500 mt-1">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Issues panel
// ---------------------------------------------------------------------

function IssuesPanel({
  activeIssues,
  dismissedIssues,
  showDismissed,
  onToggleShowDismissed,
  onSelect,
  onDismiss,
  onRestore,
}: {
  activeIssues: PromptIssue[];
  dismissedIssues: PromptIssue[];
  showDismissed: boolean;
  onToggleShowDismissed: () => void;
  onSelect: (issue: PromptIssue) => void;
  onDismiss: (issue: PromptIssue) => void;
  onRestore: (id: string) => void;
}) {
  // Group counts per kind for the header summary — only counts the
  // currently-shown list (active OR dismissed) so the byline matches
  // what's rendered below.
  const shown = showDismissed ? dismissedIssues : activeIssues;
  const counts = useMemo(() => {
    const c: Partial<Record<PromptIssueKind, number>> = {};
    for (const i of shown) c[i.kind] = (c[i.kind] ?? 0) + 1;
    return c;
  }, [shown]);

  return (
    <section className="mb-6 bg-surface border border-hairline rounded-2xl shadow-card overflow-hidden">
      <header className="px-5 py-3.5 border-b border-hairline bg-surface-muted/30 flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
            {showDismissed ? "Dismissed changes" : "Suggested changes"}
          </h2>
          {dismissedIssues.length > 0 && (
            <button
              type="button"
              onClick={onToggleShowDismissed}
              className="text-[11px] text-primary-700 hover:text-primary-900 underline decoration-dotted underline-offset-2"
            >
              {showDismissed
                ? `← Back to suggested (${activeIssues.length})`
                : `Show ${dismissedIssues.length} dismissed →`}
            </button>
          )}
        </div>
        <span className="text-[11px] text-ink-500 tabular-nums">
          {shown.length} issue{shown.length === 1 ? "" : "s"}
          {shown.length > 0 && (
            <>
              {" · "}
              {Object.entries(counts)
                .map(([k, v]) => `${v} ${k.replace(/-/g, " ")}`)
                .join(" · ")}
            </>
          )}
        </span>
      </header>
      {shown.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-ink-500">
          {showDismissed
            ? "No dismissed issues yet."
            : "All clear — no suggested changes for the current prompt set."}
        </div>
      ) : (
        <ul className="divide-y divide-hairline max-h-[28rem] overflow-y-auto">
          {shown.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              dismissed={showDismissed}
              onSelect={() => onSelect(issue)}
              onDismiss={() => onDismiss(issue)}
              onRestore={() => onRestore(issue.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function IssueRow({
  issue,
  dismissed,
  onSelect,
  onDismiss,
  onRestore,
}: {
  issue: PromptIssue;
  dismissed: boolean;
  onSelect: () => void;
  onDismiss: () => void;
  onRestore: () => void;
}) {
  function handleKey(e: React.KeyboardEvent<HTMLLIElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect();
    }
  }
  const meta = ISSUE_KIND_META[issue.kind];
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKey}
      className={clsx(
        "px-5 py-3 hover:bg-surface-muted/40 focus:bg-surface-muted/40 focus:outline-none transition-colors cursor-pointer",
        dismissed && "opacity-65",
      )}
    >
      <div className="flex items-start gap-3">
        <SeverityDot severity={issue.severity} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-[0.12em] font-semibold px-1.5 py-0.5 rounded bg-surface-muted text-ink-700 ring-1 ring-inset ring-hairline">
              {meta.label}
            </span>
            <span className="text-sm font-medium text-ink-900 leading-tight truncate">
              {issue.prompt_text}
            </span>
          </div>
          <p className="text-[12px] text-ink-600 mt-1 leading-relaxed line-clamp-2">
            {issue.detail}
          </p>
          <div
            className="mt-1.5 flex items-center gap-2 flex-wrap"
            onClick={(e) => e.stopPropagation()}
          >
            {!dismissed && (
              <CopyPromptButton prompt={issue.claude_prompt} variant="inline" />
            )}
            {dismissed ? (
              <button
                type="button"
                onClick={onRestore}
                className="text-[10px] uppercase tracking-[0.12em] font-semibold px-1.5 py-0.5 rounded bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-200 hover:bg-primary-100 transition-colors"
                title="Bring this issue back to the suggested-changes list"
              >
                Restore
              </button>
            ) : (
              <button
                type="button"
                onClick={onDismiss}
                className="text-[10px] uppercase tracking-[0.12em] font-semibold px-1.5 py-0.5 rounded bg-surface-muted text-ink-700 ring-1 ring-inset ring-hairline hover:bg-ink-100 hover:text-ink-900 transition-colors"
                title="Hide this row — use after fixing the issue in Peec yourself"
              >
                Dismiss
              </button>
            )}
            <span className="text-[10px] text-ink-500 font-mono">{issue.prompt_id}</span>
          </div>
        </div>
        <span className="text-ink-400 shrink-0 mt-1 text-sm" aria-hidden>›</span>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------
// Prompt table row
// ---------------------------------------------------------------------

function PromptRow({
  prompt,
  issueCount,
  clusterLabel,
  onSelect,
}: {
  prompt: GeoPromptDiagnostic;
  issueCount: number;
  clusterLabel: string | null;
  onSelect: () => void;
}) {
  function handleKey(e: React.KeyboardEvent<HTMLTableRowElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect();
    }
  }
  return (
    <tr
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKey}
      className="hover:bg-surface-muted/40 focus:bg-surface-muted/40 focus:outline-none cursor-pointer transition-colors"
    >
      <td className="px-5 py-2.5 max-w-md">
        <div className="text-ink-900 truncate" title={prompt.prompt_text}>
          {prompt.prompt_text}
        </div>
      </td>
      <td className="px-3 py-2.5 text-xs text-ink-700">
        {clusterLabel ?? <span className="text-ink-400 italic">unmapped</span>}
      </td>
      <td className="px-3 py-2.5 text-xs">
        {prompt.stage === "TOFU" || prompt.stage === "MOFU" || prompt.stage === "BOFU"
          ? <StagePill stage={prompt.stage} />
          : <span className="text-[10px] text-ink-400 italic">heuristic</span>}
      </td>
      <td className="px-3 py-2.5 text-xs text-ink-600 uppercase">
        {prompt.lang}
      </td>
      <td className="px-3 py-2.5">
        <StateChip state={prompt.state} />
      </td>
      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-ink-700">
        {prompt.citation_rate.toFixed(2)}
      </td>
      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-ink-700">
        {(prompt.retrieved_percentage * 100).toFixed(0)}%
      </td>
      <td className="px-5 py-2.5 text-right">
        {issueCount > 0 ? (
          <span className="inline-flex items-center justify-center min-w-[1.25rem] px-1.5 py-0.5 text-[10px] uppercase font-semibold tracking-wider rounded-full bg-warning-50 text-warning-600 ring-1 ring-inset ring-warning/25">
            {issueCount}
          </span>
        ) : (
          <span className="text-ink-300">—</span>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------
// Drawers
// ---------------------------------------------------------------------

function IssueDrawer({
  issue,
  onClose,
  isDismissed,
  onDismiss,
  onRestore,
}: {
  issue: PromptIssue | null;
  onClose: () => void;
  isDismissed: boolean;
  onDismiss?: () => void;
  onRestore?: () => void;
}) {
  return (
    <DetailDrawer
      open={!!issue}
      onClose={onClose}
      eyebrow={
        issue && (
          <div className="inline-flex items-center gap-2">
            <SeverityPill severity={issue.severity} />
            <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-ink-700">
              {ISSUE_KIND_META[issue.kind].label}
            </span>
            {isDismissed && (
              <span className="text-[10px] uppercase tracking-[0.12em] font-semibold px-1.5 py-0.5 rounded bg-surface-muted text-ink-600 ring-1 ring-inset ring-hairline">
                Dismissed
              </span>
            )}
          </div>
        )
      }
      title={issue?.prompt_text}
    >
      {issue && (
        <div className="px-5 py-4 space-y-4">
          <div className="text-[11px] text-ink-500 font-mono">{issue.prompt_id}</div>
          <div>
            <div className="text-[10px] uppercase tracking-wider font-semibold text-ink-500 mb-1.5">
              Why this is flagged
            </div>
            <p className="text-sm text-ink-700 leading-relaxed">{issue.detail}</p>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider font-semibold text-ink-500 mb-1.5">
              Suggested action
            </div>
            <p className="text-sm text-ink-700 leading-relaxed">{issue.suggested_action}</p>
          </div>
          {!isDismissed && (
            <div className="border-t border-hairline pt-4">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-ink-500 mb-2">
                Hand off to Claude
              </div>
              <div className="bg-ink-900 text-white text-[12px] font-mono p-3 rounded-lg overflow-x-auto whitespace-pre-wrap leading-relaxed mb-2">
                {issue.claude_prompt}
              </div>
              <CopyPromptButton prompt={issue.claude_prompt} variant="block" />
            </div>
          )}

          {/* Dismiss / Restore — explicit reset action below the Claude
              hand-off so users who fixed the issue in Peec themselves
              can clear the row without needing to use the inline button
              in the list. */}
          <div className="border-t border-hairline pt-4 flex items-center gap-2 flex-wrap">
            {isDismissed ? (
              <>
                <button
                  type="button"
                  onClick={onRestore}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100 transition-colors"
                >
                  Restore to suggested changes
                </button>
                <span className="text-[11px] text-ink-500">
                  This issue will reappear in the active list.
                </span>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onDismiss}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-hairline bg-surface text-ink-700 hover:border-ink-400 hover:text-ink-900 transition-colors"
                >
                  Dismiss
                </button>
                <span className="text-[11px] text-ink-500">
                  Use after you&apos;ve fixed it directly in Peec.
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </DetailDrawer>
  );
}

function PromptDrawer({
  prompt,
  onClose,
  clusterLabel,
  relatedIssues,
}: {
  prompt: GeoPromptDiagnostic | null;
  onClose: () => void;
  clusterLabel: string | null;
  relatedIssues: PromptIssue[];
}) {
  const refinePrompt = prompt
    ? `review and improve Peec prompt ${prompt.prompt_id}: "${prompt.prompt_text}"
Cluster: ${clusterLabel ?? prompt.cluster ?? "unmapped"} (${prompt.lang})
Funnel stage: ${prompt.stage ?? "unknown"}
4-state: ${prompt.state} · citation_rate ${prompt.citation_rate.toFixed(2)} · retrieved ${(prompt.retrieved_percentage * 100).toFixed(0)}%

Critique:
  - Is the phrasing buyer-realistic? (do real ICPs ask this verbatim?)
  - Does it target a clear job-to-be-done?
  - Does it avoid the brand-name-inflation anti-pattern (no brand name unless tagged branded)?
  - Is the funnel stage obvious from the wording?

If the prompt is fine, say so. Otherwise propose 1-3 rewrites and explain the tradeoff. Don't update Peec yet — return the recommendations only.`
    : "";

  return (
    <DetailDrawer
      open={!!prompt}
      onClose={onClose}
      eyebrow={
        prompt && (
          <div className="inline-flex items-center gap-2 flex-wrap">
            <StateChip state={prompt.state} />
            {prompt.stage === "TOFU" || prompt.stage === "MOFU" || prompt.stage === "BOFU" ? (
              <StagePill stage={prompt.stage} />
            ) : (
              <span className="text-[10px] uppercase tracking-[0.12em] font-medium text-ink-500">
                heuristic stage
              </span>
            )}
            <span className="text-[10px] uppercase tracking-wider text-ink-500">
              {prompt.lang}
            </span>
          </div>
        )
      }
      title={prompt?.prompt_text}
      headerTrailing={
        prompt?.cluster ? (
          <Link
            href={`/topics/${prompt.cluster}`}
            className="text-[11px] text-primary-700 hover:text-primary-900 font-medium"
          >
            {clusterLabel ?? prompt.cluster} →
          </Link>
        ) : null
      }
    >
      {prompt && (
        <div className="px-5 py-4 space-y-4">
          <div className="text-[11px] text-ink-500 font-mono">
            {prompt.prompt_id} · topic {prompt.topic_id}
          </div>

          {/* Performance grid */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Meta label="Citation rate">
              <span className="tabular-nums">{prompt.citation_rate.toFixed(2)}</span>
            </Meta>
            <Meta label="Retrieved %">
              <span className="tabular-nums">
                {(prompt.retrieved_percentage * 100).toFixed(0)}%
              </span>
            </Meta>
            <Meta label="Retrieval rate">
              <span className="tabular-nums">{prompt.retrieval_rate.toFixed(2)}</span>
            </Meta>
            <Meta label="Fanout queries">
              <span className="tabular-nums">{prompt.fanout_count ?? 0}</span>
            </Meta>
          </dl>

          {prompt.fanout_queries_sample?.length > 0 && (
            <div className="border-t border-hairline pt-4">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-ink-500 mb-2">
                Fanout queries (sample)
              </div>
              <ul className="text-xs text-ink-700 list-disc list-inside space-y-1">
                {prompt.fanout_queries_sample.slice(0, 5).map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          )}

          {prompt.recommended_action && (
            <div className="border-t border-hairline pt-4">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-ink-500 mb-2">
                Page-side recommendation (from geo-debug)
              </div>
              <p className="text-sm text-ink-700 leading-relaxed">
                {prompt.recommended_action}
              </p>
            </div>
          )}

          {relatedIssues.length > 0 && (
            <div className="border-t border-hairline pt-4">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-ink-500 mb-2">
                Open issues for this prompt
              </div>
              <ul className="space-y-1">
                {relatedIssues.map((i) => (
                  <li key={i.id} className="flex items-start gap-2 text-xs">
                    <SeverityDot severity={i.severity} />
                    <span className="text-ink-700">{ISSUE_KIND_META[i.kind].label}: <span className="text-ink-600">{i.detail}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="border-t border-hairline pt-4">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-ink-500 mb-2">
              Hand off to Claude — refine this prompt
            </div>
            <div className="bg-ink-900 text-white text-[12px] font-mono p-3 rounded-lg overflow-x-auto whitespace-pre-wrap leading-relaxed mb-2">
              {refinePrompt}
            </div>
            <CopyPromptButton prompt={refinePrompt} variant="block" />
          </div>
        </div>
      )}
    </DetailDrawer>
  );
}

// ---------------------------------------------------------------------
// Malte 4-state distribution panel
//
// Site-wide A/B/C/D distribution of every tracked Peec prompt, with the
// "what kind of fix" recommendation per state. Lives on /strategy/prompts
// because the prompt set is the thing being curated; per-cluster pages
// still surface the inline state chip per prompt row.
// ---------------------------------------------------------------------

function FourStateDistributionPanel({
  byState,
  total,
}: {
  byState: Record<"A" | "B" | "C" | "D", number>;
  total: number;
}) {
  if (total === 0) {
    return (
      <section className="mb-6 bg-warning-50 border border-warning/25 rounded-2xl p-6 text-center">
        <p className="text-sm text-ink-700">
          No prompts classified yet — run{" "}
          <code className="font-mono text-[12px] bg-surface-muted px-1.5 py-0.5 rounded">
            run geo debug
          </code>{" "}
          via Claude.
        </p>
      </section>
    );
  }

  const states = [
    {
      key: "A",
      count: byState.A,
      label: "Cited",
      sub: "AI shows clickable link",
      color: "bg-emerald-500",
      ringColor: "ring-emerald-200",
      textColor: "text-emerald-700",
      bgColor: "bg-emerald-50",
      fix: "Nothing to do — defend.",
    },
    {
      key: "B",
      count: byState.B,
      label: "Mentioned",
      sub: "Named, not linked",
      color: "bg-amber-500",
      ringColor: "ring-amber-200",
      textColor: "text-amber-700",
      bgColor: "bg-amber-50",
      fix: "Citeability fix — add summary blocks, schema, claim density.",
    },
    {
      key: "C",
      count: byState.C,
      label: "Reached",
      sub: "Search reaches, but our domain isn't retrieved",
      color: "bg-orange-500",
      ringColor: "ring-orange-200",
      textColor: "text-orange-700",
      bgColor: "bg-orange-50",
      fix: "Source-worthiness fix — EEAT, named author, external citations.",
    },
    {
      key: "D",
      count: byState.D,
      label: "No page",
      sub: "No relevant page exists",
      color: "bg-red-500",
      ringColor: "ring-red-200",
      textColor: "text-red-700",
      bgColor: "bg-red-50",
      fix: "Create the page — pillar build, ≥1500 words, schema.",
    },
  ] as const;

  return (
    <section className="mb-6 bg-surface border border-hairline rounded-2xl shadow-card overflow-hidden">
      <header className="px-5 py-3.5 border-b border-hairline bg-surface-muted/30 flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-semibold text-ink-900">
            4-state citation classification
          </h2>
          <InfoTooltip
            widthClass="w-96"
            label="About the 4-state classification"
            content={
              <>
                Every tracked prompt lands in exactly one of four states
                based on what AI engines do with it — and each state needs
                a different fix.
                <br /><br />
                <strong>Cited (A)</strong> — AI shows a clickable link to
                your site. Best case; defend.
                <br />
                <strong>Mentioned (B)</strong> — AI names your brand without
                linking. Citeability fix on-page.
                <br />
                <strong>Reached (C)</strong> — AI search retrieves a SERP
                for the query but our domain isn&apos;t pulled. Source-
                worthiness fix.
                <br />
                <strong>No page (D)</strong> — no relevant page on your site
                exists. Create one.
              </>
            }
          />
        </div>
        <span className="text-[11px] text-ink-500 tabular-nums">
          {total} prompt{total === 1 ? "" : "s"}
        </span>
      </header>

      {/* Stacked bar — segments proportional to total */}
      <div className="px-5 pt-5">
        <div className="flex h-3 rounded-full overflow-hidden ring-1 ring-inset ring-hairline">
          {states.map((s) => {
            const pct = total > 0 ? (s.count / total) * 100 : 0;
            if (pct === 0) return null;
            return (
              <div
                key={s.key}
                className={s.color}
                style={{ width: `${pct}%` }}
                title={`${s.label}: ${s.count} (${pct.toFixed(0)}%)`}
              />
            );
          })}
        </div>
      </div>

      {/* Per-state cards — letter chip + label + count + sub + fix */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 p-5">
        {states.map((s) => (
          <div
            key={s.key}
            className={clsx(
              "rounded-xl ring-1 ring-inset px-3.5 py-3",
              s.bgColor,
              s.ringColor,
            )}
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className={clsx(
                  "inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-bold text-white",
                  s.color,
                )}
              >
                {s.key}
              </span>
              <span className={clsx("text-sm font-semibold", s.textColor)}>
                {s.label}
              </span>
              <span
                className={clsx(
                  "ml-auto font-display font-bold tabular-nums text-lg",
                  s.textColor,
                )}
              >
                {s.count}
              </span>
            </div>
            <p className="text-[11px] text-ink-600 leading-snug">{s.sub}</p>
            <p className="text-[10px] text-ink-500 mt-1.5 leading-snug italic">
              {s.fix}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------
// Atoms
// ---------------------------------------------------------------------

function FilterSelect<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-hairline bg-surface">
      <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-ink-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="bg-transparent text-ink-900 text-xs font-medium focus:outline-none cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function StagePill({ stage }: { stage: "TOFU" | "MOFU" | "BOFU" }) {
  const styles = {
    TOFU: "bg-accent-50 text-accent-700 ring-accent-200",
    MOFU: "bg-primary-50 text-primary-700 ring-primary-200",
    BOFU: "bg-success-50 text-success-600 ring-success/25",
  } as const;
  return (
    <span
      className={clsx(
        "inline-flex items-center text-[10px] uppercase tracking-[0.12em] font-semibold px-1.5 py-0.5 rounded ring-1 ring-inset",
        styles[stage],
      )}
    >
      {stage}
    </span>
  );
}

function StateChip({ state }: { state: "A" | "B" | "C" | "D" }) {
  const map = {
    A: { cls: "bg-emerald-100 text-emerald-800 ring-emerald-300/60", title: "Cited — AI shows clickable link" },
    B: { cls: "bg-amber-100 text-amber-800 ring-amber-300/60", title: "Mentioned, not linked" },
    C: { cls: "bg-orange-100 text-orange-800 ring-orange-300/60", title: "Search reaches but our domain not retrieved" },
    D: { cls: "bg-red-100 text-red-800 ring-red-300/60", title: "No relevant page exists" },
  } as const;
  const m = map[state];
  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-bold ring-1 ring-inset",
        m.cls,
      )}
      title={m.title}
    >
      {state}
    </span>
  );
}

function SeverityDot({ severity }: { severity: PromptIssueSeverity }) {
  const cls =
    severity === "high" ? "bg-danger-500 ring-danger/20"
    : severity === "medium" ? "bg-warning-500 ring-warning/25"
    : "bg-ink-400 ring-hairline";
  return <span className={clsx("mt-1.5 w-2 h-2 rounded-full shrink-0 ring-4", cls)} aria-hidden />;
}

function SeverityPill({ severity }: { severity: PromptIssueSeverity }) {
  const styles =
    severity === "high" ? "bg-danger-50 text-danger-600 ring-danger/20"
    : severity === "medium" ? "bg-warning-50 text-warning-600 ring-warning/25"
    : "bg-surface-muted text-ink-600 ring-hairline";
  return (
    <span className={clsx(
      "inline-flex items-center text-[10px] uppercase tracking-[0.12em] font-semibold px-1.5 py-0.5 rounded ring-1 ring-inset",
      styles,
    )}>
      {severity === "high" ? "High" : severity === "medium" ? "Medium" : "Low"}
    </span>
  );
}

function Meta({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider font-semibold text-ink-500 mb-0.5">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

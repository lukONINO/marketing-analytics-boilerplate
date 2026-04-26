"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";

import type { RefreshState } from "@/lib/types";

const POLL_INTERVAL_MS = 3_000;

type RefreshMode = "incremental" | "backfill" | "aggregate-only";

/**
 * Refresh button + live status indicator.
 *
 * Click the button → dropdown menu with three sections:
 *
 *   1. "Daily refresh workflow" (headline, always expanded) — a
 *      4-step ordered checklist mixing dashboard-runnable actions
 *      (steps 1, 3) with Claude-side prompts (steps 2, 4). Designed
 *      so a user can see the full daily routine at a glance instead
 *      of guessing which buttons to click in what order.
 *
 *   2. "Backfill" (collapsible) — re-pull a wider window of GSC/GA4/LLM
 *      when historical data has updated. Power-user option.
 *
 *   3. "More Claude workflows" (collapsible) — full catalog of
 *      Claude-side skills (cluster audits, page drafting, etc.).
 *      Filtered to exclude prompts already featured in the daily
 *      checklist so they don't appear twice.
 *
 * While running → polls GET /api/refresh every 3s and shows log tail
 * in the separate "Data freshness" popover (click the status pill).
 * On completion → router.refresh() pulls fresh Server Component data.
 */
export function RefreshButton({ initialState }: { initialState: RefreshState }) {
  const router = useRouter();
  const [state, setState] = useState<RefreshState>(initialState);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [expandedFreshness, setExpandedFreshness] = useState(false);
  /** Pending describes "click fired, POST in flight": we optimistically
   *  show the spinner from the moment of click, before the server
   *  confirms `status: "running"`. Covers the POST round-trip gap. */
  const [pendingAction, setPendingAction] = useState<null | {
    mode: RefreshMode;
    daysBack: number;
  }>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const isRunning = state.status === "running";
  /** Unified spinner signal: optimistic during the POST round-trip,
   *  then driven by the server's state. */
  const isBusy = isRunning || pendingAction !== null;

  // Poll whenever we think a refresh is in flight — that includes the
  // optimistic pending window (between click and POST response) AND
  // the server-confirmed running window. Polling during the pending
  // window acts as a safety net in case the POST response races past
  // `status: "running"` and lands on a later state transition.
  useEffect(() => {
    if (!isBusy) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/refresh", { cache: "no-store" });
        const newState: RefreshState = await res.json();
        setState(newState);
        if (newState.status !== "running") {
          clearInterval(id);
          setPendingAction(null);
          startTransition(() => router.refresh());
        }
      } catch (err) {
        console.error("poll error", err);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isBusy, router]);

  // Close menu on click-outside + Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (
        menuRef.current?.contains(e.target as Node) ||
        buttonRef.current?.contains(e.target as Node)
      ) return;
      setMenuOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menuOpen]);

  async function triggerRefresh(mode: RefreshMode, daysBack: number) {
    setMenuOpen(false);
    setError(null);
    // Optimistic: flip the button to the spinning state IMMEDIATELY so
    // the user has visual confirmation the click registered. The
    // pendingAction is cleared once the server confirms `running`.
    setPendingAction({ mode, daysBack });
    try {
      const res = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, days_back: daysBack }),
      });
      if (!res.ok && res.status !== 202) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `HTTP ${res.status}`);
        setPendingAction(null); // clear spinner on failure
        return;
      }
      const fresh: RefreshState = await res.json();
      setState(fresh);
    } catch (err) {
      setError(String(err));
      setPendingAction(null);
    }
  }

  // Once the server confirms "running" state, we no longer need
  // pendingAction — the real state drives the spinner from here on.
  useEffect(() => {
    if (isRunning) setPendingAction(null);
  }, [isRunning]);

  const lastRun = state.sources.aggregate.last_run_at
    ?? state.sources.gsc.last_run_at
    ?? state.sources.ga4.last_run_at;
  const lastRunLabel = lastRun ? formatAgo(lastRun) : "never";

  // When running, we show days_back from pending action (optimistic)
  // or state (confirmed) so the user knows the scope without waiting.
  const runningScope = pendingAction?.daysBack ?? state.days_back ?? 0;
  const runningModeLabel = pendingAction?.mode === "aggregate-only"
    ? `Re-aggregating ${runningScope}d`
    : pendingAction?.mode === "incremental"
    ? "Loading latest"
    : pendingAction?.mode === "backfill"
    ? `Backfilling ${runningScope}d`
    : runningScope
    ? `Refreshing (${runningScope}d)`
    : "Refreshing…";

  return (
    <div className="relative flex items-center gap-2">
      {/* Status pill — click to open the Data freshness popover. */}
      <button
        type="button"
        onClick={() => setExpandedFreshness((v) => !v)}
        className="hidden sm:flex text-xs text-ink-500 hover:text-ink-900 items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-surface-muted transition-colors"
        title="Click for data-freshness detail"
      >
        <StatusDot status={state.status} />
        <span>
          GSC/GA4 <strong className="text-ink-900 font-medium tabular-nums">{lastRunLabel}</strong>
        </span>
      </button>

      {/* Refresh button — click to open the action menu. */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        disabled={isBusy}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={clsx(
          "inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-full transition-all",
          isBusy
            ? "bg-accent-600 text-white cursor-wait shadow-card"
            : "bg-primary-600 text-white hover:bg-primary-700 shadow-card hover:shadow-card-hover active:translate-y-[0.5px]"
        )}
      >
        {isBusy ? (
          <>
            <Spinner />
            <span>{runningModeLabel}</span>
          </>
        ) : (
          <>
            <RefreshIcon />
            <span>Refresh data</span>
            <Chevron />
          </>
        )}
      </button>

      {/* Action menu — daily workflow first, then collapsible secondaries. */}
      {menuOpen && !isBusy && (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 top-full mt-2 bg-surface border border-hairline rounded-xl shadow-pop w-[26rem] max-h-[42rem] overflow-y-auto z-30"
        >
          {/* ---- Section 1: Daily workflow checklist ---- */}
          <DailyWorkflowSection
            triggerRefresh={triggerRefresh}
            state={state}
          />

          {/* ---- Section 2: Backfill (collapsible) ---- */}
          <CollapsibleSection
            title="Backfill — re-pull a wider window"
            description="Use when GSC or GA4 published new historical data, or when a date range needs a full re-fetch."
          >
            <MenuItem
              title="Backfill last 7 days"
              sub="Re-pull GSC + GA4 + LLM, then re-aggregate"
              onClick={() => triggerRefresh("backfill", 7)}
              icon="refresh"
            />
            <MenuItem
              title="Backfill last 30 days"
              sub="~30 GA4 + 30 GSC calls"
              onClick={() => triggerRefresh("backfill", 30)}
              icon="refresh"
            />
            <MenuItem
              title="Backfill last 90 days"
              sub="~90 GA4 + 90 GSC calls · slow"
              onClick={() => triggerRefresh("backfill", 90)}
              icon="refresh"
            />
          </CollapsibleSection>

          {/* ---- Section 3: All Claude workflows (collapsible) ---- */}
          <CollapsibleSection
            title="More Claude workflows"
            description="Cluster audits, page drafting, and other one-off skills. Copy any prompt to use in a Claude session."
          >
            <ul className="py-1">
              {CLAUDE_PROMPTS.filter((p) => !DAILY_WORKFLOW_PROMPT_TRIGGERS.has(p.prompt)).map((p) => (
                <PromptRow key={p.name} prompt={p} />
              ))}
            </ul>
          </CollapsibleSection>
        </div>
      )}

      {/* Error banner. */}
      {error && (
        <div className="absolute right-0 top-full mt-2 bg-danger-50 border border-danger/40 text-danger-600 text-xs rounded-lg px-3 py-2 max-w-xs z-30 shadow-card">
          {error}
        </div>
      )}

      {/* Data-freshness popover. */}
      {expandedFreshness && (
        <div className="absolute right-0 top-full mt-2 bg-surface border border-hairline rounded-xl shadow-pop p-4 w-96 z-20 text-xs">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-ink-900">Data freshness</h3>
            <button onClick={() => setExpandedFreshness(false)} className="text-ink-500 hover:text-ink-900 transition-colors">✕</button>
          </div>

          <dl className="space-y-2">
            {(["gsc", "ga4", "llm_traffic", "aggregate"] as const).map((src) => {
              const s = state.sources[src];
              return (
                <div key={src} className="flex items-start justify-between gap-3">
                  <dt className="text-ink-500 uppercase tracking-[0.12em] text-[10px] pt-0.5 font-semibold">
                    {src === "llm_traffic" ? "LLM Traffic" : src}
                  </dt>
                  <dd className="text-ink-900 text-right">
                    <div className="tabular-nums">{s.last_run_at ? formatAgo(s.last_run_at) : "never"}</div>
                    {s.latest_date && <div className="text-ink-500">latest: {s.latest_date}</div>}
                    {s.last_error && <div className="text-danger-500 truncate max-w-[12rem]">✗ {s.last_error}</div>}
                  </dd>
                </div>
              );
            })}
            <div className="pt-2 border-t border-hairline text-ink-500">
              <div className="italic">{state.peec_note}</div>
              <div className="italic mt-1">{state.notion_note}</div>
            </div>
          </dl>

          {(isRunning || state.log_tail.length > 0) && (
            <details className="mt-3 pt-2 border-t border-hairline" open={isRunning}>
              <summary className="cursor-pointer text-ink-500 hover:text-ink-900 transition-colors">
                Log ({state.log_tail.length} lines)
              </summary>
              <pre className="mt-2 bg-surface-muted border border-hairline rounded-lg p-2 max-h-48 overflow-y-auto font-mono text-[11px] whitespace-pre-wrap text-ink-700">
                {state.log_tail.slice(-20).join("\n")}
              </pre>
            </details>
          )}

          {pending && (
            <div className="mt-2 text-ink-500 italic">Reloading view…</div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Claude-workflow prompt catalog
// ---------------------------------------------------------------------
//
// Mirrors /settings/ai-workflows exactly — keep in sync whenever a new
// skill lands. `prompt` is what gets copied verbatim; `cadence` + `hint`
// are display-only and should stay terse (this is a dropdown, not a
// full page).
//
// Ordering: routines the user runs most often → cluster/content work →
// page drafting. The daily + weekly reports sit at the top so they're
// reachable with the least scrolling.

interface ClaudePrompt {
  name: string;
  prompt: string;
  cadence?: string;
  hint: string;
}

const CLAUDE_PROMPTS: ClaudePrompt[] = [
  {
    name: "Daily marketing report",
    prompt: "run daily marketing report",
    cadence: "Daily",
    hint: "GSC + GA4 + LLM + Peec → Notion",
  },
  {
    name: "Weekly deep-dive",
    prompt: "run weekly report",
    cadence: "Mon",
    hint: "Full-week winners/losers + quadrants",
  },
  {
    name: "Pull Peec (last 7 days)",
    prompt: "pull peec data for the last 7 days",
    hint: "Backfill Peec daily JSONs via MCP",
  },
  {
    name: "Refresh Peec knowledge",
    prompt: "refresh peec knowledge",
    cadence: "Weekly",
    hint: "Scrape Peec blog/docs for changes",
  },
  {
    name: "GEO citation debug",
    prompt: "run geo debug",
    cadence: "Weekly",
    hint: "4-state per-prompt citation audit",
  },
  {
    name: "Source-gap refresh",
    prompt: "/source-gap-refresh",
    cadence: "Weekly",
    hint: "Fills Insights → Source Gaps panel",
  },
  {
    name: "Visibility lift (top 5)",
    prompt: "visibility lift top 5",
    hint: "Act on AI Visibility Improvements",
  },
  {
    name: "Analyze cluster",
    prompt: "analyze cluster <slug> en",
    hint: "Replace <slug> with one of your cluster slugs",
  },
  {
    name: "Create cluster",
    prompt: "create cluster \"<name>\"",
    hint: "Replace <name> — will scaffold slug + lang pair",
  },
  {
    name: "Draft a new page",
    prompt: "draft a new page for <task-id>",
    hint: "Replace <task-id> with a tsk_... ID",
  },
];

/**
 * The prompts the daily-workflow checklist uses directly. Listed here
 * so we can DEDUPE — once a prompt is featured in the checklist we
 * don't also want it cluttering the secondary "More Claude workflows"
 * section. Update both this set and the checklist together if either
 * changes.
 */
const DAILY_WORKFLOW_PROMPT_TRIGGERS = new Set<string>([
  "pull peec data for the latest day",
  "run geo debug",
  "/source-gap-refresh",
]);

// ---------------------------------------------------------------------
// Daily workflow checklist — the headline section of the dropdown.
// Four numbered steps in the order a user should run them to fully
// update the dashboard. Mixes dashboard-driven actions (steps 1, 3)
// with Claude-driven prompts (steps 2, 4) since both are needed.
// ---------------------------------------------------------------------

interface DailyWorkflowSectionProps {
  triggerRefresh: (mode: RefreshMode, daysBack: number) => Promise<void>;
  state: RefreshState;
}

function DailyWorkflowSection({ triggerRefresh, state }: DailyWorkflowSectionProps) {
  // Per-step status timestamps so the user can see when each step
  // last ran — drives the "5h ago" / "Never" hints under each row.
  const lastSeoPullAt =
    state.sources.gsc.last_run_at ??
    state.sources.ga4.last_run_at ??
    state.sources.llm_traffic.last_run_at;
  const lastAggregateAt = state.sources.aggregate.last_run_at;

  return (
    <div className="px-4 pt-3 pb-2">
      <div className="flex items-baseline justify-between gap-2 mb-0.5">
        <h3 className="text-[11px] uppercase tracking-[0.14em] text-primary-700 font-semibold">
          Daily refresh workflow
        </h3>
        <span className="text-[10px] text-ink-500">4 steps · ~3 min</span>
      </div>
      <p className="text-[11px] text-ink-600 mb-3 leading-snug">
        Run all four to fully update the dashboard. Steps 1 + 3 click here;
        steps 2 + 4 paste into a Claude session.
      </p>

      <ol className="space-y-2">
        <WorkflowStep
          number={1}
          title="Pull SEO + GA4 traffic"
          description="GSC clicks, GA4 sessions, and LLM-referrer data for the freshness window."
          updates="Updates: Overview, Topic Clusters, Strategy"
          kind="run"
          lastAt={lastSeoPullAt}
          actionLabel="Run"
          onAction={() => triggerRefresh("incremental", 30)}
        />
        <WorkflowStep
          number={2}
          title="Pull AI visibility (Peec)"
          description="Peec MCP runs Claude-side — paste the prompt below into a Claude session."
          updates="Updates: Strategy, Insights, Topic Clusters"
          kind="copy"
          prompt="pull peec data for the latest day"
        />
        <WorkflowStep
          number={3}
          title="Apply new data"
          description="Re-run aggregate_daily.py to fold the new raw Peec file into processed dailies. Fast (~5s), no GSC/GA4 calls."
          updates="Required after step 2 — otherwise the dashboard won't show the new Peec data."
          kind="run"
          lastAt={lastAggregateAt}
          actionLabel="Run"
          onAction={() => triggerRefresh("aggregate-only", 7)}
        />
        <WorkflowStep
          number={4}
          title="Refresh AI insights (weekly)"
          description="Re-runs the 4-state Citation Health classifier. Run weekly, not daily."
          updates="Updates: Insights → AI Citation Health, Strategy → cross-layer patterns"
          kind="copy"
          prompt="run geo debug"
        />
      </ol>
    </div>
  );
}

interface WorkflowStepProps {
  number: 1 | 2 | 3 | 4;
  title: string;
  description: string;
  updates: string;
  kind: "run" | "copy";
  /** ISO timestamp of last execution, for "5h ago" hint. Only used by `run` steps. */
  lastAt?: string | null;
  actionLabel?: string;
  onAction?: () => void;
  /** Claude prompt to copy. Only used by `copy` steps. */
  prompt?: string;
}

function WorkflowStep({
  number,
  title,
  description,
  updates,
  kind,
  lastAt,
  actionLabel = "Run",
  onAction,
  prompt,
}: WorkflowStepProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <li className="rounded-lg border border-hairline bg-surface px-3 py-2.5 hover:border-primary-300 transition-colors">
      <div className="flex items-start gap-2.5">
        <StepNumberBadge number={number} kind={kind} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <div className="text-[13px] font-semibold text-ink-900 leading-tight">
              {title}
            </div>
            {kind === "run" && (
              <span className="text-[10px] text-ink-500 tabular-nums shrink-0">
                {lastAt ? `${formatAgo(lastAt)}` : "Never run"}
              </span>
            )}
          </div>
          <p className="text-[11px] text-ink-600 mt-0.5 leading-snug">
            {description}
          </p>
          <p className="text-[10px] text-ink-500 mt-1 italic">{updates}</p>

          {kind === "copy" && prompt && (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <code className="font-mono text-[11px] bg-ink-900 text-white px-2 py-1 rounded select-all flex-1 min-w-0 truncate">
                {prompt}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                className={clsx(
                  "shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1.5 rounded-md ring-1 ring-inset transition-colors",
                  copied
                    ? "bg-success-50 text-success-600 ring-success/30"
                    : "bg-primary-600 text-white ring-primary-700 hover:bg-primary-700",
                )}
              >
                {copied ? "Copied ✓" : "Copy prompt"}
              </button>
            </div>
          )}

          {kind === "run" && onAction && (
            <button
              type="button"
              onClick={onAction}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded-md bg-primary-600 text-white hover:bg-primary-700 transition-colors"
            >
              <PlayIcon /> {actionLabel}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function StepNumberBadge({
  number,
  kind,
}: {
  number: number;
  kind: "run" | "copy";
}) {
  const isCopy = kind === "copy";
  return (
    <span
      className={clsx(
        "shrink-0 w-6 h-6 rounded-full inline-flex items-center justify-center text-[11px] font-bold ring-1 ring-inset",
        isCopy
          ? "bg-accent-50 text-accent-700 ring-accent-200"
          : "bg-primary-50 text-primary-700 ring-primary-200",
      )}
      aria-label={`Step ${number}`}
    >
      {number}
    </span>
  );
}

// ---------------------------------------------------------------------
// Collapsible secondary section — wraps backfill / extra Claude prompts
// so the dropdown stays focused on the daily workflow by default.
// ---------------------------------------------------------------------

function CollapsibleSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-hairline">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left px-4 py-2.5 hover:bg-surface-muted transition-colors"
      >
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[11px] uppercase tracking-[0.14em] text-ink-500 font-semibold">
            {title}
          </h3>
          <span
            className={clsx(
              "text-[10px] text-ink-500 transition-transform inline-block",
              open && "rotate-90",
            )}
            aria-hidden
          >
            ›
          </span>
        </div>
        {!open && (
          <p className="text-[11px] text-ink-500 mt-0.5 leading-snug">
            {description}
          </p>
        )}
      </button>
      {open && <div className="pb-1.5">{children}</div>}
    </div>
  );
}

function PlayIcon() {
  return (
    <svg
      className="w-3 h-3"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

// ---------------------------------------------------------------------

function MenuItem({
  title,
  sub,
  onClick,
  icon,
}: {
  title: string;
  sub: string;
  onClick: () => void;
  icon: "lightning" | "refresh";
}) {
  return (
    <button
      role="menuitem"
      type="button"
      onClick={onClick}
      className="w-full flex items-start gap-3 px-4 py-2 hover:bg-surface-muted text-left transition-colors group"
    >
      <span className="mt-0.5 text-primary-600 group-hover:text-primary-700 transition-colors">
        {icon === "lightning" ? <LightningIcon /> : <RefreshIcon />}
      </span>
      <span className="flex-1 min-w-0">
        <div className="text-sm text-ink-900 font-medium">{title}</div>
        <div className="text-[11px] text-ink-500">{sub}</div>
      </span>
    </button>
  );
}

function PromptRow({ prompt }: { prompt: ClaudePrompt }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(prompt.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: prompt stays visible in the row so the user can
      // select + copy manually if clipboard API is blocked.
    }
  }

  return (
    <li>
      <button
        type="button"
        onClick={handleCopy}
        className={clsx(
          "w-full text-left px-4 py-2 transition-colors",
          copied ? "bg-success-50" : "hover:bg-surface-muted",
        )}
        title="Click to copy the trigger"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm text-ink-900 font-medium truncate">
              {prompt.name}
            </span>
            {prompt.cadence && (
              <span className="text-[9px] uppercase tracking-[0.12em] bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-200 px-1.5 py-0.5 rounded-md font-semibold shrink-0">
                {prompt.cadence}
              </span>
            )}
          </div>
          <span
            className={clsx(
              "inline-flex items-center gap-1 text-[11px] font-medium shrink-0 transition-colors",
              copied ? "text-success-600" : "text-ink-500",
            )}
          >
            {copied ? (
              <>
                <CheckIcon className="w-3 h-3" /> Copied
              </>
            ) : (
              <>
                <ClipboardIcon className="w-3 h-3" /> Copy
              </>
            )}
          </span>
        </div>
        <div className="mt-1 flex items-start gap-2">
          <code className="flex-1 font-mono text-[11px] bg-primary-950 text-primary-100 px-2 py-1 rounded-md overflow-x-auto whitespace-nowrap">
            {prompt.prompt}
          </code>
        </div>
        <div className="mt-1 text-[11px] text-ink-500 leading-snug">
          {prompt.hint}
        </div>
      </button>
    </li>
  );
}

function StatusDot({ status }: { status: RefreshState["status"] }) {
  const cls = {
    idle:    "bg-ink-400",
    running: "bg-accent-500 animate-pulse ring-2 ring-accent-500/25",
    success: "bg-success-500",
    failed:  "bg-danger-500",
  }[status];
  return <span className={clsx("w-2 h-2 rounded-full inline-block", cls)} />;
}

function Spinner() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0 1 14.9-2M20 15a8 8 0 0 1-14.9 2" />
    </svg>
  );
}

function LightningIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg className="w-3 h-3 opacity-70" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function ClipboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function formatAgo(isoTime: string): string {
  const then = new Date(isoTime).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

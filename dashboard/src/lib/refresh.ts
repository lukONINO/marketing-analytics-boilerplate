/**
 * Refresh orchestration — spawns Python scripts from Next.js.
 *
 * Runs GSC + GA4 + LLM-traffic pulls + aggregate_daily for a rolling
 * window starting from today - 1 back. Writes progress to
 * data/dashboard/refresh_state.json which the dashboard reads to show
 * "last refreshed" indicators and a live progress panel.
 *
 * Two modes:
 *   - `incremental` (default): scans the window. Dates in the
 *     FRESHNESS_WINDOW (most recent N days) are ALWAYS re-pulled,
 *     because GSC publishes historical data with ~2-3 day lag — a
 *     file written "today" for "yesterday" often holds zeros, and
 *     will contain real numbers if we re-pull in 48h. Older dates
 *     are only pulled when the daily file is missing.
 *   - `backfill`: pulls every date in the window, overwriting. Use
 *     when you explicitly want to re-fetch stale weeks or months.
 *
 * Peec is NOT refreshed here — it requires the Peec MCP which is only
 * available inside a Claude Code/Cowork session. The refresh state
 * carries a note to that effect.
 *
 * SECURITY: this spawns arbitrary Python scripts. Safe for localhost
 * but DO NOT expose this endpoint publicly without adding auth +
 * argument validation. The scripts themselves read .env for secrets.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";

import type { RefreshSource, RefreshState } from "./types";

const REPO_ROOT = path.resolve(process.cwd(), "..");
const DATA_DASHBOARD = path.join(REPO_ROOT, "data", "dashboard");
const STATE_PATH = path.join(DATA_DASHBOARD, "refresh_state.json");
const VENV_PYTHON = path.join(REPO_ROOT, ".venv", "bin", "python");

// ---------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------

function emptyState(): RefreshState {
  return {
    status: "idle",
    started_at: null,
    completed_at: null,
    days_back: null,
    dates_processed: [],
    dates_failed: [],
    sources: {
      gsc:         { last_run_at: null, latest_date: null, days_back: null, last_error: null },
      ga4:         { last_run_at: null, latest_date: null, days_back: null, last_error: null },
      llm_traffic: { last_run_at: null, latest_date: null, days_back: null, last_error: null },
      aggregate:   { last_run_at: null, latest_date: null, days_back: null, last_error: null },
    },
    log_tail: [],
    peec_note: "Peec data is refreshed via Claude (MCP). Say: refresh peec data for last 7 days.",
    notion_note: "Notion reports are published by Claude via the daily-routine skill.",
  };
}

export async function readRefreshState(): Promise<RefreshState> {
  try {
    const raw = await readFile(STATE_PATH, "utf-8");
    return JSON.parse(raw) as RefreshState;
  } catch {
    return emptyState();
  }
}

async function writeRefreshState(state: RefreshState): Promise<void> {
  await mkdir(DATA_DASHBOARD, { recursive: true });
  const tmp = STATE_PATH + ".tmp";
  await writeFile(tmp, JSON.stringify(state, null, 2), "utf-8");
  const { rename } = await import("node:fs/promises");
  await rename(tmp, STATE_PATH);
}

// ---------------------------------------------------------------------
// Filesystem helpers — find the "latest date" of raw data per source
// ---------------------------------------------------------------------

async function latestRawDate(source: string): Promise<string | null> {
  const dir = path.join(REPO_ROOT, "data", "raw", source);
  try {
    await stat(dir);
  } catch {
    return null;
  }
  try {
    const files = (await readdir(dir))
      .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"))
      .sort();
    if (files.length === 0) return null;
    return files[files.length - 1].replace(".json", "");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Python subprocess
// ---------------------------------------------------------------------

interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

function runPython(scriptRel: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    const proc = spawn(VENV_PYTHON, [scriptRel, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (buf) => (stdout += buf.toString()));
    proc.stderr.on("data", (buf) => (stderr += buf.toString()));
    proc.on("close", (code) => {
      resolve({ ok: code === 0, stdout, stderr, code });
    });
    proc.on("error", (err) => {
      resolve({ ok: false, stdout, stderr: stderr + err.message, code: null });
    });
  });
}

// ---------------------------------------------------------------------
// Window computation — which dates to refresh
// ---------------------------------------------------------------------

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function computeWindow(daysBack: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  // Default: skip today (GSC/GA4 finalize with ~1-2 day lag); pull
  // dates [today-daysBack, today-1].
  for (let i = 1; i <= daysBack; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(isoDate(d));
  }
  dates.sort();
  return dates;
}

/**
 * Number of most-recent days to ALWAYS re-pull on incremental refresh,
 * even when the daily file already exists.
 *
 * Why: GSC doesn't expose a date's data until ~2-3 days after the date
 * has passed. When we first pulled "yesterday" at ~08:00 this morning,
 * GSC often returned empty for that date. Without this window, the
 * empty snapshot becomes permanent: the Overview shows organic clicks
 * "up to April 21" while GSC has since populated April 22 and 23.
 * 5 days is a safe buffer past GSC's lag; anything older than that is
 * final and won't change.
 *
 * Peec has a shorter lag (same-day) but still benefits, in case the
 * original pull landed before all engines completed their daily run.
 */
const FRESHNESS_WINDOW_DAYS = 5;

/**
 * Decide which dates the incremental refresh should pull:
 *   - Dates within the freshness window → pulled regardless (underlying
 *     sources publish late; re-pull picks up the fill-in).
 *   - Older dates → only pulled when the daily file is missing.
 *
 * Returns { missing, stale } so the log line can distinguish "never
 * pulled" from "re-pulled to catch late-arriving source data".
 */
async function selectIncrementalDates(
  dates: string[],
  todayIsoDate: string,
): Promise<{ missing: string[]; stale: string[] }> {
  const daily = path.join(REPO_ROOT, "data", "processed", "daily");
  // Parse at midnight UTC so day-math is clean regardless of caller TZ.
  const todayTs = Date.parse(`${todayIsoDate}T00:00:00Z`);
  const freshnessMs = FRESHNESS_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const missing: string[] = [];
  const stale: string[] = [];
  for (const d of dates) {
    const dateTs = Date.parse(`${d}T00:00:00Z`);
    const isInFreshnessWindow = todayTs - dateTs < freshnessMs;
    let fileExists = true;
    try {
      await stat(path.join(daily, `${d}.json`));
    } catch {
      fileExists = false;
    }
    if (!fileExists) missing.push(d);
    else if (isInFreshnessWindow) stale.push(d);
    // else: older date with a file on disk — final, skip.
  }
  return { missing, stale };
}

// ---------------------------------------------------------------------
// Main refresh orchestrator
// ---------------------------------------------------------------------

export type RefreshMode = "incremental" | "backfill" | "aggregate-only";

/**
 * Package of values that need to cross the claim → execute boundary.
 * Claim writes the initial "running" state; execute consumes this
 * package to run the per-date pipeline.
 */
interface RefreshClaim {
  state: RefreshState;
  dates: string[];
  windowDates: string[];
  logTail: string[];
  daysBack: number;
  mode: RefreshMode;
}

/**
 * Claim phase — awaited synchronously by the route handler so the
 * client sees `status: "running"` in the POST response without a race.
 *
 * Writes the "running" state to disk and returns everything the
 * execute phase needs. Does NOT run any Python — returns fast
 * (filesystem reads only). Throws if a refresh is already running.
 */
async function claimRefresh(
  daysBack: number,
  mode: RefreshMode,
): Promise<RefreshClaim> {
  const existing = await readRefreshState();
  if (existing.status === "running") {
    throw new Error(
      `Refresh already running (started at ${existing.started_at}). Wait or inspect refresh_state.json.`
    );
  }

  const startedAt = new Date().toISOString();
  const todayIsoDate = startedAt.slice(0, 10);
  const windowDates = computeWindow(daysBack);

  // aggregate-only includes TODAY in the window. Reason: the user
  // typically clicks "Re-aggregate" right after a fresh Peec MCP pull
  // that produced data/raw/peec/<today>.json — they want the aggregator
  // to fold that into a processed daily for today. The default
  // computeWindow excludes today because GSC/GA4 pulls for today would
  // be incomplete; the aggregator itself is tolerant of missing sources
  // and will produce a daily file with whatever raw data exists.
  //
  // This was the bug behind "I clicked Re-aggregate but the banner
  // still says today's Peec is unapplied" — the worker silently ran
  // for the previous 7 days, none of which had a new raw Peec file,
  // so nothing changed in the processed dailies.
  if (mode === "aggregate-only" && !windowDates.includes(todayIsoDate)) {
    windowDates.push(todayIsoDate);
    windowDates.sort();
  }

  // Compute the dates to pull for this run.
  let dates: string[];
  let missingCount = 0;
  let staleCount = 0;
  if (mode === "incremental") {
    const split = await selectIncrementalDates(windowDates, todayIsoDate);
    // Deduped + chronologically ordered — matters because both
    // `missing` and `stale` preserve input order (which is already
    // chronological from computeWindow), so we can just concat.
    dates = [...split.missing, ...split.stale].sort();
    missingCount = split.missing.length;
    staleCount = split.stale.length;
  } else {
    // Both `backfill` and `aggregate-only` cover every date in the
    // window. The execute phase decides whether to actually re-pull
    // raw sources for that date or just re-run the aggregator.
    dates = windowDates;
  }

  const state: RefreshState = {
    ...emptyState(),
    status: "running",
    started_at: startedAt,
    days_back: daysBack,
  };
  // Preserve the previous sources block so we don't lose last-run info
  // if the current run fails partway. Only bump source fields on success.
  state.sources = { ...existing.sources };

  const logTail: string[] = [];
  if (mode === "aggregate-only") {
    logTail.push(
      `[${startedAt}] Aggregate-only. Window: ${windowDates[0]} → ${windowDates[windowDates.length - 1]} (${daysBack}d) — re-running aggregate_daily.py for ${dates.length} date(s). Skipping GSC / GA4 / LLM pulls. Use this after a Peec MCP pull to fold the new raw data into processed dailies.`
    );
  } else if (mode === "incremental") {
    logTail.push(
      `[${startedAt}] Incremental load. Window: ${windowDates[0]} → ${windowDates[windowDates.length - 1]} (${daysBack}d) — ${missingCount} missing + ${staleCount} re-pulled within the ${FRESHNESS_WINDOW_DAYS}-day freshness window (GSC publishes historical data with lag).`
    );
  } else {
    logTail.push(
      `[${startedAt}] Backfill. Window: ${windowDates[0]} → ${windowDates[windowDates.length - 1]} (${daysBack}d) — re-pulling all ${dates.length} date(s).`
    );
  }
  state.log_tail = [...logTail];

  await writeRefreshState(state);
  return { state, dates, windowDates, logTail, daysBack, mode };
}

/**
 * Execute phase — runs the per-date pipeline, updating
 * refresh_state.json as it goes. Always resolves (errors are written
 * into state, not thrown). Designed to be called unawaited from the
 * route handler after a successful `claimRefresh`.
 */
async function executeRefresh(claim: RefreshClaim): Promise<RefreshState> {
  const { dates, daysBack, mode } = claim;
  const state = claim.state;
  const logTail = claim.logTail;
  const pushLog = (line: string) => {
    logTail.push(line);
    if (logTail.length > 50) logTail.shift();
  };

  // Short-circuit: nothing to do. With the freshness window in place,
  // this only fires when every date in the window is OLDER than
  // FRESHNESS_WINDOW_DAYS (user asked for e.g. --days-back 2 but both
  // of those days are already on disk and within the freshness window
  // ... actually that wouldn't short-circuit since stale pulls happen).
  // In practice: if the window is small and the freshness check
  // catches all recent dates, this path almost never fires. Kept as a
  // safety net.
  if (dates.length === 0) {
    const completedAt = new Date().toISOString();
    pushLog(`[${completedAt}] Already up to date — no missing dates in window.`);
    const final: RefreshState = {
      ...state,
      status: "success",
      completed_at: completedAt,
      dates_processed: [],
      dates_failed: [],
      log_tail: [...logTail],
    };
    await writeRefreshState(final);
    return final;
  }

  const datesProcessed: string[] = [];
  const datesFailed: string[] = [];

  for (const date of dates) {
    pushLog(`[${new Date().toISOString()}] Processing ${date}...`);
    await writeRefreshState({ ...state, log_tail: [...logTail] });

    const results: Record<string, RunResult> = {};

    if (mode !== "aggregate-only") {
      // GSC + GA4 sequentially (both hit Google APIs; staggering avoids
      // quota bursts). Could parallelize later if needed.
      pushLog(`  → pull_gsc.py --date ${date}`);
      results.gsc = await runPython("scripts/pull_gsc.py", ["--date", date, "--no-inspection"]);
      if (!results.gsc.ok) {
        pushLog(`    ✗ GSC failed (exit ${results.gsc.code}): ${tailLines(results.gsc.stderr, 3)}`);
        state.sources.gsc.last_error = tailLines(results.gsc.stderr, 3);
      } else {
        pushLog(`    ✓ GSC ok`);
        state.sources.gsc.last_error = null;
      }

      pushLog(`  → pull_ga4.py --date ${date}`);
      results.ga4 = await runPython("scripts/pull_ga4.py", ["--date", date]);
      if (!results.ga4.ok) {
        pushLog(`    ✗ GA4 failed (exit ${results.ga4.code}): ${tailLines(results.ga4.stderr, 3)}`);
        state.sources.ga4.last_error = tailLines(results.ga4.stderr, 3);
      } else {
        pushLog(`    ✓ GA4 ok`);
        state.sources.ga4.last_error = null;
      }

      // LLM traffic — only meaningful if GA4 succeeded.
      if (results.ga4.ok) {
        pushLog(`  → parse_llm_traffic.py --date ${date}`);
        results.llm = await runPython("scripts/parse_llm_traffic.py", ["--date", date]);
        if (!results.llm.ok) {
          pushLog(`    ✗ LLM parse failed: ${tailLines(results.llm.stderr, 3)}`);
          state.sources.llm_traffic.last_error = tailLines(results.llm.stderr, 3);
        } else {
          pushLog(`    ✓ LLM parse ok`);
          state.sources.llm_traffic.last_error = null;
        }
      } else {
        pushLog(`  ↷ skipping LLM parse (GA4 failed)`);
      }
    } else {
      // aggregate-only: skip raw pulls; aggregator picks up whatever
      // is currently on disk (GSC + GA4 + LLM + Peec — including a
      // freshly-written raw/peec/<date>.json from a Claude MCP pull).
      pushLog(`  ↷ skipping GSC / GA4 / LLM pulls (aggregate-only mode)`);
    }

    // Aggregate — runs with whatever raw sources exist, tolerant of missing.
    pushLog(`  → aggregate_daily.py --date ${date}`);
    const aggResult = await runPython("scripts/aggregate_daily.py", ["--date", date]);
    if (!aggResult.ok) {
      pushLog(`    ✗ aggregate failed: ${tailLines(aggResult.stderr, 3)}`);
      state.sources.aggregate.last_error = tailLines(aggResult.stderr, 3);
      datesFailed.push(date);
    } else {
      pushLog(`    ✓ aggregate ok`);
      state.sources.aggregate.last_error = null;
      datesProcessed.push(date);
    }

    await writeRefreshState({ ...state, log_tail: [...logTail] });
  }

  // Stamp latest_date per source based on what's on disk now. In
  // aggregate-only mode we skip the raw-source updates (their
  // last_run_at didn't change because we didn't pull them).
  if (mode !== "aggregate-only") {
    for (const src of ["gsc", "ga4", "llm_traffic"] as const) {
      state.sources[src].latest_date = await latestRawDate(src);
      state.sources[src].last_run_at = new Date().toISOString();
      state.sources[src].days_back = daysBack;
    }
  }
  state.sources.aggregate.latest_date = await latestAggregateDate();
  state.sources.aggregate.last_run_at = new Date().toISOString();
  state.sources.aggregate.days_back = daysBack;

  const completedAt = new Date().toISOString();
  const final: RefreshState = {
    ...state,
    status: datesFailed.length === dates.length ? "failed" : "success",
    completed_at: completedAt,
    dates_processed: datesProcessed,
    dates_failed: datesFailed,
    log_tail: [...logTail],
  };
  pushLog(`[${completedAt}] Refresh complete. ${datesProcessed.length} ok, ${datesFailed.length} failed.`);
  final.log_tail = [...logTail];
  await writeRefreshState(final);
  return final;
}

/**
 * Start a refresh and return immediately after the "running" state has
 * been written to disk. The route handler uses this so the POST response
 * already reflects `status: "running"` — no race with the background
 * worker, no stale-state flicker on the dashboard button.
 *
 * The execute phase is fired unawaited and swallows its own errors
 * (they're captured in refresh_state.json by writeRefreshState calls
 * inside the per-date loop).
 */
export async function startRefresh(
  daysBack: number = 30,
  mode: RefreshMode = "incremental",
): Promise<RefreshState> {
  const claim = await claimRefresh(daysBack, mode);
  executeRefresh(claim).catch((err) => {
    console.error("[refresh] background execute failed:", err);
  });
  return claim.state;
}

/**
 * Awaits the full refresh run. Kept for CLI / test usage where the
 * caller wants the final state. Web callers should use `startRefresh`.
 */
export async function runRefresh(
  daysBack: number = 30,
  mode: RefreshMode = "incremental",
): Promise<RefreshState> {
  const claim = await claimRefresh(daysBack, mode);
  return executeRefresh(claim);
}

async function latestAggregateDate(): Promise<string | null> {
  const dir = path.join(REPO_ROOT, "data", "processed", "daily");
  try {
    const files = (await readdir(dir))
      .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"))
      .sort();
    if (files.length === 0) return null;
    return files[files.length - 1].replace(".json", "");
  } catch {
    return null;
  }
}

function tailLines(text: string, n: number): string {
  return text.split("\n").filter(Boolean).slice(-n).join(" | ");
}

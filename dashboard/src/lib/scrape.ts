/**
 * Content-pipeline orchestration — one dashboard click runs the full
 * chain: scrape → cluster-assign → visibility-improvements → readiness-extras.
 *
 * Scripts spawned, in order:
 *   1. scripts/scrape_site.py                    [required]
 *   2. scripts/assign_clusters.py                [required]
 *   3. scripts/compute_visibility_improvements.py [best-effort]
 *   4. scripts/compute_readiness_extras.py        [best-effort]
 *
 * Steps 1 and 2 are both required — a failure marks the overall run
 * as failed. Steps 3 and 4 are best-effort: their computations read
 * the output of step 2, but if they crash we still want to show the
 * scrape succeeded. They log warnings but don't fail the run.
 *
 * Mirrors the same claim/execute split refresh.ts uses so the
 * /api/scrape route can return `status: "running"` immediately without
 * racing the subprocesses.
 *
 * Output lives in:
 *   data/raw/content/<YYYY-MM-DD>/<slug>.json     — per-URL records
 *   data/raw/content/<YYYY-MM-DD>/_inventory.json — rollup for dashboard
 *   data/processed/page_clusters.json             — cluster assignments
 *   data/processed/visibility_improvements.json   — opportunity list
 *
 * State lives in:
 *   data/dashboard/scrape_state.json              — polled by the UI
 *
 * SECURITY: localhost-only. This spawns Python scripts; don't expose
 * without auth + argument validation.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { mkdir, readFile, readdir, stat, writeFile, rename } from "node:fs/promises";

const REPO_ROOT = path.resolve(process.cwd(), "..");
const CONTENT_DIR = path.join(REPO_ROOT, "data", "raw", "content");
const DASHBOARD_DIR = path.join(REPO_ROOT, "data", "dashboard");
const STATE_PATH = path.join(DASHBOARD_DIR, "scrape_state.json");
const VENV_PYTHON = path.join(REPO_ROOT, ".venv", "bin", "python");

export type ScrapeStatus = "idle" | "running" | "success" | "failed";

/**
 * Which flavor of the content pipeline the user kicked off.
 * - "full": scrape_site.py (whole sitemap) → assign → viz
 * - "retry-shells": scrape_site.py --retry-shells → assign → viz
 */
export type ScrapeMode = "full" | "retry-shells";

export interface ScrapeState {
  status: ScrapeStatus;
  started_at: string | null;
  completed_at: string | null;
  sitemap: string | null;
  log_tail: string[];
  /** Date-stamped output directory for this run (e.g. "2026-04-24"). */
  output_date: string | null;
  /** Counts populated once the inventory.json lands. */
  total_urls: number | null;
  ok_count: number | null;
  error_count: number | null;
  last_error: string | null;
}

function emptyState(): ScrapeState {
  return {
    status: "idle",
    started_at: null,
    completed_at: null,
    sitemap: null,
    log_tail: [],
    output_date: null,
    total_urls: null,
    ok_count: null,
    error_count: null,
    last_error: null,
  };
}

// ---------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------

export async function readScrapeState(): Promise<ScrapeState> {
  try {
    const raw = await readFile(STATE_PATH, "utf-8");
    return JSON.parse(raw) as ScrapeState;
  } catch {
    return emptyState();
  }
}

async function writeScrapeState(state: ScrapeState): Promise<void> {
  await mkdir(DASHBOARD_DIR, { recursive: true });
  const tmp = STATE_PATH + ".tmp";
  await writeFile(tmp, JSON.stringify(state, null, 2), "utf-8");
  await rename(tmp, STATE_PATH);
}

// ---------------------------------------------------------------------
// Inventory reader — surfaced to the settings page
// ---------------------------------------------------------------------

export interface ScrapeInventorySummary {
  date: string;
  generated_at: string;
  total_urls: number;
  ok_count: number;
  error_count: number;
  total_words: number;
  avg_word_count: number;
  schema_coverage: Record<string, number>;
  pages_thin_lt_300_words: string[];
  pages_with_numeric_claims: string[];
  pages_without_claims: string[];
  pages_missing_meta_description: string[];
  pages_missing_h1: string[];
  pages: {
    url: string;
    status: number;
    title: string | null;
    word_count: number;
    schema_types: string[];
    numeric_claims_count: number;
    lang: string | null;
    error: string | null;
  }[];
}

/**
 * Return the most recent inventory (across all date-stamped subdirs).
 * If nothing has been scraped yet, returns null.
 */
export async function loadLatestInventory(): Promise<ScrapeInventorySummary | null> {
  try {
    await stat(CONTENT_DIR);
  } catch {
    return null;
  }
  const entries = (await readdir(CONTENT_DIR, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort();
  if (entries.length === 0) return null;
  const latest = entries[entries.length - 1];
  const invPath = path.join(CONTENT_DIR, latest, "_inventory.json");
  try {
    const raw = await readFile(invPath, "utf-8");
    const parsed = JSON.parse(raw) as Omit<ScrapeInventorySummary, "date">;
    return { date: latest, ...parsed };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------

interface ScrapeClaim {
  state: ScrapeState;
  logTail: string[];
  sitemap: string;
  outputDate: string;
  mode: ScrapeMode;
}

/**
 * Fast pre-flight: validate inputs, write "running" state, return.
 * Awaited by the API route before the worker starts.
 */
async function claimScrape(
  sitemap: string,
  mode: ScrapeMode,
): Promise<ScrapeClaim> {
  const existing = await readScrapeState();
  if (existing.status === "running") {
    throw new Error(
      `Scrape already running (started at ${existing.started_at}). Wait or inspect scrape_state.json.`,
    );
  }
  const startedAt = new Date().toISOString();
  const outputDate = new Date().toISOString().slice(0, 10);
  const openingLine =
    mode === "retry-shells"
      ? `[${startedAt}] Retrying shell-response pages from latest inventory`
      : `[${startedAt}] Starting full content pipeline from sitemap: ${sitemap}`;
  const logTail: string[] = [openingLine];
  const state: ScrapeState = {
    ...emptyState(),
    status: "running",
    started_at: startedAt,
    sitemap,
    output_date: outputDate,
    log_tail: [...logTail],
  };
  await writeScrapeState(state);
  return { state, logTail, sitemap, outputDate, mode };
}

/**
 * Run a single Python script, streaming stdout+stderr into the shared
 * log tail and persisting state periodically so the UI poll sees
 * progress. Resolves with the exit code (0 = success).
 *
 * The state write coalescing (400ms flush timer) minimizes fsync
 * churn even if the script logs tens of lines per second.
 */
function spawnPython(
  scriptArgs: string[],
  state: ScrapeState,
  logTail: string[],
  pushLog: (line: string) => void,
): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    const proc = spawn(VENV_PYTHON, scriptArgs, {
      cwd: REPO_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    let flushTimer: NodeJS.Timeout | null = null;
    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(async () => {
        flushTimer = null;
        await writeScrapeState({ ...state, log_tail: [...logTail] });
      }, 400);
    };

    const onData = (buf: Buffer) => {
      const txt = buf.toString();
      for (const line of txt.split("\n")) {
        const t = line.trim();
        if (t) pushLog(t);
      }
      scheduleFlush();
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);

    proc.on("close", async (code) => {
      if (flushTimer) clearTimeout(flushTimer);
      await writeScrapeState({ ...state, log_tail: [...logTail] });
      resolve(code);
    });

    proc.on("error", async (err) => {
      pushLog(`ERROR spawning ${scriptArgs[0]}: ${err.message}`);
      await writeScrapeState({ ...state, log_tail: [...logTail] });
      resolve(null);
    });
  });
}

/**
 * Fire the Python pipeline in the background, stream output into
 * log_tail, and finalize state on exit. Four steps total:
 *   1. scrape_site.py  — required; failure aborts the chain
 *   2. assign_clusters.py — required; failure aborts steps 3 + 4
 *   3. compute_visibility_improvements.py — best-effort
 *   4. compute_readiness_extras.py — best-effort
 *
 * Each step prefixes its first log line with "[step N/4]" so the UI
 * can show the user how far along they are.
 */
async function executeScrape(claim: ScrapeClaim): Promise<ScrapeState> {
  const { state, logTail, sitemap, outputDate, mode } = claim;
  const pushLog = (line: string) => {
    logTail.push(line);
    if (logTail.length > 60) logTail.shift();
  };

  let overallStatus: ScrapeStatus = "success";
  const errors: string[] = [];

  // ---- Step 1: scrape_site.py (required) --------------------------
  const scrapeArgs =
    mode === "retry-shells"
      ? ["scripts/scrape_site.py", "--retry-shells"]
      : ["scripts/scrape_site.py", "--sitemap", sitemap];
  pushLog(
    mode === "retry-shells"
      ? "[step 1/4] Re-scraping only pages that came back as shells last run"
      : `[step 1/4] Scraping sitemap ${sitemap} → data/raw/content/${outputDate}/`,
  );
  const scrapeCode = await spawnPython(scrapeArgs, state, logTail, pushLog);
  if (scrapeCode !== 0) {
    overallStatus = "failed";
    errors.push(`scrape_site.py exited with code ${scrapeCode ?? "spawn-error"}`);
  }

  // ---- Step 2: assign_clusters.py (required) ----------------------
  if (overallStatus === "success") {
    pushLog(
      `[step 2/4] Assigning pages to clusters → data/processed/page_clusters.json`,
    );
    const assignCode = await spawnPython(
      ["scripts/assign_clusters.py"],
      state,
      logTail,
      pushLog,
    );
    if (assignCode !== 0) {
      overallStatus = "failed";
      errors.push(
        `assign_clusters.py exited with code ${assignCode ?? "spawn-error"}`,
      );
    }
  } else {
    pushLog("[step 2/4] Skipped (previous step failed)");
  }

  // ---- Step 3: compute_visibility_improvements.py (best-effort) ---
  if (overallStatus === "success") {
    pushLog(
      `[step 3/4] Computing visibility improvements → data/processed/visibility_improvements.json`,
    );
    const vizCode = await spawnPython(
      ["scripts/compute_visibility_improvements.py", "--window", "30"],
      state,
      logTail,
      pushLog,
    );
    if (vizCode !== 0) {
      // Best-effort: log the failure but don't flip overall to failed —
      // scrape + assign both succeeded, which is the main payoff.
      pushLog(
        `[step 3/4] warning: compute_visibility_improvements.py exited with code ${vizCode ?? "spawn-error"} (non-fatal)`,
      );
      errors.push(
        `compute_visibility_improvements.py exited with code ${vizCode ?? "spawn-error"} (non-fatal)`,
      );
    }
  } else {
    pushLog("[step 3/4] Skipped (previous step failed)");
  }

  // ---- Step 4: compute_readiness_extras.py (best-effort) ----------
  // Fills the 4 Readiness dimensions that don't need new data sources
  // (fresh / useful / differentiated / transactable). Reads the same
  // page_clusters.json + scrape output assign produced in step 2.
  if (overallStatus === "success") {
    pushLog(
      `[step 4/4] Computing readiness extras → data/processed/readiness_extras.json`,
    );
    const extrasCode = await spawnPython(
      ["scripts/compute_readiness_extras.py", "--window", "30"],
      state,
      logTail,
      pushLog,
    );
    if (extrasCode !== 0) {
      pushLog(
        `[step 4/4] warning: compute_readiness_extras.py exited with code ${extrasCode ?? "spawn-error"} (non-fatal)`,
      );
      errors.push(
        `compute_readiness_extras.py exited with code ${extrasCode ?? "spawn-error"} (non-fatal)`,
      );
    }
  } else {
    pushLog("[step 4/4] Skipped (previous step failed)");
  }

  const completedAt = new Date().toISOString();
  const final: ScrapeState = {
    ...state,
    status: overallStatus,
    completed_at: completedAt,
    log_tail: [...logTail],
  };

  // Merge in inventory counts if the scraper wrote them.
  try {
    const inv = await readFile(
      path.join(CONTENT_DIR, outputDate, "_inventory.json"),
      "utf-8",
    );
    const parsed = JSON.parse(inv) as ScrapeInventorySummary;
    final.total_urls = parsed.total_urls;
    final.ok_count = parsed.ok_count;
    final.error_count = parsed.error_count;
  } catch {
    // No inventory — leave nulls; status already reflects step 1.
  }

  if (errors.length > 0) {
    final.last_error = errors.join("; ");
  }
  pushLog(
    `[${completedAt}] Content pipeline complete. status=${overallStatus}`,
  );
  final.log_tail = [...logTail];
  await writeScrapeState(final);
  return final;
}

/**
 * Public entry point used by the API route — awaits the claim (so the
 * POST response already reflects `status: "running"`), fires the
 * worker unawaited.
 *
 * Sitemap default reads from the SITE_CANONICAL_ORIGIN env var when
 * set (e.g. https://acme.io → https://acme.io/sitemap.xml). Falls back
 * to https://acme.io/sitemap.xml as a placeholder — replace with your
 * own canonical origin in production.
 */
export async function startScrape(options: {
  sitemap?: string;
  mode?: ScrapeMode;
} = {}): Promise<ScrapeState> {
  const origin = process.env.SITE_CANONICAL_ORIGIN || "https://acme.io";
  const sitemap = options.sitemap ?? `${origin.replace(/\/$/, "")}/sitemap.xml`;
  const mode: ScrapeMode = options.mode ?? "full";
  const claim = await claimScrape(sitemap, mode);
  executeScrape(claim).catch((err) => {
    console.error("[scrape] background execute failed:", err);
  });
  return claim.state;
}

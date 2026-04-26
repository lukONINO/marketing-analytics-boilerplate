/**
 * Data-freshness diagnostics for the Overview banner.
 *
 * Anchored to **publishable freshness**, not calendar freshness — alerts
 * only fire when there is genuinely new data the user *could pull*.
 * Both GSC and Peec publish with a documented lag, so anchoring to
 * "days behind today" produced false alarms (e.g., on Apr 25 GSC's
 * latest possible data is Apr 22; complaining about it is noise).
 *
 * The math:
 *   expected_fresh_date = today - publish_lag
 *   pullable_days_missing = max(0, expected_fresh_date - latest_on_disk)
 *   alert fires iff pullable_days_missing > 0 OR no data on disk
 *
 * Sources:
 *   - GSC: 3-day publish lag (Search Analytics API serves day N's data
 *     ~2–3 days after N; we use 3 to be conservative).
 *   - Peec: 1-day publish lag (same-day chats land in the API by the
 *     next morning).
 *   - Content scrape: episodic, no publish-lag concept — alerts when
 *     >14 days old or missing entirely.
 *   - First run: `no_data` short-circuit when nothing is on disk yet.
 *
 * Why file-walking instead of reading a single "latest" file: a daily
 * aggregate can exist for a date but still have `total_clicks: 0`
 * because GSC hadn't published when we pulled. We want the latest day
 * with REAL data per source, which requires walking back until we hit
 * one (or exhaust a reasonable lookback).
 */

import path from "node:path";
import { readFile, readdir } from "node:fs/promises";

import type { DailyAggregate } from "./types";

const REPO_ROOT = path.resolve(process.cwd(), "..");
const DAILY_DIR = path.join(REPO_ROOT, "data", "processed", "daily");
const CONTENT_DIR = path.join(REPO_ROOT, "data", "raw", "content");

// How far back we're willing to walk while searching for "latest with
// real data". 14 days is generous — if all 14 are empty, the user has
// bigger problems than staleness.
const MAX_LOOKBACK_DAYS = 14;

// Publish-lag windows — the freshest day each source can plausibly
// serve, expressed as "today minus N days". Within this window the
// data on disk is as fresh as it can possibly be; refreshing wouldn't
// help. Outside this window there is genuinely-pullable new data and
// we should nudge the user.
const GSC_PUBLISH_LAG_DAYS = 3;   // Google Search Console: 2–3 day lag
const PEEC_PUBLISH_LAG_DAYS = 1;  // Peec MCP: same-day, available by morning
const CONTENT_STALE_DAYS = 14;    // No publish lag — episodic re-scrape

// Severity escalation: shows loud red once we're meaningfully behind
// the publishable frontier. Measured in *pullable days missing*
// (NOT calendar days behind today), so it's invariant to lag.
const GSC_CRITICAL_PULLABLE_DAYS = 5;
const PEEC_CRITICAL_PULLABLE_DAYS = 5;
const CONTENT_CRITICAL_DAYS = 30;

// ---------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------

export type StalenessAlertId = "gsc" | "peec" | "content" | "no_data";
export type StalenessSeverity = "info" | "warning" | "critical";

export interface StalenessAction {
  label: string;
  /** Discriminates how the UI renders the action:
   *  - `refresh_topbar` → "Click Refresh data ↗" hint only (no link target).
   *  - `claude` → prompt string the user copies into a Claude chat.
   *  - `link` → in-app nav to `href`. */
  kind: "refresh_topbar" | "claude" | "link";
  href?: string;
  claude_prompt?: string;
}

export interface StalenessAlert {
  id: StalenessAlertId;
  severity: StalenessSeverity;
  title: string;
  description: string;
  action: StalenessAction;
  /** Most recent date we have data for this source (ISO). */
  latest_date: string | null;
  /** Days between `latest_date` and today (whole days). Null when
   *  no data exists at all. */
  days_behind: number | null;
}

// ---------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------

export async function computeStalenessAlerts(): Promise<StalenessAlert[]> {
  const alerts: StalenessAlert[] = [];
  const today = todayIso();

  // 1. No daily files at all → first-run state. Short-circuit — the
  //    other checks would all fire redundantly.
  const dailyFiles = await listDailyFilesSortedDesc();
  if (dailyFiles.length === 0) {
    alerts.push({
      id: "no_data",
      severity: "critical",
      title: "No analytics data yet",
      description:
        "The dashboard has nothing to show until you pull GSC + GA4 + Peec for the first time. Work through the onboarding checklist first.",
      action: { label: "Start onboarding", kind: "link", href: "/settings/onboarding" },
      latest_date: null,
      days_behind: null,
    });
    return alerts;
  }

  // 2. GSC (organic search). Alert only when there's genuinely-pullable
  //    data missing — the Search Analytics API serves day N about 2–3
  //    days after N, so nagging the user when their latest is already
  //    at the publishable frontier is noise, not signal.
  const gscLatest = await findLatestWithRealGSC(dailyFiles);
  const gscPullableMissing = pullableMissingDays(gscLatest, today, GSC_PUBLISH_LAG_DAYS);
  const gscDaysBehind = gscLatest ? daysBetween(gscLatest, today) : null;
  if (gscPullableMissing === null || gscPullableMissing > 0) {
    alerts.push({
      id: "gsc",
      severity:
        gscPullableMissing === null || gscPullableMissing > GSC_CRITICAL_PULLABLE_DAYS
          ? "critical"
          : "warning",
      title: gscPullableMissing === null
        ? "No Search Console data on disk yet"
        : `Search Console: ${gscPullableMissing} new ${gscPullableMissing === 1 ? "day" : "days"} ready to pull`,
      description: gscLatest
        ? `Latest organic-search clicks on disk: ${gscLatest}. GSC publishes with a ~3-day lag, so anything beyond that has already landed. The Refresh button re-pulls the last 5 days, so one click catches up.`
        : "The daily aggregates on disk don't contain Search Console clicks yet. Run the refresh to pull GSC for the window.",
      action: { label: "Refresh data", kind: "refresh_topbar" },
      latest_date: gscLatest,
      days_behind: gscDaysBehind,
    });
  }

  // 3. Peec (AI visibility). Same publishable-frontier logic. Peec
  //    chats land in the API the morning after they run, so the
  //    freshest reachable date is yesterday.
  //
  // Subtle state to detect: the user just ran a Peec MCP pull, so
  // raw/peec/<date>.json is fresher than any processed daily aggregate.
  // We need to nudge the user to re-aggregate (fast path), NOT to pull
  // Peec again. Surface a different action in that case.
  const peecLatest = await findLatestWithRealPeec(dailyFiles);
  const rawPeecLatest = await latestRawPeecDate();
  const peecPullableMissing = pullableMissingDays(peecLatest, today, PEEC_PUBLISH_LAG_DAYS);
  const peecDaysBehind = peecLatest ? daysBetween(peecLatest, today) : null;

  // "Aggregate-needed" state: raw Peec exists and is newer than the
  // processed daily aggregate. The fix isn't another MCP pull — it's
  // running aggregate_daily.py, which the topbar's "Re-aggregate"
  // option does.
  const aggregateNeeded =
    rawPeecLatest !== null &&
    (peecLatest === null || rawPeecLatest > peecLatest);

  if (aggregateNeeded) {
    alerts.push({
      id: "peec",
      severity: "info",
      title: `Peec data is ready to apply (${rawPeecLatest})`,
      description:
        `Raw Peec file for ${rawPeecLatest} is on disk but hasn't been folded into the processed dailies yet. Click Refresh data → "Re-aggregate last 7 days" to apply it. Fast (~5s) — no GSC / GA4 calls.`,
      action: {
        label: "Refresh data → Re-aggregate",
        kind: "refresh_topbar",
      },
      latest_date: rawPeecLatest,
      days_behind: daysBetween(rawPeecLatest, today),
    });
  } else if (peecPullableMissing === null || peecPullableMissing > 0) {
    alerts.push({
      id: "peec",
      severity:
        peecPullableMissing === null || peecPullableMissing > PEEC_CRITICAL_PULLABLE_DAYS
          ? "critical"
          : "warning",
      title: peecPullableMissing === null
        ? "No AI-visibility data on disk yet"
        : `AI visibility: ${peecPullableMissing} new ${peecPullableMissing === 1 ? "day" : "days"} ready to pull`,
      description: peecLatest
        ? `Latest Peec data on disk: ${peecLatest}. Peec pulls go through the Peec MCP — the dashboard's Refresh button doesn't cover them. Ask Claude (or let the scheduled agent do it), then click Refresh data → "Re-aggregate" afterwards.`
        : "Peec data hasn't been pulled yet. Peec pulls run through the Peec MCP inside a Claude session.",
      action: {
        label: "Copy prompt",
        kind: "claude",
        claude_prompt: "pull peec data for the last 7 days",
      },
      latest_date: peecLatest,
      days_behind: peecDaysBehind,
    });
  }

  // 4. Content inventory (scraped site pages).
  const contentDate = await latestContentInventoryDate();
  const contentDays = contentDate ? daysBetween(contentDate, today) : null;
  if (contentDays === null || contentDays > CONTENT_STALE_DAYS) {
    alerts.push({
      id: "content",
      severity:
        contentDays === null || contentDays > CONTENT_CRITICAL_DAYS
          ? "warning"
          : "info",
      title: contentDays === null
        ? "Website content has never been scraped"
        : `Website content is ${contentDays} days old`,
      description:
        "Cluster assignments and the AI Visibility Improvements rules read from the latest scrape. Re-run the content pipeline to capture new or edited pages.",
      action: {
        label: "Open Data settings",
        kind: "link",
        href: "/settings/data",
      },
      latest_date: contentDate,
      days_behind: contentDays,
    });
  }

  return alerts;
}

// ---------------------------------------------------------------------
// File scanners
// ---------------------------------------------------------------------

/** Return the ISO dates of daily aggregate files, newest first. */
async function listDailyFilesSortedDesc(): Promise<string[]> {
  try {
    const files = await readdir(DAILY_DIR);
    return files
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** Find the newest daily file whose GSC block carries real data
 *  (either clicks > 0 OR impressions > 0). */
async function findLatestWithRealGSC(
  datesDesc: string[],
): Promise<string | null> {
  for (const date of datesDesc.slice(0, MAX_LOOKBACK_DAYS)) {
    const payload = await readDaily(date);
    if (!payload) continue;
    const seo = payload.summary?.seo;
    if (!seo || seo.available === false) continue;
    if ((seo.total_clicks ?? 0) > 0 || (seo.total_impressions ?? 0) > 0) {
      return date;
    }
  }
  return null;
}

/** Find the newest daily file whose Peec block is available and has
 *  non-zero mentions. `avg_visibility > 0` also counts — some days
 *  have visibility without raw mentions due to Peec's own aggregation. */
async function findLatestWithRealPeec(
  datesDesc: string[],
): Promise<string | null> {
  for (const date of datesDesc.slice(0, MAX_LOOKBACK_DAYS)) {
    const payload = await readDaily(date);
    if (!payload) continue;
    const geo = payload.summary?.geo;
    if (!geo || geo.available === false) continue;
    if ((geo.total_mentions ?? 0) > 0 || (geo.avg_visibility ?? 0) > 0) {
      return date;
    }
  }
  return null;
}

async function readDaily(date: string): Promise<DailyAggregate | null> {
  try {
    const raw = await readFile(path.join(DAILY_DIR, `${date}.json`), "utf-8");
    return JSON.parse(raw) as DailyAggregate;
  } catch {
    return null;
  }
}

/** Returns the ISO date of the most recent raw Peec file on disk,
 *  or null if none exists. Used to detect the "post-pull, pre-aggregate"
 *  state where the user has freshly-fetched Peec data but the aggregator
 *  hasn't folded it into the processed dailies yet. */
async function latestRawPeecDate(): Promise<string | null> {
  const dir = path.join(REPO_ROOT, "data", "raw", "peec");
  try {
    const entries = await readdir(dir);
    const dates = entries
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort();
    return dates[dates.length - 1] ?? null;
  } catch {
    return null;
  }
}

/** Returns the ISO date of the most recent scrape inventory on disk,
 *  or null if none exists. */
async function latestContentInventoryDate(): Promise<string | null> {
  try {
    const entries = await readdir(CONTENT_DIR, { withFileTypes: true });
    const dates = entries
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort();
    return dates[dates.length - 1] ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Date math
// ---------------------------------------------------------------------

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(earlierIso: string, laterIso: string): number {
  const earlier = Date.parse(`${earlierIso}T00:00:00Z`);
  const later = Date.parse(`${laterIso}T00:00:00Z`);
  return Math.floor((later - earlier) / 86_400_000);
}

/**
 * How many *publishable* days of new data exist beyond what's on disk.
 *
 * publish_lag = the number of days the source delays before serving
 * day N's data. The freshest day the API can ever return is
 * `today - publish_lag` (call it the publishable frontier).
 *
 * Returns:
 *   - `null` when no data is on disk (caller treats as a separate alert).
 *   - `0` when latest_on_disk is at (or past) the publishable frontier
 *     — the source is as fresh as it can possibly be, no alert needed.
 *   - `n > 0` when latest_on_disk is `n` days behind the frontier
 *     — these are the days the user can ACTUALLY pull right now.
 *
 * This replaces a naive `today - latest > N` check that produced false
 * alarms when the source's own publish lag accounted for the gap.
 */
function pullableMissingDays(
  latestIso: string | null,
  todayIso: string,
  publishLagDays: number,
): number | null {
  if (!latestIso) return null;
  const daysBehindToday = daysBetween(latestIso, todayIso);
  // Subtract the publish lag — anything within the lag window is
  // unreachable, so it doesn't count as "pullable missing".
  return Math.max(0, daysBehindToday - publishLagDays);
}

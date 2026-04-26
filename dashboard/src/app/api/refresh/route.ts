/**
 * POST /api/refresh       — trigger a refresh run in the background
 * GET  /api/refresh       — return current refresh state for polling
 *
 * POST body (optional):
 *   {
 *     "mode":      "incremental" | "backfill" | "aggregate-only",  // default "incremental"
 *     "days_back": 7 | 30 | 90                                     // default 30
 *   }
 *
 * `incremental` pulls only dates in the window that aren't already on
 * disk (fast; idempotent). `backfill` pulls every date in the window,
 * overwriting existing files (use to re-fetch data that became more
 * complete after initial pull — e.g. GSC lag). `aggregate-only` skips
 * the GSC/GA4/LLM pulls and only re-runs the aggregator — useful right
 * after a Claude-side Peec MCP pull, where the only thing the dashboard
 * needs to do is fold the new raw Peec files into the processed
 * dailies. Fast (~5s).
 *
 * POST returns immediately with "running" once the state file has been
 * bumped. The actual Python execution continues in the background and
 * writes progress to refresh_state.json, which the dashboard polls via
 * GET on this same route.
 *
 * Localhost-only. DO NOT expose without auth.
 */

import { NextResponse } from "next/server";
import { readRefreshState, startRefresh, type RefreshMode } from "@/lib/refresh";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------

export async function GET() {
  const state = await readRefreshState();
  return NextResponse.json(state);
}

// ---------------------------------------------------------------------

export async function POST(request: Request) {
  let daysBack = 30;
  let mode: RefreshMode = "incremental";
  try {
    const body = await request.json();
    if (typeof body?.days_back === "number" && body.days_back > 0 && body.days_back <= 90) {
      daysBack = Math.floor(body.days_back);
    }
    if (
      body?.mode === "backfill" ||
      body?.mode === "incremental" ||
      body?.mode === "aggregate-only"
    ) {
      mode = body.mode;
    }
  } catch {
    // No body or bad JSON — use defaults.
  }

  // startRefresh awaits the claim (writes "running" state to disk),
  // then fires the per-date worker in the background. By the time
  // this resolves, the state file already shows `status: "running"`,
  // so the response carries that — no race with the worker.
  //
  // If another refresh was already in progress, claimRefresh throws
  // and we surface it as 409 to the client.
  try {
    const running = await startRefresh(daysBack, mode);
    return NextResponse.json(running, { status: 202 });
  } catch (err) {
    const existing = await readRefreshState();
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Refresh failed to start",
        started_at: existing.started_at,
        log_tail: existing.log_tail,
      },
      { status: 409 }
    );
  }
}

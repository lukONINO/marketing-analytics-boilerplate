/**
 * POST /api/scrape        — trigger the content pipeline in the background
 * GET  /api/scrape        — poll current scrape state
 *
 * POST body (optional):
 *   { "sitemap": "https://acme.io/sitemap.xml", "mode": "full" | "retry-shells" }
 *
 * Mode defaults to "full". Use "retry-shells" to re-scrape only URLs
 * whose latest record looks like the CDN shell response — much faster
 * than a full bulk re-run.
 *
 * Sitemap default reads from process.env.SITE_CANONICAL_ORIGIN when
 * set, falls back to https://acme.io/sitemap.xml as a placeholder.
 *
 * Localhost-only.
 */

import { NextResponse } from "next/server";

import { readScrapeState, startScrape, type ScrapeMode } from "@/lib/scrape";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await readScrapeState();
  return NextResponse.json(state);
}

export async function POST(request: Request) {
  const origin = (process.env.SITE_CANONICAL_ORIGIN || "https://acme.io").replace(/\/$/, "");
  let sitemap = `${origin}/sitemap.xml`;
  let mode: ScrapeMode = "full";
  try {
    const body = await request.json();
    if (typeof body?.sitemap === "string" && /^https?:\/\//.test(body.sitemap)) {
      sitemap = body.sitemap;
    }
    if (body?.mode === "retry-shells" || body?.mode === "full") {
      mode = body.mode;
    }
  } catch {
    // No body — use defaults.
  }

  try {
    const running = await startScrape({ sitemap, mode });
    return NextResponse.json(running, { status: 202 });
  } catch (err) {
    const existing = await readScrapeState();
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Scrape failed to start",
        started_at: existing.started_at,
        log_tail: existing.log_tail,
      },
      { status: 409 },
    );
  }
}

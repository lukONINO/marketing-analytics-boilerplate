/**
 * PATCH /api/pillar-pages   body: { cluster: string, lang: "en"|"de", url: string|null }
 *
 * Set or clear the designated pillar URL for a (cluster, lang) pair.
 * `url: null` removes the designation entirely. No per-cluster endpoint
 * segment — cluster + lang are in the body so one route covers both
 * "set" and "clear".
 *
 * Writes to data/dashboard/pillar_pages.json atomically.
 *
 * Localhost-only. The dashboard has no auth layer; DO NOT expose.
 */

import { NextResponse } from "next/server";

import { setPillarPage } from "@/lib/mutations";

export const dynamic = "force-dynamic";

const VALID_LANGS = ["en", "de"] as const;

export async function PATCH(request: Request) {
  let body: { cluster?: unknown; lang?: unknown; url?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const cluster = typeof body.cluster === "string" ? body.cluster : null;
  const lang = typeof body.lang === "string" ? body.lang : null;
  const url =
    body.url === null || body.url === undefined
      ? null
      : typeof body.url === "string"
        ? body.url
        : undefined; // undefined = invalid type; null = explicit clear

  if (!cluster) {
    return NextResponse.json({ error: "cluster (slug) required" }, { status: 400 });
  }
  if (!lang || !VALID_LANGS.includes(lang as (typeof VALID_LANGS)[number])) {
    return NextResponse.json(
      { error: `lang must be one of ${VALID_LANGS.join(" / ")}` },
      { status: 400 },
    );
  }
  if (url === undefined) {
    return NextResponse.json(
      { error: "url must be a string URL or null (to clear)" },
      { status: 400 },
    );
  }

  const updated = await setPillarPage(
    cluster,
    lang as "en" | "de",
    url,
  );
  return NextResponse.json(updated);
}

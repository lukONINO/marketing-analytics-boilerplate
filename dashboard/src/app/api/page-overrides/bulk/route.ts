/**
 * PATCH /api/page-overrides/bulk
 *   body: { urls: string[], cluster: string | null, includePairs?: boolean }
 *
 * Set the same cluster override on a list of URLs in one atomic write.
 * `cluster: null` clears the overrides.
 *
 * When `includePairs` is true, the server expands the URL list to
 * include each URL's translated counterpart (via hreflang stored in
 * page_clusters.json, with a fuzzy-title fallback) before writing. The
 * fuzzy matcher runs on the server so client doesn't need the full
 * assignments array just to resolve pairs.
 *
 * Returns:
 *   { updated: [{url, cluster}, ...], skipped: [{url, reason}, ...] }
 *
 * Localhost-only.
 */

import { NextResponse } from "next/server";

import { loadPageClusters } from "@/lib/data";
import { setClusterOverrideBulk } from "@/lib/mutations";
import { findTranslationPair } from "@/lib/pair-detection";

export const dynamic = "force-dynamic";

const MAX_URLS_PER_REQUEST = 500;

export async function PATCH(request: Request) {
  let body: { urls?: unknown; cluster?: unknown; includePairs?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    !Array.isArray(body.urls) ||
    body.urls.length === 0 ||
    !body.urls.every((u) => typeof u === "string" && u.length > 0)
  ) {
    return NextResponse.json(
      { error: "urls must be a non-empty array of strings" },
      { status: 400 },
    );
  }
  if (body.urls.length > MAX_URLS_PER_REQUEST) {
    return NextResponse.json(
      {
        error: `too many urls (${body.urls.length}); max ${MAX_URLS_PER_REQUEST} per request`,
      },
      { status: 413 },
    );
  }

  const cluster =
    body.cluster === null
      ? null
      : typeof body.cluster === "string"
        ? body.cluster
        : undefined;
  if (cluster === undefined) {
    return NextResponse.json(
      { error: "cluster must be a string slug or null (to clear)" },
      { status: 400 },
    );
  }

  const includePairs = body.includePairs === true;

  // Resolve pairs server-side if requested. The assignments JSON lives
  // on disk; there's no reason to make the client send it along.
  let finalUrls = [...new Set(body.urls as string[])];
  if (includePairs && cluster !== null) {
    const pageClusters = await loadPageClusters();
    const assignments = pageClusters?.assignments ?? [];
    const byUrl = new Map(assignments.map((a) => [a.url, a]));
    const pairs = new Set<string>();
    for (const url of finalUrls) {
      const a = byUrl.get(url);
      if (!a) continue;
      // Prefer the explicit hreflang pair; fall back to fuzzy matcher.
      let pairUrl = a.translation_pair_url ?? null;
      if (!pairUrl) {
        const fuzzy = findTranslationPair(a, assignments, 50);
        if (fuzzy) pairUrl = fuzzy.url;
      }
      if (pairUrl && !finalUrls.includes(pairUrl)) {
        pairs.add(pairUrl);
      }
    }
    finalUrls = [...finalUrls, ...pairs];
  }

  const { updated } = await setClusterOverrideBulk(
    finalUrls,
    cluster,
    includePairs ? "manual-ui-pair" : "manual-ui",
  );

  return NextResponse.json({
    updated,
    skipped: finalUrls.length - updated.length,
    includePairs,
  });
}

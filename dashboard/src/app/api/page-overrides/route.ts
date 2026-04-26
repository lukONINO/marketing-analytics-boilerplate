/**
 * PATCH /api/page-overrides
 *   body: { url: string, cluster: string | null, pairUrl?: string | null }
 *
 * Set / clear the cluster override for a URL. When `pairUrl` is
 * provided (non-null), the same cluster override is applied to the
 * translated counterpart in a single atomic pair of writes. `cluster:
 * null` removes the override entirely.
 *
 * Returns: { updated: [{url, cluster}, ...] } — the URLs actually
 * touched this request.
 *
 * Localhost-only. The dashboard has no auth layer; DO NOT expose.
 */

import { NextResponse } from "next/server";

import { setClusterOverride } from "@/lib/mutations";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  let body: { url?: unknown; cluster?: unknown; pairUrl?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.url !== "string" || !body.url) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
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

  const pairUrl =
    body.pairUrl === null || body.pairUrl === undefined
      ? null
      : typeof body.pairUrl === "string"
        ? body.pairUrl
        : undefined;
  if (pairUrl === undefined) {
    return NextResponse.json(
      { error: "pairUrl must be a string URL, null, or omitted" },
      { status: 400 },
    );
  }

  const updated: { url: string; cluster: string | null }[] = [];
  await setClusterOverride(body.url, cluster, "manual-ui");
  updated.push({ url: body.url, cluster });

  if (pairUrl) {
    await setClusterOverride(pairUrl, cluster, "manual-ui-pair");
    updated.push({ url: pairUrl, cluster });
  }

  return NextResponse.json({ updated });
}

/**
 * DELETE /api/clusters/[slug]
 *
 * Remove a custom cluster. YAML-defined clusters cannot be deleted
 * from the API — the dashboard only owns the `custom_clusters.json`
 * file. Pages currently overridden *into* this cluster become
 * "unassigned" — their override row is retained so we can report a
 * stale-pointer count, but the cluster no longer appears in the list.
 *
 * Localhost-only.
 */

import { NextResponse } from "next/server";

import { deleteCustomCluster } from "@/lib/mutations";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const ok = await deleteCustomCluster(slug);
  if (!ok) {
    return NextResponse.json(
      { error: `custom cluster '${slug}' not found` },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, slug });
}

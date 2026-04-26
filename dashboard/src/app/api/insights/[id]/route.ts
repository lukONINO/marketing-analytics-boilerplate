/**
 * PATCH /api/insights/[id]   body: { status: "open" | "reviewed" | "archived" }
 * DELETE /api/insights/[id]
 *
 * Used by the dashboard UI when a user archives or deletes an insight.
 * Writes through `data/dashboard/insights.json` atomically (same file
 * Claude writes to via the dashboard-sync skill — no separate store).
 *
 * Localhost-only. The dashboard has no auth layer; DO NOT expose.
 */

import { NextResponse } from "next/server";

import { deleteInsight, patchInsightStatus } from "@/lib/mutations";
import type { Insight } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID_STATUSES: Insight["status"][] = ["open", "reviewed", "archived"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { status?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.status || !VALID_STATUSES.includes(body.status as Insight["status"])) {
    return NextResponse.json(
      { error: `status must be one of ${VALID_STATUSES.join(" / ")}` },
      { status: 400 },
    );
  }

  const updated = await patchInsightStatus(id, body.status as Insight["status"]);
  if (!updated) {
    return NextResponse.json({ error: `insight ${id} not found` }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ok = await deleteInsight(id);
  if (!ok) {
    return NextResponse.json({ error: `insight ${id} not found` }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id });
}

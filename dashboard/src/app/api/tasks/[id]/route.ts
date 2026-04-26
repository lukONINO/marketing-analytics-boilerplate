/**
 * PATCH /api/tasks/[id]   body: { status?, reason?, owner? }
 * DELETE /api/tasks/[id]
 *
 * Used by:
 *  - Kanban drag-and-drop (sends new status)
 *  - Drawer action buttons (status change, reassign team, archive, delete)
 *
 * Tasks are intentionally lightweight here: they belong to a *team*
 * (content / engineering / peec ai) and have a status. No due dates,
 * no per-person assignment — actual scheduling lives elsewhere.
 *
 * Localhost-only.
 */

import { NextResponse } from "next/server";

import { deleteTask, patchTask, type TaskPatch } from "@/lib/mutations";
import { TASK_OWNERS, type Task, type TaskOwner } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID_STATUSES: Task["status"][] = ["open", "in_progress", "done", "deferred"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: {
    status?: unknown;
    reason?: unknown;
    owner?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: TaskPatch = {};

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status as Task["status"])) {
      return NextResponse.json(
        { error: `status must be one of ${VALID_STATUSES.join(" / ")}` },
        { status: 400 },
      );
    }
    patch.status = body.status as Task["status"];
  }

  if (typeof body.reason === "string") patch.reason = body.reason;

  if (body.owner !== undefined) {
    // owner is required to be one of the allowed team groups — no
    // free-form strings, no individual people. Empty string and null
    // are both rejected (use a different patch shape if we ever need
    // an "unassigned" state).
    if (
      typeof body.owner !== "string" ||
      !(TASK_OWNERS as readonly string[]).includes(body.owner)
    ) {
      return NextResponse.json(
        { error: `owner must be one of ${TASK_OWNERS.join(" / ")}` },
        { status: 400 },
      );
    }
    patch.owner = body.owner as TaskOwner;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "no-op PATCH: provide status, owner, or reason" },
      { status: 400 },
    );
  }

  const updated = await patchTask(id, patch);
  if (!updated) {
    return NextResponse.json({ error: `task ${id} not found` }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ok = await deleteTask(id);
  if (!ok) {
    return NextResponse.json({ error: `task ${id} not found` }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id });
}

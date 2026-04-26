/**
 * DELETE /api/prompt-issue-dismissals/[id]
 *
 * Removes a previously-persisted dismissal — the corresponding
 * "Suggested changes" row will reappear on the next render.
 *
 * The id segment must be URL-encoded since it contains `:` (the
 * separator between prompt_id and issue kind).
 *
 * Localhost-only.
 */

import { NextResponse } from "next/server";

import { deletePromptIssueDismissal } from "@/lib/mutations";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Next.js delivers the `[id]` segment URL-decoded already, so the
  // colon is back in `pr_xxx:missing-stage-tag` shape by the time we
  // see it. No further decoding needed.
  const ok = await deletePromptIssueDismissal(id);
  if (!ok) {
    return NextResponse.json(
      { error: `dismissal ${id} not found` },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, id });
}

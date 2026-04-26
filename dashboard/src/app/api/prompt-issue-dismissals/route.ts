/**
 * POST /api/prompt-issue-dismissals
 *
 * Body: { id: string, prompt_id: string, kind: string, reason?: string }
 *
 * Persists a user dismissal of one row from the "Suggested changes"
 * panel on /strategy/prompts. The next page render will hide the row.
 *
 * Localhost-only — the dashboard has no auth layer; DO NOT expose.
 */

import { NextResponse } from "next/server";

import { addPromptIssueDismissal } from "@/lib/mutations";

export const dynamic = "force-dynamic";

interface Body {
  id?: unknown;
  prompt_id?: unknown;
  kind?: unknown;
  reason?: unknown;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Minimal validation — all fields except `reason` are required.
  // The id is the issue's stable `${prompt_id}:${kind}`; we accept it
  // verbatim from the client rather than reconstruct it server-side
  // so a future change in id format can't break old dismissals.
  if (typeof body.id !== "string" || !body.id.includes(":")) {
    return NextResponse.json(
      { error: "id must be a string of the form `${prompt_id}:${kind}`" },
      { status: 400 },
    );
  }
  if (typeof body.prompt_id !== "string" || !body.prompt_id.startsWith("pr_")) {
    return NextResponse.json(
      { error: "prompt_id must be a string starting with `pr_`" },
      { status: 400 },
    );
  }
  if (typeof body.kind !== "string" || body.kind.length === 0) {
    return NextResponse.json(
      { error: "kind is required (issue kind string)" },
      { status: 400 },
    );
  }
  const reason =
    typeof body.reason === "string" && body.reason.trim().length > 0
      ? body.reason.trim()
      : undefined;

  const persisted = await addPromptIssueDismissal({
    id: body.id,
    prompt_id: body.prompt_id,
    kind: body.kind,
    reason,
  });
  return NextResponse.json(persisted, { status: 201 });
}

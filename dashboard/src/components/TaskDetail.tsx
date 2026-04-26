"use client";

import clsx from "clsx";
import { useState } from "react";

import { CopyPromptButton } from "@/components/CopyPromptButton";
import { STATUS_TOKENS } from "@/components/TaskCard";
import type { Task, TaskStatus } from "@/lib/types";

export interface TaskDetailProps {
  task: Task;
  /** Called after a status change succeeds on the server (updated task). */
  onStatusChange?: (updated: Task) => void;
  /** Called after a delete succeeds on the server. */
  onDelete?: (id: string) => void;
}

/**
 * Full task detail for the DetailDrawer.
 *
 * Mutations are done directly via `/api/tasks/[id]` — no more
 * copy-paste Claude commands. Drag-and-drop in the Kanban board also
 * hits the same endpoint, so there's a single source of truth for
 * status changes.
 *
 * Delete requires a second click to confirm.
 *
 * Tasks have no due dates — scheduling is tracked elsewhere; this
 * board is just the "what should team X pick up next" surface.
 */

export function TaskDetail({ task, onStatusChange, onDelete }: TaskDetailProps) {
  const [busy, setBusy] = useState<null | TaskStatus | "delete">(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const NEXT_STATES: TaskStatus[] = (["open", "in_progress", "done", "deferred"] as TaskStatus[])
    .filter((s) => s !== task.status);

  async function patch(body: Record<string, unknown>, busyKey: typeof busy) {
    setBusy(busyKey);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const updated = (await res.json()) as Task;
      onStatusChange?.(updated);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(null);
    }
  }

  async function changeStatus(status: TaskStatus) {
    await patch({ status }, status);
  }

  async function doDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy("delete");
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onDelete?.(task.id);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      setConfirmDelete(false);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2 border border-hairline rounded-xl px-3 py-2.5 bg-surface-muted/50">
        <span className="text-[10px] uppercase tracking-[0.14em] text-ink-500 font-semibold mr-1">
          Move to
        </span>
        {NEXT_STATES.map((status) => {
          const tok = STATUS_TOKENS[status];
          return (
            <button
              key={status}
              type="button"
              onClick={() => changeStatus(status)}
              disabled={busy !== null}
              className={clsx(
                "inline-flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-full transition-all font-medium",
                "bg-surface border border-hairline text-ink-700 hover:border-primary-400 hover:text-primary-700 hover:shadow-card",
                busy === status && "bg-primary-50 text-primary-700 cursor-wait",
                busy !== null && busy !== status && "opacity-40 cursor-not-allowed",
              )}
            >
              {busy === status ? <SpinnerSmall /> : <span className={clsx("w-1.5 h-1.5 rounded-full", tok.dot)} aria-hidden />}
              {tok.label}
            </button>
          );
        })}
        <div className="flex-1" />
        <button
          type="button"
          onClick={doDelete}
          disabled={busy !== null}
          className={clsx(
            "inline-flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-full transition-colors font-medium",
            confirmDelete
              ? "bg-danger-500 text-white hover:bg-danger-600 shadow-card"
              : "text-danger-600 hover:bg-danger-50",
            busy === "delete" && "opacity-70 cursor-wait",
            busy !== null && busy !== "delete" && "opacity-40 cursor-not-allowed",
          )}
        >
          {busy === "delete" ? <SpinnerSmall /> : <TrashIcon />}
          {confirmDelete ? "Click again to confirm" : "Delete"}
        </button>
      </div>

      {error && (
        <div className="text-xs text-danger-600 bg-danger-50 border border-danger/25 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Meta grid */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <MetaRow label="Team">
          {task.owner ? <span className="text-ink-900">{task.owner}</span> : <Muted>unassigned</Muted>}
        </MetaRow>
        <MetaRow label="Source">
          {task.source_report ? (
            task.source_url ? (
              <a href={task.source_url} target="_blank" rel="noreferrer" className="text-primary-700 hover:text-primary-900 hover:underline">
                {task.source_report}
              </a>
            ) : (
              <span className="text-ink-900">{task.source_report}</span>
            )
          ) : (
            <Muted>—</Muted>
          )}
        </MetaRow>
        <MetaRow label="Created by">
          {task.created_by ? <span className="text-ink-900">{task.created_by}</span> : <Muted>—</Muted>}
        </MetaRow>
      </dl>

      {/* Description */}
      {task.description && (
        <section>
          <h3 className="text-[10px] uppercase tracking-[0.14em] text-ink-500 font-semibold mb-2.5">
            Description
          </h3>
          <div className="text-sm text-ink-700 leading-relaxed whitespace-pre-wrap">
            {task.description}
          </div>
        </section>
      )}

      {/* Hand off to Claude — every task carries a self-contained prompt
          when the auto-spawning skill (or the rule pipeline) populated
          it. Keeps the user from having to re-explain context. */}
      {task.claude_prompt && (
        <section>
          <h3 className="text-[10px] uppercase tracking-[0.14em] text-ink-500 font-semibold mb-2.5">
            Hand off to Claude
          </h3>
          <div className="bg-ink-900 text-white text-[12px] font-mono p-3 rounded-lg overflow-x-auto whitespace-pre-wrap leading-relaxed mb-2">
            {task.claude_prompt}
          </div>
          <CopyPromptButton prompt={task.claude_prompt} variant="block" />
        </section>
      )}

      {/* Metadata footer */}
      <section className="pt-4 border-t border-hairline text-[11px] text-ink-500 font-mono space-y-0.5">
        <div>id: {task.id}</div>
        <div>created: {task.created_at}</div>
        {task.updated_at && task.updated_at !== task.created_at && (
          <div>updated: {task.updated_at}</div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-[10px] uppercase tracking-[0.14em] text-ink-500 font-semibold self-center">
        {label}
      </dt>
      <dd className="text-sm">{children}</dd>
    </>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-ink-500 italic">{children}</span>;
}

function SpinnerSmall() {
  return (
    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M8 7V4a1 1 0 011-1h6a1 1 0 011 1v3" />
    </svg>
  );
}

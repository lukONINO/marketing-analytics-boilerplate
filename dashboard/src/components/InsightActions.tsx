"use client";

/**
 * InsightActions — status mutations + delete for a single insight.
 *
 * Renders inside any insight drawer (FindingsView, ClusterFixList,
 * ClusterWork, RecentAnomalies). Calls `/api/insights/[id]` directly
 * — no separate state store, the JSON file under `data/dashboard/`
 * is the single source of truth.
 *
 * Available actions, scoped by current status:
 *   - open     → Mark reviewed · Archive · Delete
 *   - reviewed → Re-open · Archive · Delete
 *   - archived → Re-open · Delete
 *
 * Delete is two-click (the second click confirms). Status changes
 * fire-and-forget — the caller's `onChange` is invoked with the
 * server-returned (canonical) insight on success.
 */

import clsx from "clsx";
import { useState } from "react";

import type { Insight, InsightStatus } from "@/lib/types";

export interface InsightActionsProps {
  /** Insight id (the canonical id from `data/dashboard/insights.json`,
   *  WITHOUT any `find:` prefix that ClusterFix may add). */
  insightId: string;
  /** Current status — drives which transitions are offered. */
  status: InsightStatus;
  /** Called with the updated insight after a status change succeeds. */
  onChange?: (updated: Insight) => void;
  /** Called after a successful delete. */
  onDelete?: (id: string) => void;
}

type Action = InsightStatus | "delete";

const STATUS_LABEL: Record<InsightStatus, string> = {
  open: "Re-open",
  reviewed: "Mark reviewed",
  archived: "Archive",
};

export function InsightActions({ insightId, status, onChange, onDelete }: InsightActionsProps) {
  const [busy, setBusy] = useState<Action | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Allowed transitions per current status. Re-open shows for
  // reviewed + archived; reviewed only when currently open; archive
  // when not already archived.
  const NEXT: InsightStatus[] = ([
    status !== "open" ? "open" : null,
    status === "open" ? "reviewed" : null,
    status !== "archived" ? "archived" : null,
  ].filter(Boolean) as InsightStatus[]);

  async function changeStatus(next: InsightStatus) {
    setBusy(next);
    setError(null);
    try {
      const res = await fetch(`/api/insights/${encodeURIComponent(insightId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const updated = (await res.json()) as Insight;
      onChange?.(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status change failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      // Auto-reset the confirm state after a few seconds so the second
      // click is intentional, not accidental.
      setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    setBusy("delete");
    setError(null);
    try {
      const res = await fetch(`/api/insights/${encodeURIComponent(insightId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      onDelete?.(insightId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setBusy(null);
    }
  }

  return (
    <div className="border-t border-hairline pt-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.14em] text-ink-500 font-semibold mr-1">
          Actions
        </span>
        {NEXT.map((next) => (
          <button
            key={next}
            type="button"
            onClick={() => changeStatus(next)}
            disabled={busy !== null}
            className={clsx(
              "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full transition-all font-medium",
              "bg-surface border border-hairline text-ink-700 hover:border-primary-400 hover:text-primary-700",
              busy === next && "bg-primary-50 text-primary-700 cursor-wait",
              busy !== null && busy !== next && "opacity-40 cursor-not-allowed",
            )}
          >
            {busy === next ? <Spinner /> : <Dot status={next} />}
            {STATUS_LABEL[next]}
          </button>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleDelete}
          disabled={busy !== null}
          className={clsx(
            "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full transition-colors font-medium",
            confirmDelete
              ? "bg-danger-500 text-white hover:bg-danger-600"
              : "text-danger-600 hover:bg-danger-50",
            busy === "delete" && "opacity-70 cursor-wait",
            busy !== null && busy !== "delete" && "opacity-40 cursor-not-allowed",
          )}
        >
          {busy === "delete" ? <Spinner /> : <TrashIcon />}
          {confirmDelete ? "Click again to confirm" : "Delete"}
        </button>
      </div>
      {error && (
        <div className="text-xs text-danger-600 bg-danger-50 border border-danger/25 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------

function Dot({ status }: { status: InsightStatus }) {
  const cls =
    status === "open" ? "bg-primary-500"
    : status === "reviewed" ? "bg-success-500"
    : "bg-ink-400";
  return <span className={clsx("w-1.5 h-1.5 rounded-full", cls)} aria-hidden />;
}

function Spinner() {
  return (
    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M9 6V4a2 2 0 012-2h2a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
    </svg>
  );
}

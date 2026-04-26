"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";

import { DetailDrawer } from "@/components/DetailDrawer";
import { STATUS_TOKENS, TaskCard } from "@/components/TaskCard";
import { TaskDetail } from "@/components/TaskDetail";
import type { Task, TaskStatus } from "@/lib/types";

/**
 * Kanban board for tasks with native HTML5 drag-and-drop.
 *
 * Drag a card into a column → PATCH /api/tasks/[id] with the new
 * status → optimistic local update, then router.refresh() syncs with
 * the server copy.
 *
 * Notes:
 *  - Uses native drag-and-drop to avoid a new dependency. Keyboard
 *    users can change status via the drawer's "Move to" buttons.
 *  - Drop-target columns light up on dragover. Cards ghost out while
 *    being dragged. Drag is cancelled cleanly on Escape.
 *  - Re-ordering WITHIN a column isn't supported (would require a
 *    `position` field in the task schema). Column-level ordering is
 *    by created_at descending — newest task at the top of each column.
 */

const COLUMNS: { key: TaskStatus; label: string; accent: string }[] = [
  { key: "open",        label: "Open",        accent: "bg-ink-400"      },
  { key: "in_progress", label: "In progress", accent: "bg-primary-600"  },
  { key: "done",        label: "Done",        accent: "bg-success-500"  },
  { key: "deferred",    label: "Deferred",    accent: "bg-warning-500"  },
];

export function TasksBoard({ tasks }: { tasks: Task[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Local list = server list ± optimistic mutations (DnD, drawer actions, delete).
  const [local, setLocal] = useState<Task[]>(tasks);
  useEffect(() => setLocal(tasks), [tasks]);

  const [selected, setSelected] = useState<Task | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<string | "all">("all");

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<TaskStatus | null>(null);

  // Keep drawer pointing at the live version of the selected task.
  const selectedLive = selected
    ? local.find((t) => t.id === selected.id) ?? null
    : null;

  const owners = useMemo(() => {
    const set = new Set<string>();
    for (const t of local) if (t.owner) set.add(t.owner);
    return Array.from(set).sort();
  }, [local]);

  const filtered = useMemo(() => {
    if (ownerFilter === "all") return local;
    return local.filter((t) => t.owner === ownerFilter);
  }, [local, ownerFilter]);

  const byStatus = useMemo(() => {
    const out: Record<TaskStatus, Task[]> = {
      open: [], in_progress: [], done: [], deferred: [],
    };
    for (const t of filtered) out[t.status]?.push(t);
    // Newest first within each column. created_at is always set;
    // we fall back to `updated_at` only if a task is missing the
    // (required) created_at for some legacy reason.
    const score = (t: Task) =>
      new Date(t.created_at ?? t.updated_at ?? 0).getTime();
    for (const k of Object.keys(out) as TaskStatus[]) {
      out[k].sort((a, b) => score(b) - score(a));
    }
    return out;
  }, [filtered]);

  // --- Mutations -----------------------------------------------------

  async function applyStatusChange(id: string, status: TaskStatus) {
    // Optimistic
    const prev = local;
    setLocal((l) =>
      l.map((t) =>
        t.id === id ? { ...t, status, updated_at: new Date().toISOString() } : t,
      ),
    );
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      startTransition(() => router.refresh());
    } catch {
      // Revert on failure.
      setLocal(prev);
    }
  }

  function handleStatusChangeFromDrawer(updated: Task) {
    setLocal((l) => l.map((t) => (t.id === updated.id ? updated : t)));
    startTransition(() => router.refresh());
  }

  function handleDelete(id: string) {
    setLocal((l) => l.filter((t) => t.id !== id));
    setSelected(null);
    startTransition(() => router.refresh());
  }

  // --- Drag handlers -------------------------------------------------

  function onDragStart(task: Task, ev: React.DragEvent) {
    setDraggingId(task.id);
    ev.dataTransfer.effectAllowed = "move";
    // Some browsers require dataTransfer to have data to start dragging.
    ev.dataTransfer.setData("text/plain", task.id);
  }

  function onDragEnd() {
    setDraggingId(null);
    setDragOverCol(null);
  }

  function onColumnDragOver(status: TaskStatus, ev: React.DragEvent) {
    if (!draggingId) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
    if (dragOverCol !== status) setDragOverCol(status);
  }

  function onColumnDragLeave(status: TaskStatus) {
    // Leave fires when moving over child nodes too; only clear if
    // we're leaving the same column we entered (debounced by RAF).
    requestAnimationFrame(() => {
      setDragOverCol((c) => (c === status ? null : c));
    });
  }

  function onColumnDrop(status: TaskStatus, ev: React.DragEvent) {
    ev.preventDefault();
    const id = draggingId ?? ev.dataTransfer.getData("text/plain");
    if (!id) return;
    const task = local.find((t) => t.id === id);
    setDraggingId(null);
    setDragOverCol(null);
    if (!task || task.status === status) return;
    applyStatusChange(id, status);
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.14em] text-ink-500 font-semibold">
          Team
        </span>
        <div className="flex items-center bg-surface border border-hairline rounded-xl p-1 shadow-card">
          <OwnerChip active={ownerFilter === "all"} onClick={() => setOwnerFilter("all")}>
            All <span className="text-ink-400 tabular-nums ml-1">{local.length}</span>
          </OwnerChip>
          {owners.map((o) => {
            const count = local.filter((t) => t.owner === o).length;
            return (
              <OwnerChip key={o} active={ownerFilter === o} onClick={() => setOwnerFilter(o)}>
                {o} <span className="text-ink-400 tabular-nums ml-1">{count}</span>
              </OwnerChip>
            );
          })}
        </div>
        <div className="ml-auto text-xs text-ink-500 hidden md:block">
          Drag a card to change status · click for the full brief.
        </div>
      </div>

      {/* Board */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map((col) => {
          const isTarget = dragOverCol === col.key && draggingId !== null;
          return (
            <div
              key={col.key}
              onDragOver={(e) => onColumnDragOver(col.key, e)}
              onDragLeave={() => onColumnDragLeave(col.key)}
              onDrop={(e) => onColumnDrop(col.key, e)}
              className={clsx(
                "bg-surface border rounded-ds flex flex-col min-h-[120px] transition-all shadow-card overflow-hidden",
                isTarget
                  ? "border-primary-500 ring-2 ring-primary-500/15 bg-primary-50/30"
                  : "border-hairline",
              )}
            >
              <div className="px-4 py-3 border-b border-hairline flex items-center justify-between bg-surface-muted/30">
                <div className="flex items-center gap-2">
                  <span className={clsx("w-2 h-2 rounded-full", col.accent)} aria-hidden />
                  <h3 className="text-sm font-semibold text-ink-900">{col.label}</h3>
                </div>
                <span className="text-[11px] text-ink-600 tabular-nums font-semibold bg-surface px-2 py-0.5 rounded-md border border-hairline">
                  {byStatus[col.key].length}
                </span>
              </div>

              <div className="flex-1 max-h-[70vh] overflow-y-auto">
                {byStatus[col.key].length > 0 ? (
                  byStatus[col.key].map((t) => (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={(e) => onDragStart(t, e)}
                      onDragEnd={onDragEnd}
                      className={clsx(
                        "transition-opacity",
                        draggingId === t.id && "opacity-40",
                      )}
                    >
                      <TaskCard task={t} onClick={setSelected} />
                    </div>
                  ))
                ) : (
                  <div className={clsx(
                    "px-4 py-10 text-center text-xs text-ink-500 transition-colors",
                    isTarget && "text-primary-700 bg-primary-50/40",
                  )}>
                    {isTarget ? `Drop to move to ${col.label.toLowerCase()}` : `No ${col.label.toLowerCase()} tasks.`}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Drawer */}
      <DetailDrawer
        open={selectedLive !== null}
        onClose={() => setSelected(null)}
        eyebrow={selectedLive ? `Task · ${STATUS_TOKENS[selectedLive.status].label}` : undefined}
        title={selectedLive?.title}
        widthClass="max-w-2xl"
        headerTrailing={
          selectedLive ? (
            <span className={clsx(
              "text-xs px-2 py-0.5 rounded-md font-medium",
              STATUS_TOKENS[selectedLive.status].pill,
            )}>
              {STATUS_TOKENS[selectedLive.status].label}
            </span>
          ) : null
        }
      >
        {selectedLive && (
          <TaskDetail
            task={selectedLive}
            onStatusChange={handleStatusChangeFromDrawer}
            onDelete={handleDelete}
          />
        )}
      </DetailDrawer>
    </>
  );
}

// ---------------------------------------------------------------------

function OwnerChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "inline-flex items-center px-3 py-1.5 text-xs rounded-lg transition-all font-medium",
        active ? "bg-primary-600 text-white shadow-card" : "text-ink-600 hover:bg-surface-muted hover:text-ink-900",
      )}
    >
      {children}
    </button>
  );
}

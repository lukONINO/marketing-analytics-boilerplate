"use client";

/**
 * Cluster Work — open tasks + relevant insights for ONE cluster.
 *
 * Mirrors the two-class model (Task | Insight) at the cluster scope:
 * the user lands on /topics/<cluster-slug> and sees every task
 * tagged with that cluster (page-creation, on-page fix, outreach) plus
 * every Claude insight whose tags include the cluster slug.
 *
 * Reads from `tasks.json` and `insights.json` filtered server-side
 * before being passed in. The component itself is just a presentation
 * layer: rows + drawer + copy-prompt buttons.
 *
 * Empty states are explicit (no tasks vs no insights are different
 * messages) so the user can tell whether the cluster is genuinely
 * fine or just under-analysed.
 */

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";

import { CopyPromptButton } from "@/components/CopyPromptButton";
import { DetailDrawer } from "@/components/DetailDrawer";
import { InsightActions } from "@/components/InsightActions";
import { TaskDetail } from "@/components/TaskDetail";
import type { Insight, InsightSeverity, Task, TaskStatus } from "@/lib/types";

export interface ClusterWorkProps {
  clusterSlug: string;
  clusterDisplay: string;
  /** Tasks already filtered to the cluster on the server. */
  tasks: Task[];
  /** Insights already filtered to mention this cluster on the server. */
  insights: Insight[];
}

export function ClusterWork({
  clusterSlug,
  clusterDisplay,
  tasks,
  insights,
}: ClusterWorkProps) {
  // Local mirrors so mutations from the drawers reflect immediately.
  const [taskItems, setTaskItems] = useState<Task[]>(tasks);
  const [insightItems, setInsightItems] = useState<Insight[]>(insights);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [openInsight, setOpenInsight] = useState<Insight | null>(null);

  const openTasks = taskItems.filter((t) => t.status === "open" || t.status === "in_progress");
  const sortedTasks = [...openTasks].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const sortedInsights = [...insightItems]
    .filter((i) => i.status === "open" || i.status === undefined)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  function handleTaskChange(updated: Task) {
    setTaskItems((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    setOpenTask((cur) => (cur && cur.id === updated.id ? updated : cur));
  }
  function handleTaskDelete(id: string) {
    setTaskItems((prev) => prev.filter((t) => t.id !== id));
    setOpenTask(null);
  }
  function handleInsightChange(updated: Insight) {
    setInsightItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    setOpenInsight((cur) => (cur && cur.id === updated.id ? updated : cur));
  }
  function handleInsightDelete(id: string) {
    setInsightItems((prev) => prev.filter((i) => i.id !== id));
    setOpenInsight(null);
  }

  if (sortedTasks.length === 0 && sortedInsights.length === 0) {
    return (
      <section className="bg-surface border border-hairline rounded-2xl p-6 text-center">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500 mb-2">
          Open work for {clusterDisplay}
        </h2>
        <p className="text-sm text-ink-600">
          No open tasks or active insights tied to this cluster. Either it&apos;s
          in good shape, or no analysis run has tagged work to it yet.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="bg-surface border border-hairline rounded-2xl shadow-card overflow-hidden">
        <header className="px-5 py-3.5 border-b border-hairline bg-surface-muted/30 flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
            Open work for {clusterDisplay}
          </h2>
          <span className="text-[11px] text-ink-500 tabular-nums">
            {sortedTasks.length} task{sortedTasks.length === 1 ? "" : "s"} ·{" "}
            {sortedInsights.length} insight{sortedInsights.length === 1 ? "" : "s"}
          </span>
        </header>
        <ul className="divide-y divide-hairline">
          {sortedTasks.map((t) => (
            <TaskRow key={t.id} task={t} onSelect={() => setOpenTask(t)} />
          ))}
          {sortedInsights.map((i) => (
            <InsightRow key={i.id} insight={i} onSelect={() => setOpenInsight(i)} />
          ))}
        </ul>
        <footer className="px-5 py-2.5 border-t border-hairline bg-surface-muted/20 flex items-center justify-between gap-3">
          <span className="text-[11px] text-ink-500">
            Click any row for the full detail
          </span>
          <div className="flex gap-3">
            <Link
              href="/tasks"
              className="text-[11px] text-primary-700 hover:text-primary-900 font-medium inline-flex items-center gap-1 group"
            >
              All tasks
              <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>→</span>
            </Link>
            <Link
              href="/strategy/findings"
              className="text-[11px] text-primary-700 hover:text-primary-900 font-medium inline-flex items-center gap-1 group"
            >
              All findings
              <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>→</span>
            </Link>
          </div>
        </footer>
      </section>

      <ClusterTaskDrawer
        task={openTask}
        onClose={() => setOpenTask(null)}
        onChange={handleTaskChange}
        onDelete={handleTaskDelete}
      />
      <ClusterInsightDrawer
        insight={openInsight}
        onClose={() => setOpenInsight(null)}
        onChange={handleInsightChange}
        onDelete={handleInsightDelete}
      />
    </>
  );
}

// ---------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------

function TaskRow({ task, onSelect }: { task: Task; onSelect: () => void }) {
  function handleKey(e: React.KeyboardEvent<HTMLLIElement>) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); }
  }
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKey}
      className="px-5 py-3 hover:bg-surface-muted/40 focus:bg-surface-muted/40 focus:outline-none transition-colors cursor-pointer"
    >
      <div className="flex items-start gap-3">
        <KindPill kind="task" sub={task.status === "in_progress" ? "in progress" : "open"} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-ink-900 leading-tight">
              {task.title}
            </h3>
            {task.owner && (
              <span className="text-[10px] uppercase tracking-wider text-ink-500">{task.owner}</span>
            )}
          </div>
          {task.description && (
            <p className="text-[12px] text-ink-600 mt-1 leading-relaxed line-clamp-2">
              {task.description}
            </p>
          )}
          {task.claude_prompt && (
            <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
              <CopyPromptButton prompt={task.claude_prompt} variant="inline" />
            </div>
          )}
        </div>
        <span className="text-ink-400 shrink-0 mt-1 text-sm" aria-hidden>›</span>
      </div>
    </li>
  );
}

function InsightRow({ insight, onSelect }: { insight: Insight; onSelect: () => void }) {
  function handleKey(e: React.KeyboardEvent<HTMLLIElement>) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); }
  }
  const preview = (insight.body ?? "").split(/\n\n/)[0].slice(0, 180);
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKey}
      className="px-5 py-3 hover:bg-surface-muted/40 focus:bg-surface-muted/40 focus:outline-none transition-colors cursor-pointer"
    >
      <div className="flex items-start gap-3">
        <KindPill kind="insight" sub={insight.severity} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-ink-900 leading-tight">{insight.title}</h3>
            {insight.source_date && (
              <span className="text-[11px] text-ink-500 tabular-nums">{insight.source_date}</span>
            )}
          </div>
          {preview && (
            <p className="text-[12px] text-ink-600 mt-1 leading-relaxed">
              {preview}{(insight.body ?? "").length > 180 ? "…" : ""}
            </p>
          )}
        </div>
        <span className="text-ink-400 shrink-0 mt-1 text-sm" aria-hidden>›</span>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------
// Drawers — minimal, read-only versions
// ---------------------------------------------------------------------

function ClusterTaskDrawer({
  task,
  onClose,
  onChange,
  onDelete,
}: {
  task: Task | null;
  onClose: () => void;
  onChange?: (updated: Task) => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <DetailDrawer
      open={!!task}
      onClose={onClose}
      eyebrow={
        task && (
          <div className="inline-flex items-center gap-2">
            <KindPill kind="task" sub={task.status} />
          </div>
        )
      }
      title={task?.title}
      headerTrailing={
        <Link href="/tasks" className="text-[11px] text-primary-700 hover:text-primary-900 font-medium">
          Manage on /tasks →
        </Link>
      }
    >
      {/* Reuse the canonical TaskDetail so cluster pages get the same
          action set as /tasks: status changes, reassign team, delete,
          plus the Hand-off-to-Claude block. Single source of truth for
          task UX. */}
      {task && (
        <div className="px-5 py-4">
          <TaskDetail
            task={task}
            onStatusChange={onChange}
            onDelete={(id) => {
              onDelete?.(id);
              onClose();
            }}
          />
        </div>
      )}
    </DetailDrawer>
  );
}

function ClusterInsightDrawer({
  insight,
  onClose,
  onChange,
  onDelete,
}: {
  insight: Insight | null;
  onClose: () => void;
  onChange?: (updated: Insight) => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <DetailDrawer
      open={!!insight}
      onClose={onClose}
      eyebrow={
        insight && (
          <div className="inline-flex items-center gap-2">
            <KindPill kind="insight" sub={insight.severity} />
            {insight.source_date && (
              <span className="text-[11px] text-ink-500 tabular-nums">{insight.source_date}</span>
            )}
          </div>
        )
      }
      title={insight?.title}
    >
      {insight && (
        <div className="px-5 py-4 space-y-4">
          <div className="text-[11px] text-ink-500 tabular-nums">
            {insight.id} · {insight.source}
          </div>
          {insight.body && (
            <div className="text-sm text-ink-700 whitespace-pre-wrap leading-relaxed">{insight.body}</div>
          )}
          {insight.linked_urls && insight.linked_urls.length > 0 && (
            <div className="border-t border-hairline pt-4">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-ink-500 mb-2">
                Linked references
              </div>
              <ul className="space-y-1">
                {insight.linked_urls.map((url) => (
                  <li key={url} className="text-xs">
                    <a href={url} target="_blank" rel="noreferrer" className="text-primary-700 hover:text-primary-900 underline decoration-dotted underline-offset-2 break-all">
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <InsightActions
            insightId={insight.id}
            status={insight.status}
            onChange={onChange}
            onDelete={onDelete}
          />
        </div>
      )}
    </DetailDrawer>
  );
}

// ---------------------------------------------------------------------

function KindPill({
  kind,
  sub,
}: {
  kind: "task" | "insight";
  sub?: TaskStatus | InsightSeverity | string;
}) {
  const main = kind === "task" ? "Task" : "Insight";
  const styles = kind === "task"
    ? "bg-primary-50 text-primary-700 ring-primary-200"
    : "bg-warning-50 text-warning-600 ring-warning/25";
  return (
    <span
      className={clsx(
        "shrink-0 inline-flex items-center text-[10px] uppercase tracking-[0.12em] font-semibold px-1.5 py-0.5 rounded ring-1 ring-inset",
        styles,
      )}
    >
      {main}
      {sub ? <span className="opacity-70 ml-1">· {sub}</span> : null}
    </span>
  );
}

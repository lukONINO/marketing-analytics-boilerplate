import { DataRefreshGuide } from "@/components/DataRefreshGuide";
import { TasksBoard } from "@/components/TasksBoard";
import { loadTasks } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const { tasks, last_updated } = await loadTasks();

  const openCount = tasks.filter((t) => t.status === "open").length;
  const inProgCount = tasks.filter((t) => t.status === "in_progress").length;
  const doneCount = tasks.filter((t) => t.status === "done").length;

  return (
    <>
      <DataRefreshGuide
        pageKey="tasks"
        summary="Tasks are written by Claude during analysis runs — they're not auto-generated from a script. Trigger any of the workflows below to add new tasks here."
        actions={[
          {
            label: "Daily marketing report",
            description: "Pulls all four data sources, finds anomalies, and logs tasks for any flagged issues.",
            kind: "claude",
            prompt: "run daily marketing report",
          },
          {
            label: "Cluster deep-dive",
            description: "Audits one cluster end-to-end (SEO + AI + content + competitors) and creates 1-3 priority tasks. Replace <slug> with one of your cluster slugs.",
            kind: "claude",
            prompt: "analyze cluster <slug>",
          },
          {
            label: "Visibility lift planning",
            description: "Reads the AI Visibility Improvements panel and creates one task per high-severity opportunity.",
            kind: "claude",
            prompt: "visibility lift top 5",
          },
          {
            label: "Page draft from a task",
            description: "Once a task calls for new content (tsk_…), this drafts a full page following the page-draft contract (≥3 numeric claims, schema anchor, 4 internal links, EN/DE mirror).",
            kind: "claude",
            prompt: "draft a new page for <task-id>",
          },
        ]}
      />
      <header className="mb-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <span className="inline-block text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-700 bg-accent-50 px-2 py-0.5 rounded-md ring-1 ring-inset ring-accent-200 mb-2">
              Workflow
            </span>
            <h1 className="font-display text-[28px] md:text-[32px] font-bold text-ink-900 tracking-tight">Tasks</h1>
            <p className="text-sm text-ink-600 mt-2 leading-relaxed max-w-3xl">
              The work Claude extracted from insights. Click any card for the full brief. Drag between columns to change status — or use the drawer&apos;s buttons.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <StatChip label="open"        value={openCount}   tone="ink"     />
            <StatChip label="in progress" value={inProgCount} tone="primary" />
            <StatChip label="done"        value={doneCount}   tone="success" />
            <StatChip label="total"       value={tasks.length} tone="ink" />
            {last_updated && (
              <div className="text-ink-500 tabular-nums text-[11px]">
                updated {last_updated.slice(0, 10)}
              </div>
            )}
          </div>
        </div>
      </header>

      <TasksBoard tasks={tasks} />
    </>
  );
}

function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ink" | "primary" | "success";
}) {
  const cls =
    tone === "primary"
      ? "bg-primary-50 text-primary-700 ring-primary-200"
      : tone === "success"
      ? "bg-success-50 text-success-600 ring-success/25"
      : "bg-surface-muted text-ink-700 ring-hairline-subtle";

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ring-1 ring-inset ${cls}`}>
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="text-[10px] uppercase tracking-wider font-medium opacity-80">{label}</span>
    </div>
  );
}

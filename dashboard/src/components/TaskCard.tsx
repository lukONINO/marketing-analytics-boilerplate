"use client";

import clsx from "clsx";
import Link from "next/link";

import { CopyPromptButton } from "@/components/CopyPromptButton";
import type { Task, TaskStatus } from "@/lib/types";

const STATUS_TOKENS: Record<TaskStatus, { label: string; pill: string; dot: string }> = {
  open:        { label: "Open",        pill: "bg-surface-muted text-ink-700 ring-1 ring-inset ring-hairline-subtle",   dot: "bg-ink-500"      },
  in_progress: { label: "In progress", pill: "bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-200",      dot: "bg-primary-600"  },
  done:        { label: "Done",        pill: "bg-success-50 text-success-600 ring-1 ring-inset ring-success/25",       dot: "bg-success-500"  },
  deferred:    { label: "Deferred",    pill: "bg-warning-50 text-warning-600 ring-1 ring-inset ring-warning/25",       dot: "bg-warning-500"  },
};

export interface TaskCardProps {
  task: Task;
  variant?: "row" | "compact";
  onClick?: (task: Task) => void;
  href?: string;
}

export function TaskCard({ task, variant = "row", onClick, href }: TaskCardProps) {
  const isInteractive = !!onClick || !!href;

  const handleClick = () => {
    if (onClick) onClick(task);
  };

  if (variant === "compact") {
    // Headline-only compact row: title (single line, truncated). Owner
    // + ID are intentionally omitted — this row is meant to be
    // glanceable in the Overview sidebar; the kanban board (`row`
    // variant) carries the full meta.
    const classes = clsx(
      "block w-full text-left px-5 py-2.5 flex items-center gap-3 transition-colors",
      isInteractive && "hover:bg-surface-muted cursor-pointer",
      !isInteractive && "cursor-default",
    );
    const inner = (
      <div className="flex-1 min-w-0 text-sm font-medium text-ink-900 leading-snug truncate">
        {task.title}
      </div>
    );
    if (href) return <Link href={href} className={classes}>{inner}</Link>;
    if (onClick) return <button type="button" onClick={handleClick} className={classes}>{inner}</button>;
    return <div className={classes}>{inner}</div>;
  }

  // "row" — used inside the Kanban column.
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!isInteractive}
      className={clsx(
        "group w-full text-left px-4 py-3 border-b border-hairline last:border-b-0 transition-colors",
        isInteractive && "hover:bg-surface-muted cursor-pointer",
        !isInteractive && "cursor-default",
      )}
      aria-label={`Open task: ${task.title}`}
    >
      <div className="text-sm font-medium text-ink-900 leading-snug line-clamp-2 group-hover:text-primary-800 transition-colors">
        {task.title}
      </div>
      <div className="flex items-center flex-wrap gap-2 text-[11px] text-ink-500 mt-2">
        {task.owner && (
          <span className="inline-flex items-center gap-1 text-ink-600">
            <TeamIcon />
            {task.owner}
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-ink-400">{shortenId(task.id)}</span>
      </div>
      {task.claude_prompt && (
        <div
          className="mt-2 pt-2 border-t border-hairline-subtle flex justify-end"
          // Stop the click bubbling to the card's onClick (which opens
          // the drawer) — the user clicked Copy Prompt deliberately.
          onClick={(e) => e.stopPropagation()}
        >
          <CopyPromptButton prompt={task.claude_prompt} variant="inline" />
        </div>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------

function shortenId(id: string): string {
  const m = /_(\d+)$/.exec(id);
  return m ? `#${m[1]}` : id;
}

function TeamIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden>
      <circle cx="9" cy="7" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 21v-1a6 6 0 0112 0v1M14 21v-1a4 4 0 016 0" strokeLinecap="round" />
    </svg>
  );
}

export { STATUS_TOKENS };

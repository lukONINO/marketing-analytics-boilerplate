"use client";

/**
 * Copy Claude Prompt button.
 *
 * Every task on the dashboard ends with one of these. The user clicks,
 * the prompt copies to clipboard, they paste into Claude Code / Cowork
 * to actually do the work. This is the "two-class model" payoff —
 * tasks always come with a self-contained prompt, no context-gathering
 * required from the user.
 *
 * Two visual variants:
 *   - "inline"  — small chip suitable for kanban cards + dense rows
 *   - "block"   — full-width button suitable for drawers
 */

import clsx from "clsx";
import { useState } from "react";

export interface CopyPromptButtonProps {
  prompt: string;
  variant?: "inline" | "block";
  /** Optional short label override. Default "Copy Claude prompt". */
  label?: string;
}

export function CopyPromptButton({
  prompt,
  variant = "inline",
  label = "Copy Claude prompt",
}: CopyPromptButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handle(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard may be blocked (insecure context, permissions). Fall
      // back to a manual select-all by selecting the prompt's text — but
      // we don't render the prompt inline in the inline variant, so
      // the simplest fallback is just to leave the button briefly
      // saying "Failed". Realistic on localhost = clipboard works.
      setCopied(false);
    }
  }

  if (variant === "block") {
    return (
      <button
        type="button"
        onClick={handle}
        className={clsx(
          "w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors",
          copied
            ? "bg-success-50 text-success-600 ring-1 ring-inset ring-success/30"
            : "bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-200 hover:bg-primary-100",
        )}
      >
        {copied ? <CheckIcon /> : <ClipboardIcon />}
        {copied ? "Copied — paste into Claude" : label}
      </button>
    );
  }

  // inline (default)
  return (
    <button
      type="button"
      onClick={handle}
      className={clsx(
        "inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-md ring-1 ring-inset transition-colors shrink-0",
        copied
          ? "bg-success-50 text-success-600 ring-success/30"
          : "bg-surface text-ink-700 ring-hairline hover:bg-surface-muted hover:text-primary-700",
      )}
      aria-label={copied ? "Prompt copied" : label}
    >
      {copied ? <CheckIcon /> : <ClipboardIcon />}
      <span>{copied ? "Copied" : "Copy prompt"}</span>
    </button>
  );
}

function ClipboardIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

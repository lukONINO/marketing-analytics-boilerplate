"use client";

/**
 * Data-refresh guide — page-level "how to update this data" banner.
 *
 * Sits at the top of pages whose data comes from multiple sources (some
 * dashboard-driven, some Claude-driven), so users don't have to remember
 * which action updates which surface.
 *
 * Designed to be persistent guidance, NOT urgent. Different visual
 * weight from StalenessBanner — that one fires when something needs
 * attention; this one is reference material that's always there.
 *
 * UX rules:
 *   - Defaults to COLLAPSED so it doesn't dominate the page.
 *   - One-line summary visible when collapsed; expand to see actions.
 *   - Dismissed state persists per-page in localStorage so a user who
 *     learned the routine doesn't see it forever. Reset by clearing
 *     localStorage or with a "Show again" affordance (not built yet —
 *     deferred until anyone asks for it).
 */

import clsx from "clsx";
import { useEffect, useState } from "react";

// ---------------------------------------------------------------------
// Action shapes
// ---------------------------------------------------------------------

export type RefreshActionKind =
  /** Click something in the topbar — e.g. "Refresh data → Load latest only". */
  | "topbar"
  /** Copy a Claude prompt the user pastes into a Claude session. */
  | "claude"
  /** Run a terminal command. */
  | "terminal";

export interface RefreshAction {
  /** Headline of the action — what data this refreshes. */
  label: string;
  /** Single sentence describing the action. */
  description: string;
  /** Discriminator. */
  kind: RefreshActionKind;
  /** Prompt to copy (kind === "claude") or terminal command (kind === "terminal"). */
  prompt?: string;
  /** Topbar nav hint (kind === "topbar"). */
  topbar_path?: string;
}

export interface DataRefreshGuideProps {
  /** Storage key segment — used to persist the dismissed/expanded state. */
  pageKey: string;
  /** One-sentence intro shown next to the icon when collapsed. */
  summary: string;
  /** Per-source actions. Order matters — most common refresh first. */
  actions: RefreshAction[];
}

const STORAGE_KEY_PREFIX = "acme:refresh-guide:";

// ---------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------

export function DataRefreshGuide({ pageKey, summary, actions }: DataRefreshGuideProps) {
  const storageKey = `${STORAGE_KEY_PREFIX}${pageKey}`;
  // Start CLOSED to avoid the page jumping on hydration. We'll
  // optionally expand based on stored preference after mount.
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Read persisted state once on mount. Two flags: dismissed (banner
  // hidden entirely) and expanded (open vs. collapsed). Default to
  // collapsed but visible.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === "dismissed") setDismissed(true);
      else if (raw === "expanded") setExpanded(true);
    } catch {
      // private mode / disabled storage — proceed with defaults
    }
    setHydrated(true);
  }, [storageKey]);

  function persist(state: "expanded" | "collapsed" | "dismissed") {
    try {
      if (state === "collapsed") localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, state);
    } catch {
      // ignore
    }
  }

  function toggle() {
    setExpanded((v) => {
      const next = !v;
      persist(next ? "expanded" : "collapsed");
      return next;
    });
  }

  function dismiss() {
    setDismissed(true);
    persist("dismissed");
  }

  if (!hydrated || dismissed) return null;

  return (
    <section
      className="mb-6 rounded-2xl border border-primary-200/60 bg-primary-50/40 ring-1 ring-inset ring-primary-100"
      aria-label="How to update this data"
    >
      {/* Header — toggle and dismiss are sibling buttons inside a flex
          row. They CANNOT be nested (`<button>` inside `<button>` is
          invalid HTML and triggers a Next.js hydration error). The
          toggle takes the rest of the row via `flex-1` so the entire
          header still feels clickable. */}
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          className="flex-1 min-w-0 text-left flex items-center gap-3 px-4 py-2.5"
        >
          <InfoIcon />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-primary-700">
              How to update this page
            </div>
            {!expanded && (
              <div className="text-xs text-ink-600 mt-0.5 leading-snug truncate">
                {summary}
              </div>
            )}
          </div>
          <span
            className="text-[11px] font-medium text-primary-700 inline-flex items-center gap-1 shrink-0"
            aria-hidden
          >
            {expanded ? "Hide" : "Show actions"}
            <span className={clsx("transition-transform inline-block", expanded && "rotate-90")}>
              ›
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss this guide"
          className="px-3 text-ink-400 hover:text-ink-700 transition-colors shrink-0"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="px-4 pb-4 pt-1">
          <p className="text-xs text-ink-700 leading-relaxed mb-3">{summary}</p>
          <ul className="space-y-2">
            {actions.map((action) => (
              <ActionRow key={action.label} action={action} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// Action row
// ---------------------------------------------------------------------

function ActionRow({ action }: { action: RefreshAction }) {
  return (
    <li className="bg-surface border border-hairline rounded-xl px-3.5 py-2.5 flex items-start gap-3">
      <ActionKindBadge kind={action.kind} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-ink-900 leading-tight">
          {action.label}
        </div>
        <p className="text-[11px] text-ink-600 mt-0.5 leading-relaxed">
          {action.description}
        </p>
        {action.kind === "claude" && action.prompt && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <code className="font-mono text-[11px] bg-ink-900 text-white px-2 py-1 rounded select-all">
              {action.prompt}
            </code>
            <CopyButton text={action.prompt} />
          </div>
        )}
        {action.kind === "terminal" && action.prompt && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <code className="font-mono text-[11px] bg-ink-900 text-white px-2 py-1 rounded select-all">
              $ {action.prompt}
            </code>
            <CopyButton text={action.prompt} />
          </div>
        )}
      </div>
    </li>
  );
}

function ActionKindBadge({ kind }: { kind: RefreshActionKind }) {
  const styles: Record<RefreshActionKind, { label: string; cls: string }> = {
    topbar:   { label: "Topbar",   cls: "bg-primary-50 text-primary-700 ring-primary-200" },
    claude:   { label: "Claude",   cls: "bg-accent-50 text-accent-700 ring-accent-200" },
    terminal: { label: "Terminal", cls: "bg-surface-muted text-ink-700 ring-hairline" },
  };
  const s = styles[kind];
  return (
    <span
      className={clsx(
        "shrink-0 mt-0.5 inline-flex items-center text-[10px] uppercase tracking-[0.12em] font-semibold px-1.5 py-0.5 rounded ring-1 ring-inset",
        s.cls,
      )}
    >
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------------
// Copy button — local; doesn't share with StalenessBanner's copy
// because the visual style differs (smaller, inline).
// ---------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: select-all on the code block lets the user
      // ⌘-C manually.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={clsx(
        "inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-md ring-1 ring-inset transition-colors",
        copied
          ? "bg-success-50 text-success-600 ring-success/30"
          : "bg-surface text-ink-700 ring-hairline hover:bg-surface-muted",
      )}
    >
      {copied ? <CheckIcon /> : <ClipboardIcon />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ---------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------

function InfoIcon() {
  return (
    <svg
      className="w-4 h-4 text-primary-700 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M12 8h.01M11 12h1v5h1" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function CopyIcon() { return <ClipboardIcon />; }
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

// suppress "unused" lint on CopyIcon if compiler complains
void CopyIcon;

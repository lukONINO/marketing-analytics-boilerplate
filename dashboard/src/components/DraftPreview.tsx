"use client";

import clsx from "clsx";
import { useState } from "react";

import type { DraftStatus, PageDraft } from "@/lib/drafts";

const STATUS_STYLES: Record<DraftStatus, string> = {
  draft:     "bg-surface-muted text-ink-700",
  review:    "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-100",
  ready:     "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100",
  published: "bg-surface-muted text-ink-400",
};

/**
 * Single draft card — header collapsed, click to expand + read body.
 * Copy-to-clipboard on both the body (full markdown) and the
 * individual frontmatter fields so the user can paste into their CMS.
 */
export function DraftPreview({ draft }: { draft: PageDraft }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<null | "body" | "slug" | "meta">(null);

  async function copy(what: "body" | "slug" | "meta", text: string | null) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <article
      className={clsx(
        "bg-white border border-hairline rounded-xl overflow-hidden transition-all",
        draft.status === "published" && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-5 py-4 hover:bg-surface-muted transition-colors"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-[11px] text-ink-500 mb-1">
              <span className={clsx("px-1.5 py-0.5 rounded font-medium", STATUS_STYLES[draft.status])}>
                {draft.status}
              </span>
              {draft.target_language && <span>· {draft.target_language}</span>}
              {draft.source_task && <span>· from {draft.source_task}</span>}
              <span className="ml-auto tabular-nums text-ink-400">
                {draft.word_count} words
              </span>
            </div>
            <h3 className="font-semibold text-ink-900 text-[15px] leading-snug">
              {draft.title ?? "(untitled draft)"}
            </h3>
            {draft.slug && (
              <div className="text-xs text-ink-500 font-mono mt-1">{draft.slug}</div>
            )}
            {draft.meta_description && (
              <p className="text-sm text-ink-600 mt-2 line-clamp-2">{draft.meta_description}</p>
            )}
            {draft.schema_suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {draft.schema_suggestions.map((s) => (
                  <span key={s} className="text-[10px] px-1.5 py-0.5 rounded-md bg-surface-muted text-ink-600 ring-1 ring-inset ring-hairline-subtle">
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>
          <svg
            className={clsx("w-4 h-4 text-ink-400 mt-1 shrink-0 transition-transform", expanded && "rotate-90")}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-hairline px-5 py-4 space-y-4">
          {/* Copy chips */}
          <div className="flex flex-wrap gap-2 text-xs">
            {draft.slug && (
              <CopyChip
                label={copied === "slug" ? "Copied slug" : "Copy slug"}
                onClick={() => copy("slug", draft.slug)}
              />
            )}
            {draft.meta_description && (
              <CopyChip
                label={copied === "meta" ? "Copied meta" : "Copy meta description"}
                onClick={() => copy("meta", draft.meta_description)}
              />
            )}
            <CopyChip
              label={copied === "body" ? "Copied body" : "Copy markdown body"}
              onClick={() => copy("body", draft.body)}
              accent
            />
          </div>

          {/* Body preview — rendered as plain markdown text (no HTML) so
              the user always sees what they'll paste. */}
          <pre className="bg-surface-muted border border-hairline rounded-lg p-4 text-[12px] leading-relaxed whitespace-pre-wrap font-mono max-h-96 overflow-y-auto">
            {draft.body}
          </pre>

          {draft.id && (
            <div className="text-[11px] text-ink-400 font-mono">
              id: {draft.id} · file: data/drafts/pages/{draft.filename}.md
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function CopyChip({
  label,
  onClick,
  accent = false,
}: {
  label: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full transition-colors text-xs font-medium",
        accent
          ? "bg-primary-600 text-white hover:bg-primary-700 shadow-card"
          : "bg-surface border border-hairline text-ink-700 hover:border-primary-400 hover:text-primary-700 hover:bg-surface-muted hover:shadow-card",
      )}
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden>
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15V5a2 2 0 012-2h10" strokeLinecap="round" />
      </svg>
      {label}
    </button>
  );
}

"use client";

import clsx from "clsx";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { ScrapeState } from "@/lib/scrape";

const POLL_INTERVAL_MS = 2_000;

export function ScrapeTrigger({ initialState }: { initialState: ScrapeState }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [state, setState] = useState<ScrapeState>(initialState);
  const [error, setError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const isRunning = state.status === "running";

  // Poll while running; refresh Server Components on completion so
  // the inventory + last-scraped-at come through fresh.
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/scrape", { cache: "no-store" });
        const next = (await res.json()) as ScrapeState;
        setState(next);
        if (next.status !== "running") {
          clearInterval(id);
          startTransition(() => router.refresh());
        }
      } catch (err) {
        console.error("scrape poll error", err);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isRunning, router]);

  // Auto-scroll log to bottom as new lines arrive.
  useEffect(() => {
    if (showLog && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [state.log_tail, showLog]);

  async function trigger(mode: "full" | "retry-shells" = "full") {
    setError(null);
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok && res.status !== 202) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      const fresh = (await res.json()) as ScrapeState;
      setState(fresh);
      // Note: we intentionally do NOT auto-expand the log panel here.
      // The "Show log" toggle appears in the toolbar as soon as the
      // first log line lands; users who want the live tail can open
      // it themselves. Keeps the Settings page quiet by default.
    } catch (err) {
      setError(String(err));
    }
  }

  const lastRunLabel =
    state.completed_at
      ? formatAgo(state.completed_at)
      : state.started_at
      ? `started ${formatAgo(state.started_at)}`
      : "never";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => trigger("full")}
          disabled={isRunning}
          className={clsx(
            "inline-flex items-center gap-2 px-5 py-2 text-sm rounded-full transition-all font-medium",
            isRunning
              ? "bg-accent-600 text-white cursor-wait shadow-card"
              : "bg-primary-600 text-white hover:bg-primary-700 shadow-card",
          )}
        >
          {isRunning ? (
            <>
              <Spinner /> Running content pipeline…
            </>
          ) : (
            <>
              <RefreshIcon /> Run content pipeline
            </>
          )}
        </button>

        <button
          type="button"
          onClick={() => trigger("retry-shells")}
          disabled={isRunning}
          title="Re-scrape only URLs whose last record looks like the CDN shell response (word_count=0 and generic title). Much faster than a full run when you see thin-page ghosts."
          className={clsx(
            "inline-flex items-center gap-2 px-4 py-2 text-xs rounded-full transition-all font-medium",
            "bg-surface border border-hairline text-ink-700 hover:bg-surface-muted hover:border-primary-400 hover:text-primary-700 hover:shadow-card",
            isRunning && "opacity-50 cursor-not-allowed",
          )}
        >
          Retry shell pages only
        </button>

        <div className="flex items-center gap-2 text-xs text-ink-500">
          <StatusDot status={state.status} />
          <span>
            Last run: <strong className="text-ink-700">{lastRunLabel}</strong>
            {state.ok_count !== null && (
              <>
                {" · "}
                <span className="tabular-nums text-ink-700">{state.ok_count}</span> ok
                {state.error_count ? <> · <span className="text-danger-600 tabular-nums">{state.error_count}</span> failed</> : null}
              </>
            )}
          </span>
          {state.log_tail.length > 0 && (
            <button
              type="button"
              onClick={() => setShowLog((v) => !v)}
              className="underline decoration-dotted underline-offset-2 hover:text-ink-900"
            >
              {showLog ? "Hide log" : "Show log"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="text-xs text-danger-600 bg-danger-50 border border-danger/25 rounded px-3 py-2">
          {error}
        </div>
      )}

      {showLog && state.log_tail.length > 0 && (
        <pre className="bg-primary-950 text-primary-100 rounded-xl p-4 text-[11px] font-mono max-h-72 overflow-y-auto leading-relaxed whitespace-pre-wrap border border-primary-900 shadow-inset">
          {state.log_tail.join("\n")}
          <div ref={logEndRef} />
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------

function StatusDot({ status }: { status: ScrapeState["status"] }) {
  const cls = {
    idle: "bg-ink-400",
    running: "bg-accent-500 animate-pulse ring-2 ring-accent-500/25",
    success: "bg-success-500",
    failed: "bg-danger-500",
  }[status];
  return <span className={clsx("w-2 h-2 rounded-full inline-block", cls)} />;
}

function Spinner() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0 1 14.9-2M20 15a8 8 0 0 1-14.9 2" />
    </svg>
  );
}

function formatAgo(isoTime: string): string {
  const then = new Date(isoTime).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

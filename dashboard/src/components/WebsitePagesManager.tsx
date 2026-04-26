"use client";

/**
 * Flat table of every scraped URL, with per-row cluster + language
 * overrides. Lives at /settings/website-pages.
 *
 * Data flow:
 *   - Server fetches base assignments from page_clusters.json + applies
 *     cluster overrides from cluster_overrides.json, passes the merged
 *     list in.
 *   - This component owns: search query, cluster filter, lang filter,
 *     confidence filter, optimistic mutation state (so moves flip
 *     instantly), and the move-menu popover per-row.
 *   - Mutations hit /api/page-overrides PATCH. After each write,
 *     router.refresh() pulls the latest effective state.
 *
 * Why not reuse the ClusterDetailDrawer table: that table is
 * cluster-scoped (pages in one cluster). This view is the inverse —
 * all pages at once, filterable by cluster. Different mental model,
 * different default sort (URL alpha, not word count desc), different
 * toolbar (lang filter + confidence filter matter here but not in
 * the drawer).
 */

import clsx from "clsx";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { findTranslationPair } from "@/lib/pair-detection";
import type {
  CustomCluster,
  PageClusterAssignment,
  TopicCluster,
} from "@/lib/types";

interface ClusterOption {
  slug: string;
  label: string;
  isCustom: boolean;
}

export interface WebsitePagesManagerProps {
  assignments: PageClusterAssignment[];
  configClusters: TopicCluster[];
  customClusters: CustomCluster[];
  overrideCount: number;
}

export function WebsitePagesManager({
  assignments,
  configClusters,
  customClusters,
  overrideCount,
}: WebsitePagesManagerProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [clusterFilter, setClusterFilter] = useState<string>("all");
  const [langFilter, setLangFilter] = useState<"all" | "en" | "de">("all");
  const [confFilter, setConfFilter] = useState<string>("all");
  const [moveMenuFor, setMoveMenuFor] = useState<string | null>(null);
  const [savingFor, setSavingFor] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    kind: "ok" | "error";
    message: string;
  } | null>(null);

  // Cluster options for dropdowns — custom first, then config, alpha.
  // Display uses EN names for lang-agnostic browsing.
  const clusterOptions = useMemo<ClusterOption[]>(() => {
    const custom = customClusters.map((c) => ({
      slug: c.slug,
      label: c.names.en || c.slug,
      isCustom: true,
    }));
    const config = configClusters.map((c) => ({
      slug: c.slug,
      label: c.names.en || c.slug,
      isCustom: false,
    }));
    return [...custom, ...config].sort((a, b) => {
      if (a.isCustom !== b.isCustom) return a.isCustom ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  }, [configClusters, customClusters]);

  // Lookup for labels when rendering.
  const clusterLabelBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clusterOptions) m.set(c.slug, c.label);
    return m;
  }, [clusterOptions]);

  // Coverage summary: page count per (cluster, lang). Surfaces the
  // EN/DE split so the user can spot DE holes at a glance.
  const coverage = useMemo(() => {
    const m = new Map<string, { en: number; de: number }>();
    for (const a of assignments) {
      const row = m.get(a.cluster) ?? { en: 0, de: 0 };
      row[a.lang] += 1;
      m.set(a.cluster, row);
    }
    return m;
  }, [assignments]);

  // Apply filters + search.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assignments.filter((a) => {
      if (clusterFilter !== "all" && a.cluster !== clusterFilter) return false;
      if (langFilter !== "all" && a.lang !== langFilter) return false;
      if (confFilter !== "all" && a.confidence !== confFilter) return false;
      if (q) {
        const hay = [a.url, a.title, a.cluster].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [assignments, query, clusterFilter, langFilter, confFilter]);

  async function handleMove(page: PageClusterAssignment, newCluster: string) {
    if (newCluster === page.cluster) {
      setMoveMenuFor(null);
      return;
    }
    setSavingFor(page.url);
    setMoveMenuFor(null);

    // Pair detection: hreflang first (explicit), fuzzy-title fallback.
    let pairUrl: string | null = page.translation_pair_url ?? null;
    if (!pairUrl) {
      const fuzzy = findTranslationPair(page, assignments, 50);
      if (fuzzy) pairUrl = fuzzy.url;
    }

    try {
      const res = await fetch("/api/page-overrides", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: page.url, cluster: newCluster, pairUrl }),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setToast({
          kind: "error",
          message: error ?? `move failed (HTTP ${res.status})`,
        });
        return;
      }
      const label = clusterLabelBySlug.get(newCluster) ?? newCluster;
      setToast({
        kind: "ok",
        message: pairUrl
          ? `Moved to “${label}” (translated pair moved too)`
          : `Moved to “${label}” (no translation pair found)`,
      });
      startTransition(() => router.refresh());
    } catch (e) {
      setToast({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSavingFor(null);
    }
  }

  async function handleClearOverride(page: PageClusterAssignment) {
    setSavingFor(page.url);
    try {
      await fetch("/api/page-overrides", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: page.url, cluster: null }),
      });
      setToast({
        kind: "ok",
        message: "Override cleared — page falls back to Python-assigned cluster",
      });
      startTransition(() => router.refresh());
    } catch (e) {
      setToast({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSavingFor(null);
    }
  }

  return (
    <>
      {/* Coverage strip — 1 row per cluster, EN + DE counts. Spot DE
          holes without scrolling the page table. */}
      <section className="bg-white border border-hairline rounded-xl mb-6 overflow-hidden">
        <div className="px-4 md:px-5 py-3 border-b border-hairline bg-surface-muted/60 flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-ink-900">
            EN / DE coverage per cluster
          </h2>
          <span className="text-[11px] text-ink-500 tabular-nums">
            {overrideCount} manual override{overrideCount === 1 ? "" : "s"} active
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-surface-muted">
          {clusterOptions.map((c) => {
            const cov = coverage.get(c.slug) ?? { en: 0, de: 0 };
            return (
              <div key={c.slug} className="bg-white px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-ink-900 truncate">
                    {c.label}
                  </span>
                  {c.isCustom && (
                    <span className="text-[10px] uppercase tracking-wider text-ink-400">
                      custom
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-xs tabular-nums">
                  <span
                    className={clsx(
                      "inline-flex items-center gap-1",
                      cov.en === 0 ? "text-ink-400" : "text-ink-700",
                    )}
                  >
                    <span className="uppercase tracking-wider text-[10px] text-ink-500">
                      EN
                    </span>
                    <span className="font-semibold">{cov.en}</span>
                  </span>
                  <span
                    className={clsx(
                      "inline-flex items-center gap-1",
                      cov.de === 0 ? "text-ink-400" : "text-ink-700",
                    )}
                  >
                    <span className="uppercase tracking-wider text-[10px] text-ink-500">
                      DE
                    </span>
                    <span className="font-semibold">{cov.de}</span>
                  </span>
                  {cov.en > 0 && cov.de === 0 && (
                    <span className="ml-auto text-[10px] text-amber-700">DE gap</span>
                  )}
                  {cov.de > 0 && cov.en === 0 && (
                    <span className="ml-auto text-[10px] text-amber-700">EN gap</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Toast banner */}
      {toast && (
        <div
          className={clsx(
            "mb-4 px-3 py-2 text-xs rounded-md border flex items-start justify-between gap-2",
            toast.kind === "ok"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800",
          )}
        >
          <span className="leading-relaxed">{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="shrink-0 text-ink-500 hover:text-ink-900"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Filters */}
      <section className="bg-white border border-hairline rounded-xl overflow-hidden">
        <div className="px-4 md:px-5 py-3 border-b border-hairline flex flex-wrap items-center gap-2 md:gap-3 text-xs">
          <div className="relative flex-1 min-w-[180px]">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <circle cx="11" cy="11" r="7" />
              <path strokeLinecap="round" d="M21 21l-4.3-4.3" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search URL or title…"
              className="w-full pl-8 pr-2 py-1.5 text-xs bg-white border border-hairline rounded-md focus:outline-none focus:ring-1 focus:ring-primary-600/25 focus:border-primary-400"
            />
          </div>

          <select
            value={clusterFilter}
            onChange={(e) => setClusterFilter(e.target.value)}
            className="text-xs px-2 py-1.5 border border-hairline rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-primary-600/25 focus:border-primary-400"
          >
            <option value="all">All clusters</option>
            {clusterOptions.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1 bg-white border border-hairline rounded-md p-0.5">
            <FilterPill
              label="All"
              active={langFilter === "all"}
              onClick={() => setLangFilter("all")}
            />
            <FilterPill
              label="EN"
              active={langFilter === "en"}
              onClick={() => setLangFilter("en")}
            />
            <FilterPill
              label="DE"
              active={langFilter === "de"}
              onClick={() => setLangFilter("de")}
            />
          </div>

          <select
            value={confFilter}
            onChange={(e) => setConfFilter(e.target.value)}
            className="text-xs px-2 py-1.5 border border-hairline rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-primary-600/25 focus:border-primary-400"
            title="Assignment confidence from scripts/assign_clusters.py"
          >
            <option value="all">Any confidence</option>
            <option value="url_pattern">URL pattern</option>
            <option value="url_pattern_cross_lang">URL cross-lang</option>
            <option value="body_keyword">Body keyword</option>
            <option value="default">Defaulted</option>
          </select>

          <span className="ml-auto text-[11px] text-ink-500 tabular-nums">
            {filtered.length} of {assignments.length}
          </span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="text-left px-3 md:px-5 py-2 font-medium">Page</th>
                <th className="text-left px-3 py-2 font-medium">Cluster</th>
                <th className="text-center px-3 py-2 font-medium">Lang</th>
                <th className="text-right px-3 py-2 font-medium">Words</th>
                <th className="text-center px-3 py-2 font-medium">Confidence</th>
                <th className="text-right px-3 md:px-5 py-2 font-medium w-32">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-10 text-center text-sm text-ink-500"
                  >
                    No pages match the current filters.
                  </td>
                </tr>
              ) : (
                filtered.map((page) => {
                  const clusterLabel =
                    clusterLabelBySlug.get(page.cluster) ?? page.cluster;
                  const isSaving = savingFor === page.url;
                  return (
                    <tr key={page.url} className="hover:bg-surface-muted/60">
                      <td className="px-3 md:px-5 py-2 min-w-0">
                        <a
                          href={page.url}
                          target="_blank"
                          rel="noreferrer"
                          title={page.title ?? page.url}
                          className="block truncate max-w-[14rem] md:max-w-[24rem] text-ink-900 font-medium hover:underline"
                        >
                          {page.title ?? shortPath(page.url)}
                        </a>
                        <span className="block truncate max-w-[14rem] md:max-w-[24rem] text-[11px] text-ink-400">
                          {shortPath(page.url)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-block text-xs px-2 py-0.5 rounded bg-surface-muted text-ink-700">
                          {clusterLabel}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className="text-[11px] uppercase tracking-wider text-ink-500">
                          {page.lang}
                        </span>
                      </td>
                      <td
                        className={clsx(
                          "px-3 py-2 text-right tabular-nums",
                          (page.word_count ?? 0) === 0 && "text-ink-400",
                          (page.word_count ?? 0) > 0 &&
                            (page.word_count ?? 0) < 500 &&
                            "text-amber-700",
                        )}
                      >
                        {(page.word_count ?? 0).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <ConfidenceChip confidence={page.confidence} />
                      </td>
                      <td className="px-3 md:px-5 py-2 text-right">
                        <MoveMenu
                          current={page.cluster}
                          options={clusterOptions}
                          open={moveMenuFor === page.url}
                          onToggle={() =>
                            setMoveMenuFor((cur) =>
                              cur === page.url ? null : page.url,
                            )
                          }
                          onClose={() => setMoveMenuFor(null)}
                          onSelect={(slug) => handleMove(page, slug)}
                          onClear={
                            page.confidence === "default" &&
                            assignments.find((a) => a.url === page.url)
                              ? undefined
                              : () => handleClearOverride(page)
                          }
                          busy={isSaving}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "px-2.5 py-1 text-xs rounded transition-colors",
        active ? "bg-primary-600 text-white shadow-card" : "text-ink-600 hover:bg-surface-muted",
      )}
    >
      {label}
    </button>
  );
}

function ConfidenceChip({
  confidence,
}: {
  confidence: PageClusterAssignment["confidence"];
}) {
  const style: Record<PageClusterAssignment["confidence"], string> = {
    url_pattern: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    url_pattern_cross_lang: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    body_keyword: "bg-blue-50 text-blue-700 ring-blue-100",
    default: "bg-amber-50 text-amber-700 ring-amber-100",
  };
  const label: Record<PageClusterAssignment["confidence"], string> = {
    url_pattern: "URL",
    url_pattern_cross_lang: "URL ×",
    body_keyword: "body",
    default: "defaulted",
  };
  return (
    <span
      className={clsx(
        "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ring-1 ring-inset",
        style[confidence],
      )}
    >
      {label[confidence]}
    </span>
  );
}

function MoveMenu({
  current,
  options,
  open,
  onToggle,
  onClose,
  onSelect,
  onClear,
  busy,
}: {
  current: string;
  options: ClusterOption[];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (slug: string) => void;
  onClear?: () => void;
  busy: boolean;
}) {
  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        className={clsx(
          "text-[11px] px-2 py-1 rounded transition-colors",
          "text-ink-600 hover:text-ink-900 hover:bg-surface-muted",
          busy && "opacity-50 cursor-not-allowed",
        )}
      >
        {busy ? "Saving…" : "Move ▾"}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden />
          <div
            role="menu"
            className="absolute right-0 mt-1 z-40 w-60 bg-white border border-hairline rounded-md shadow-lg py-1 max-h-96 overflow-y-auto"
          >
            {options.map((o) => {
              const active = o.slug === current;
              return (
                <button
                  key={o.slug}
                  type="button"
                  role="menuitem"
                  onClick={() => !active && onSelect(o.slug)}
                  disabled={active}
                  className={clsx(
                    "w-full text-left px-3 py-1.5 text-[12px] flex items-center justify-between gap-2",
                    active
                      ? "text-ink-400 cursor-default bg-surface-muted"
                      : "text-ink-900 hover:bg-surface-muted",
                  )}
                >
                  <span className="truncate">{o.label}</span>
                  <span className="text-[10px] text-ink-400 shrink-0">
                    {active ? "current" : o.isCustom ? "custom" : ""}
                  </span>
                </button>
              );
            })}
            {onClear && (
              <>
                <div className="border-t border-hairline my-1" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={onClear}
                  className="w-full text-left px-3 py-1.5 text-[12px] text-ink-600 hover:bg-surface-muted hover:text-red-700"
                >
                  Clear manual override
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function shortPath(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

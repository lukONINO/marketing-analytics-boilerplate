"use client";

/**
 * Cluster overview — the dedicated /topics/[slug] page.
 *
 * Two sections:
 *   1. Current members — pages currently in this cluster (optionally
 *      filtered by the EN/DE tab). Checkbox multi-select + bulk
 *      "Move selected elsewhere". Per-row pillar toggle.
 *   2. Add pages — every OTHER scraped page, searchable and filterable
 *      by current cluster. Checkbox multi-select + bulk "Assign N to
 *      this cluster" with optional "also move translation pairs".
 *
 * All mutations go through /api/page-overrides/bulk (the bulk endpoint
 * handles 1..500 URLs per request, pair-expansion on the server).
 * Single-URL actions reuse /api/page-overrides for clarity.
 *
 * Why two sections instead of a single mixed table: the mental model
 * the user asked for is "pages in this cluster" vs "pages I want to
 * pull in". Mixing them behind a filter would work but is noisier —
 * the dedicated sections surface the two actions cleanly.
 */

import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import type { PageClusterAssignment, PillarPagesFile } from "@/lib/types";

interface ClusterOption {
  slug: string;
  label: string;
  isCustom: boolean;
}

export interface ClusterOverviewManagerProps {
  slug: string;
  names: { en: string; de: string };
  isCustom: boolean;
  peecTopicIds: string[];
  allAssignments: PageClusterAssignment[];
  pillars: PillarPagesFile["pillars"];
  allClusters: ClusterOption[];
}

type LangTab = "en" | "de";

export function ClusterOverviewManager({
  slug,
  names,
  isCustom,
  peecTopicIds,
  allAssignments,
  pillars,
  allClusters,
}: ClusterOverviewManagerProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [lang, setLang] = useState<LangTab>("en");
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidateClusterFilter, setCandidateClusterFilter] = useState<string>("all");
  const [movePairs, setMovePairs] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);

  // Split assignments into "in this cluster" vs "elsewhere".
  const members = useMemo(
    () => allAssignments.filter((a) => a.cluster === slug && a.lang === lang),
    [allAssignments, slug, lang],
  );
  const candidates = useMemo(
    () => allAssignments.filter((a) => a.cluster !== slug && a.lang === lang),
    [allAssignments, slug, lang],
  );

  // Cluster lookup for "currently in" display on candidate rows.
  const clusterLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of allClusters) m.set(c.slug, c.label);
    return m;
  }, [allClusters]);

  // Filter + search candidates.
  const filteredCandidates = useMemo(() => {
    const q = candidateQuery.trim().toLowerCase();
    return candidates.filter((a) => {
      if (candidateClusterFilter !== "all" && a.cluster !== candidateClusterFilter)
        return false;
      if (q) {
        const hay = [a.url, a.title, a.cluster].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [candidates, candidateQuery, candidateClusterFilter]);

  const pillarUrl = pillars[`${slug}::${lang}`] ?? null;

  // Toggle helpers for multi-select state.
  function toggleInSet(set: Set<string>, key: string): Set<string> {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  }
  function selectAll(set: Set<string>, urls: string[], allSelected: boolean): Set<string> {
    if (allSelected) {
      const next = new Set(set);
      for (const u of urls) next.delete(u);
      return next;
    }
    const next = new Set(set);
    for (const u of urls) next.add(u);
    return next;
  }

  // ---- Bulk assign (candidates → this cluster) --------------------
  async function handleBulkAssign() {
    if (selectedCandidates.size === 0 || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/page-overrides/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls: Array.from(selectedCandidates),
          cluster: slug,
          includePairs: movePairs,
        }),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string };
        setToast({ kind: "error", message: error ?? `HTTP ${res.status}` });
        return;
      }
      const { updated } = (await res.json()) as {
        updated: { url: string; cluster: string }[];
      };
      setSelectedCandidates(new Set());
      setToast({
        kind: "ok",
        message:
          updated.length === 0
            ? "Nothing to change (pages already in this cluster)."
            : movePairs
              ? `Assigned ${updated.length} pages to this cluster (including translation pairs where detected).`
              : `Assigned ${updated.length} pages to this cluster.`,
      });
      startTransition(() => router.refresh());
    } catch (e) {
      setToast({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  // ---- Bulk move (members → somewhere else) ----------------------
  async function handleBulkMoveMembers(targetCluster: string) {
    if (selectedMembers.size === 0 || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/page-overrides/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls: Array.from(selectedMembers),
          cluster: targetCluster,
          includePairs: movePairs,
        }),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string };
        setToast({ kind: "error", message: error ?? `HTTP ${res.status}` });
        return;
      }
      const { updated } = (await res.json()) as {
        updated: { url: string }[];
      };
      const targetLabel = clusterLabel.get(targetCluster) ?? targetCluster;
      setSelectedMembers(new Set());
      setToast({
        kind: "ok",
        message: `Moved ${updated.length} pages to “${targetLabel}”.`,
      });
      startTransition(() => router.refresh());
    } catch (e) {
      setToast({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  // ---- Pillar toggle ---------------------------------------------
  async function handleSetPillar(url: string | null) {
    setBusy(true);
    try {
      await fetch("/api/pillar-pages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cluster: slug, lang, url }),
      });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  // ---- Delete custom cluster -------------------------------------
  async function handleDelete() {
    setBusy(true);
    try {
      const res = await fetch(`/api/clusters/${slug}`, { method: "DELETE" });
      if (!res.ok) {
        setToast({ kind: "error", message: `Delete failed (HTTP ${res.status})` });
        return;
      }
      router.push("/topics");
    } catch (e) {
      setToast({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Header */}
      <header className="mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl md:text-3xl font-semibold text-ink-900 tracking-tight">
                {names[lang]}
              </h1>
              {isCustom && (
                <span className="text-[10px] uppercase tracking-wider bg-surface-muted text-ink-700 px-2 py-0.5 rounded">
                  Custom
                </span>
              )}
            </div>
            <p className="text-sm text-ink-500 mt-1">
              <code className="text-ink-700 bg-surface-muted px-1.5 py-0.5 rounded text-[11px]">
                {slug}
              </code>
              {" · "}
              EN {allAssignments.filter((a) => a.cluster === slug && a.lang === "en").length} pages
              {" · "}
              DE {allAssignments.filter((a) => a.cluster === slug && a.lang === "de").length} pages
              {peecTopicIds.length > 0 && (
                <>
                  {" · "}
                  {peecTopicIds.length} Peec topic{peecTopicIds.length === 1 ? "" : "s"}
                </>
              )}
            </p>
          </div>
          {isCustom && (
            <button
              type="button"
              onClick={() => (deleteArmed ? handleDelete() : setDeleteArmed(true))}
              disabled={busy}
              onBlur={() => setDeleteArmed(false)}
              className={clsx(
                "text-xs px-3 py-1.5 rounded-md border transition-colors",
                deleteArmed
                  ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
                  : "border-hairline text-ink-600 hover:bg-surface-muted",
              )}
            >
              {deleteArmed ? "Click again to confirm" : "Delete cluster"}
            </button>
          )}
        </div>

        {/* Language tabs */}
        <div className="mt-5 inline-flex items-center gap-1 p-1 bg-white border border-hairline rounded-lg">
          <LangTabButton
            active={lang === "en"}
            label="English"
            count={allAssignments.filter((a) => a.cluster === slug && a.lang === "en").length}
            onClick={() => {
              setLang("en");
              setSelectedMembers(new Set());
              setSelectedCandidates(new Set());
            }}
          />
          <LangTabButton
            active={lang === "de"}
            label="Deutsch"
            count={allAssignments.filter((a) => a.cluster === slug && a.lang === "de").length}
            onClick={() => {
              setLang("de");
              setSelectedMembers(new Set());
              setSelectedCandidates(new Set());
            }}
          />
        </div>
      </header>

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

      {/* Section 1: Current members */}
      <section className="bg-white border border-hairline rounded-xl mb-8 overflow-hidden">
        <div className="px-4 md:px-5 py-3 border-b border-hairline flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-ink-900">
            Pages currently in this cluster{" "}
            <span className="text-ink-500 font-normal">({members.length})</span>
          </h2>
          {selectedMembers.size > 0 && (
            <MoveMembersDropdown
              selectedCount={selectedMembers.size}
              clusters={allClusters.filter((c) => c.slug !== slug)}
              onMove={(target) => handleBulkMoveMembers(target)}
              busy={busy}
            />
          )}
        </div>

        {members.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-ink-700 font-medium">
              No pages in this cluster yet ({lang.toUpperCase()}).
            </p>
            <p className="text-xs text-ink-500 mt-2 max-w-md mx-auto">
              Use the picker below to add pages from other clusters, or ask
              Claude: <code className="text-ink-700 bg-surface-muted px-1 py-0.5 rounded">assign blog pages matching X to cluster {slug}</code>.
            </p>
          </div>
        ) : (
          <PageTable
            pages={members}
            selected={selectedMembers}
            pillarUrl={pillarUrl}
            showCurrentCluster={false}
            clusterLabel={clusterLabel}
            onToggleRow={(url) => setSelectedMembers((s) => toggleInSet(s, url))}
            onToggleAll={(all) =>
              setSelectedMembers((s) =>
                selectAll(
                  s,
                  members.map((m) => m.url),
                  all,
                ),
              )
            }
            onSetPillar={handleSetPillar}
            busy={busy}
          />
        )}
      </section>

      {/* Section 2: Add pages from elsewhere */}
      <section className="bg-white border border-hairline rounded-xl overflow-hidden">
        <div className="px-4 md:px-5 py-3 border-b border-hairline">
          <h2 className="text-sm font-semibold text-ink-900">
            Add pages from elsewhere{" "}
            <span className="text-ink-500 font-normal">({candidates.length})</span>
          </h2>
          <p className="text-xs text-ink-500 mt-0.5">
            Every other scraped {lang.toUpperCase()} page. Pick the ones that belong here.
          </p>
        </div>

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
              value={candidateQuery}
              onChange={(e) => setCandidateQuery(e.target.value)}
              placeholder="Search URL or title…"
              className="w-full pl-8 pr-2 py-1.5 text-xs bg-white border border-hairline rounded-md focus:outline-none focus:ring-1 focus:ring-primary-600/25 focus:border-primary-400"
            />
          </div>
          <select
            value={candidateClusterFilter}
            onChange={(e) => setCandidateClusterFilter(e.target.value)}
            className="text-xs px-2 py-1.5 border border-hairline rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-primary-600/25 focus:border-primary-400"
          >
            <option value="all">All clusters</option>
            {allClusters
              .filter((c) => c.slug !== slug)
              .map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.label}
                </option>
              ))}
          </select>
          <span className="ml-auto text-[11px] text-ink-500 tabular-nums">
            {filteredCandidates.length} of {candidates.length}
          </span>
        </div>

        <PageTable
          pages={filteredCandidates}
          selected={selectedCandidates}
          pillarUrl={null}
          showCurrentCluster
          clusterLabel={clusterLabel}
          onToggleRow={(url) => setSelectedCandidates((s) => toggleInSet(s, url))}
          onToggleAll={(all) =>
            setSelectedCandidates((s) =>
              selectAll(
                s,
                filteredCandidates.map((m) => m.url),
                all,
              ),
            )
          }
          busy={busy}
        />

        {selectedCandidates.size > 0 && (
          <div className="px-4 md:px-5 py-3 border-t border-hairline bg-surface-muted flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-ink-700 cursor-pointer">
              <input
                type="checkbox"
                checked={movePairs}
                onChange={(e) => setMovePairs(e.target.checked)}
                className="w-3.5 h-3.5"
              />
              Also move translation pairs (via hreflang + fuzzy title match)
            </label>
            <button
              type="button"
              onClick={handleBulkAssign}
              disabled={busy}
              className={clsx(
                "ml-auto text-xs px-3 py-1.5 rounded-md transition-colors",
                busy
                  ? "bg-surface-muted text-ink-400 cursor-not-allowed"
                  : "bg-primary-600 text-white shadow-card hover:bg-primary-800",
              )}
            >
              {busy
                ? "Saving…"
                : `Assign ${selectedCandidates.size} page${selectedCandidates.size === 1 ? "" : "s"} to this cluster`}
            </button>
          </div>
        )}
      </section>

      {/* Footer helper */}
      <p className="mt-6 text-xs text-ink-500 leading-relaxed">
        Overrides persist in{" "}
        <code className="text-ink-700 bg-surface-muted px-1 py-0.5 rounded text-[11px]">
          data/dashboard/cluster_overrides.json
        </code>
        . Python re-runs of <code className="text-ink-700">assign_clusters.py</code> won&apos;t
        revert them. Need Claude to do this in bulk? Ask:{" "}
        <code className="text-ink-700 bg-surface-muted px-1 py-0.5 rounded text-[11px]">
          assign all blog pages mentioning [your-keyword] to cluster {slug}
        </code>{" "}
        — see Settings → AI workflows for the full catalog.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------
// Table + helpers
// ---------------------------------------------------------------------

function PageTable({
  pages,
  selected,
  pillarUrl,
  showCurrentCluster,
  clusterLabel,
  onToggleRow,
  onToggleAll,
  onSetPillar,
  busy,
}: {
  pages: PageClusterAssignment[];
  selected: Set<string>;
  pillarUrl: string | null;
  showCurrentCluster: boolean;
  clusterLabel: Map<string, string>;
  onToggleRow: (url: string) => void;
  onToggleAll: (allSelected: boolean) => void;
  onSetPillar?: (url: string | null) => void;
  busy: boolean;
}) {
  const allSelected =
    pages.length > 0 && pages.every((p) => selected.has(p.url));
  const someSelected =
    pages.some((p) => selected.has(p.url)) && !allSelected;

  if (pages.length === 0) {
    return (
      <div className="px-5 py-10 text-center text-sm text-ink-500">
        No pages match the current filter.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted text-[11px] uppercase tracking-wider text-ink-500">
          <tr>
            <th className="w-10 px-3 md:px-5 py-2 text-left">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={() => onToggleAll(allSelected)}
                aria-label={allSelected ? "Deselect all" : "Select all"}
                className="w-3.5 h-3.5 cursor-pointer"
              />
            </th>
            <th className="text-left px-3 py-2 font-medium">Page</th>
            {showCurrentCluster && (
              <th className="text-left px-3 py-2 font-medium">Currently in</th>
            )}
            <th className="text-right px-3 py-2 font-medium">Words</th>
            {onSetPillar && (
              <th className="text-right px-3 md:px-5 py-2 font-medium w-24">Pillar</th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {pages.map((p) => {
            const isSelected = selected.has(p.url);
            const isPillar = pillarUrl === p.url;
            const wc = p.word_count ?? 0;
            return (
              <tr
                key={p.url}
                className={clsx(
                  "hover:bg-surface-muted/60",
                  isSelected && "bg-surface-muted",
                  isPillar && "bg-amber-50/60",
                )}
              >
                <td className="w-10 px-3 md:px-5 py-2">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleRow(p.url)}
                    aria-label={`Select ${p.title ?? p.url}`}
                    className="w-3.5 h-3.5 cursor-pointer"
                  />
                </td>
                <td className="px-3 py-2 min-w-0">
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    title={p.title ?? p.url}
                    className="block truncate max-w-[14rem] md:max-w-[26rem] text-ink-900 font-medium hover:underline"
                  >
                    {p.title ?? shortPath(p.url)}
                  </a>
                  <span className="block truncate max-w-[14rem] md:max-w-[26rem] text-[11px] text-ink-400">
                    {shortPath(p.url)}
                  </span>
                </td>
                {showCurrentCluster && (
                  <td className="px-3 py-2">
                    <span className="inline-block text-xs px-2 py-0.5 rounded bg-surface-muted text-ink-700">
                      {clusterLabel.get(p.cluster) ?? p.cluster}
                    </span>
                  </td>
                )}
                <td
                  className={clsx(
                    "px-3 py-2 text-right tabular-nums",
                    wc === 0 && "text-ink-400",
                    wc > 0 && wc < 500 && "text-amber-700",
                  )}
                >
                  {wc.toLocaleString()}
                </td>
                {onSetPillar && (
                  <td className="px-3 md:px-5 py-2 text-right">
                    {isPillar ? (
                      <button
                        type="button"
                        onClick={() => onSetPillar(null)}
                        disabled={busy}
                        title="Click to clear pillar"
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200 hover:bg-amber-200 transition-colors"
                      >
                        <svg
                          className="w-3 h-3"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          aria-hidden
                        >
                          <path d="M12 2l2.39 7.36h7.74l-6.26 4.55 2.39 7.36L12 16.72l-6.26 4.55 2.39-7.36L1.87 9.36h7.74z" />
                        </svg>
                        Pillar
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSetPillar(p.url)}
                        disabled={busy}
                        className="text-[11px] px-2 py-1 rounded text-ink-600 hover:text-ink-900 hover:bg-surface-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Set pillar
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MoveMembersDropdown({
  selectedCount,
  clusters,
  onMove,
  busy,
}: {
  selectedCount: number;
  clusters: ClusterOption[];
  onMove: (slug: string) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className={clsx(
          "text-xs px-3 py-1.5 rounded-md transition-colors",
          busy
            ? "bg-surface-muted text-ink-400 cursor-not-allowed"
            : "bg-primary-600 text-white shadow-card hover:bg-primary-800",
        )}
      >
        Move {selectedCount} {selectedCount === 1 ? "page" : "pages"} ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            className="absolute right-0 mt-1 z-40 w-60 bg-white border border-hairline rounded-md shadow-lg py-1 max-h-96 overflow-y-auto"
          >
            {clusters.map((c) => (
              <button
                key={c.slug}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onMove(c.slug);
                }}
                className="w-full text-left px-3 py-1.5 text-[12px] flex items-center justify-between gap-2 text-ink-900 hover:bg-surface-muted"
              >
                <span className="truncate">{c.label}</span>
                {c.isCustom && (
                  <span className="text-[10px] text-ink-400 shrink-0">custom</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function LangTabButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors",
        active ? "bg-primary-600 text-white shadow-card" : "text-ink-600 hover:bg-surface-muted",
      )}
      aria-pressed={active}
    >
      <span>{label}</span>
      <span
        className={clsx(
          "text-[11px] tabular-nums",
          active ? "text-ink-400" : "text-ink-400",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function shortPath(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

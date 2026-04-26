"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";

import { InfoTooltip } from "@/components/InfoTooltip";

/**
 * Generic sortable + filterable table.
 *
 * - Columns declare how to render and (optionally) how to sort / search.
 * - Clicking a sortable header toggles asc/desc; numeric columns default
 *   to desc-on-first-click (most people want "biggest at top").
 * - Text filter matches case-insensitive substring across all column
 *   accessor values for the row.
 * - Page-size selector controls visible rows; a stepper below the table
 *   walks through subsequent pages. "All" shows everything and hides
 *   the stepper — use sparingly on very large datasets.
 * - Sort / filter / pageSize changes reset the active page to 0 so the
 *   user always lands on the first row of the new view.
 *
 * Styling is intentionally close to the prior inline tables so swapping
 * in DataTable doesn't change the page's visual rhythm.
 */

export interface Column<T> {
  /** Unique identifier for the column (used for sort state). */
  key: string;
  /** Header text. */
  label: string;
  /** Optional info-tooltip rendered next to the header label. */
  info?: React.ReactNode;
  /** Cell alignment. Defaults to "left". */
  align?: "left" | "right" | "center";
  /** Whether the column is sortable. Defaults to true. */
  sortable?: boolean;
  /** Render function for the cell contents. */
  render: (row: T) => React.ReactNode;
  /**
   * Value used for sorting and text search. Pass null to exclude from
   * search. If omitted for numeric columns, sort behavior will be best-
   * effort based on what render() returns — prefer an explicit accessor.
   */
  accessor?: (row: T) => string | number | null;
  /**
   * Direction on first click. If omitted: "desc" for numeric accessors
   * (so clicking e.g. "Clicks" lands biggest-first), "asc" for strings.
   */
  sortDirOnFirstClick?: "asc" | "desc";
  /** Exclude this column's values from the text-search match. */
  noSearch?: boolean;
  /** Extra className applied to the <td> for this column. */
  cellClassName?: string | ((row: T) => string);
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Default sort state. */
  defaultSort?: { key: string; dir: "asc" | "desc" };
  /** Initial visible row count. 'all' means show everything. Default 10. */
  defaultPageSize?: number | "all";
  /** Options in the page-size selector. Default: [10, 25, 50, 100, 'all']. */
  pageSizeOptions?: (number | "all")[];
  /** Whether to render the search input. Default true. */
  searchable?: boolean;
  /** Placeholder in the search input. */
  searchPlaceholder?: string;
  /** Message when there are zero rows after filtering. */
  emptyLabel?: string;
  /** Extra className for the outer wrapper. */
  className?: string;
  /**
   * Extra className applied to every body `<tr>`. Use this to enforce
   * uniform row-level layout — for example
   * `"h-12 [&>td]:whitespace-nowrap [&>td]:overflow-hidden"` to keep
   * every row exactly 48px tall regardless of which cells could wrap.
   * The arbitrary-variant pattern targets descendant `<td>`s without
   * needing a per-column className change.
   */
  rowClassName?: string;
  /**
   * If provided, each body row becomes clickable and invokes this
   * callback with the row data. Adds hover/cursor affordance. The
   * header row and sort-click on th stay unchanged (we stopPropagation
   * only on child elements that need it — e.g. anchor links inside
   * cells are unaffected).
   */
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  defaultSort,
  defaultPageSize = 10,
  pageSizeOptions = [10, 25, 50, 100, "all"],
  searchable = true,
  onRowClick,
  searchPlaceholder = "Filter rows…",
  emptyLabel = "No rows match the current filter.",
  className,
  rowClassName,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(
    defaultSort ?? null
  );
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState<number | "all">(defaultPageSize);
  const [pageIndex, setPageIndex] = useState(0);

  // Any change that alters the row order or the active slice should
  // send the user back to the first page — paging into a cleaned-up
  // view and landing on page 7 of 2 is disorienting.
  useEffect(() => {
    setPageIndex(0);
  }, [query, sort, pageSize, rows]);

  // --- Filter -------------------------------------------------------
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      columns.some((c) => {
        if (c.noSearch) return false;
        const v = c.accessor ? c.accessor(row) : null;
        if (v === null || v === undefined) return false;
        return String(v).toLowerCase().includes(q);
      })
    );
  }, [rows, columns, query]);

  // --- Sort ---------------------------------------------------------
  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col || !col.accessor) return filtered;
    const acc = col.accessor;
    const dir = sort.dir === "asc" ? 1 : -1;
    // Stable sort via decorate-sort-undecorate.
    const tagged = filtered.map((row, i) => ({ row, i, v: acc(row) }));
    tagged.sort((a, b) => {
      const av = a.v;
      const bv = b.v;
      // Nulls sort to the end regardless of direction.
      if (av === null || av === undefined) return bv === null ? 0 : 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });
    // Preserve original index for equal-compare stability.
    tagged.sort((a, b) => {
      if ((a.v ?? null) === (b.v ?? null)) return a.i - b.i;
      return 0;
    });
    return tagged.map((t) => t.row);
  }, [filtered, sort, columns]);

  // --- Page-size slice ---------------------------------------------
  const totalCount = rows.length;
  const filteredCount = sorted.length;
  const visibleCount = pageSize === "all" ? sorted.length : pageSize;
  // `pageCount` is 1 for "all", else ceil(filtered / pageSize). Clamp
  // the active page to the valid range in case `rows` shrank and the
  // effect reset hasn't flushed yet (belt-and-suspenders).
  const pageCount =
    pageSize === "all" || visibleCount === 0
      ? 1
      : Math.max(1, Math.ceil(filteredCount / visibleCount));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pageStart =
    pageSize === "all" ? 0 : safePageIndex * visibleCount;
  const pageEnd =
    pageSize === "all" ? sorted.length : pageStart + visibleCount;
  const visible = sorted.slice(pageStart, pageEnd);
  const showStepper = pageSize !== "all" && filteredCount > visibleCount;

  // --- Header click ------------------------------------------------
  function toggleSort(col: Column<T>) {
    if (col.sortable === false || !col.accessor) return;
    const firstDir =
      col.sortDirOnFirstClick ??
      (inferIsNumeric(col.accessor, rows) ? "desc" : "asc");
    setSort((prev) => {
      if (!prev || prev.key !== col.key) {
        return { key: col.key, dir: firstDir };
      }
      return { key: col.key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  }

  return (
    <div className={className}>
      {/* Toolbar: search · page-size · counts */}
      <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-hairline bg-surface-muted/30 text-xs">
        {searchable && (
          <div className="flex items-center gap-1.5">
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="px-2.5 py-1.5 border border-hairline rounded-lg text-xs w-56 focus:outline-none focus:ring-2 focus:ring-primary-600/25 focus:border-primary-400 bg-surface transition-all"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-ink-400 hover:text-ink-900 transition-colors"
                aria-label="Clear filter"
              >
                ✕
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <span className="text-ink-500">Show</span>
          <select
            value={String(pageSize)}
            onChange={(e) => {
              const v = e.target.value;
              setPageSize(v === "all" ? "all" : parseInt(v, 10));
            }}
            className="px-2 py-1 border border-hairline rounded-lg bg-surface text-xs focus:outline-none focus:ring-2 focus:ring-primary-600/25 focus:border-primary-400 transition-all"
          >
            {pageSizeOptions.map((opt) => (
              <option key={String(opt)} value={String(opt)}>
                {opt === "all" ? "All" : opt}
              </option>
            ))}
          </select>
          <span className="text-ink-500">rows</span>
        </div>

        <div className="ml-auto text-ink-500 tabular-nums">
          {pageSize === "all" ? (
            query.trim() ? (
              <>Showing <strong className="text-ink-900">{visible.length}</strong> of <strong className="text-ink-900">{filteredCount}</strong> filtered <span className="text-ink-400">({totalCount} total)</span></>
            ) : (
              <>Showing <strong className="text-ink-900">{visible.length}</strong> of <strong className="text-ink-900">{totalCount}</strong></>
            )
          ) : filteredCount === 0 ? (
            <>0 rows</>
          ) : (
            <>
              <strong className="text-ink-900">{pageStart + 1}</strong>
              <span className="text-ink-400">–</span>
              <strong className="text-ink-900">{Math.min(pageEnd, filteredCount)}</strong>
              <span className="text-ink-400"> of </span>
              <strong className="text-ink-900">{filteredCount}</strong>
              {query.trim() && <span className="text-ink-400"> ({totalCount} total)</span>}
            </>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted/60 text-[10px] uppercase tracking-[0.12em] text-ink-500 font-semibold">
            <tr>
              {columns.map((c) => {
                const isSorted = sort?.key === c.key;
                const isSortable = c.sortable !== false && !!c.accessor;
                const alignCls =
                  c.align === "right" ? "text-right"
                  : c.align === "center" ? "text-center"
                  : "text-left";
                return (
                  <th
                    key={c.key}
                    className={clsx(
                      "px-5 py-2.5 border-b border-hairline",
                      alignCls,
                      isSortable && "cursor-pointer select-none hover:bg-surface-muted",
                      isSorted && "text-ink-900"
                    )}
                    onClick={() => toggleSort(c)}
                    aria-sort={isSorted ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <span className="inline-flex items-center gap-1">
                      <span>{c.label}</span>
                      {c.info && <InfoTooltip content={c.info} label={`About ${c.label}`} />}
                      {isSortable && <SortIndicator dir={isSorted ? sort?.dir ?? null : null} />}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {visible.length > 0 ? (
              visible.map((row) => (
                <tr
                  key={rowKey(row)}
                  className={clsx(
                    "hover:bg-surface-muted/50 transition-colors",
                    onRowClick && "cursor-pointer",
                    rowClassName,
                  )}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((c) => {
                    const alignCls =
                      c.align === "right" ? "text-right"
                      : c.align === "center" ? "text-center"
                      : "text-left";
                    const extra =
                      typeof c.cellClassName === "function" ? c.cellClassName(row)
                      : c.cellClassName ?? "";
                    return (
                      <td key={c.key} className={clsx("px-5 py-2.5 text-ink-700", alignCls, extra)}>
                        {c.render(row)}
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="px-5 py-10 text-center text-ink-500">
                  {emptyLabel}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showStepper && (
        <Stepper
          pageIndex={safePageIndex}
          pageCount={pageCount}
          onChange={(i) => setPageIndex(i)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Stepper — classic prev / page-indicator / next.
// Renders a short window of page numbers on wider screens and falls
// back to a compact "Page X of Y" on narrow ones.
// ---------------------------------------------------------------------

function Stepper({
  pageIndex,
  pageCount,
  onChange,
}: {
  pageIndex: number;
  pageCount: number;
  onChange: (i: number) => void;
}) {
  const atStart = pageIndex <= 0;
  const atEnd = pageIndex >= pageCount - 1;

  // Page number list (1-indexed to the user). Show all when <= 7
  // pages; otherwise compress the middle with an ellipsis so the
  // row doesn't balloon for 50-page tables.
  const pageNums = useMemo(() => buildPageList(pageIndex, pageCount), [
    pageIndex,
    pageCount,
  ]);

  return (
    <div className="px-5 py-2.5 border-t border-hairline bg-surface-muted/30 flex items-center gap-2 flex-wrap text-xs">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, pageIndex - 1))}
        disabled={atStart}
        className={clsx(
          "inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors font-medium",
          atStart
            ? "text-ink-400 cursor-not-allowed"
            : "text-ink-700 hover:bg-surface hover:text-ink-900",
        )}
        aria-label="Previous page"
      >
        <span aria-hidden>‹</span>
        <span className="hidden sm:inline">Prev</span>
      </button>

      <span className="sm:hidden text-ink-700 tabular-nums">
        Page <strong className="text-ink-900">{pageIndex + 1}</strong> of {pageCount}
      </span>

      <ol className="hidden sm:flex items-center gap-0.5">
        {pageNums.map((p, i) =>
          p === "…" ? (
            <li key={`e-${i}`} className="px-1.5 text-ink-400">…</li>
          ) : (
            <li key={p}>
              <button
                type="button"
                onClick={() => onChange(p - 1)}
                aria-current={p - 1 === pageIndex ? "page" : undefined}
                className={clsx(
                  "min-w-[1.75rem] px-2 py-1 rounded-md tabular-nums transition-colors font-medium",
                  p - 1 === pageIndex
                    ? "bg-primary-600 text-white shadow-card"
                    : "text-ink-700 hover:bg-surface hover:text-ink-900",
                )}
              >
                {p}
              </button>
            </li>
          ),
        )}
      </ol>

      <button
        type="button"
        onClick={() => onChange(Math.min(pageCount - 1, pageIndex + 1))}
        disabled={atEnd}
        className={clsx(
          "ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors font-medium",
          atEnd
            ? "text-ink-400 cursor-not-allowed"
            : "text-ink-700 hover:bg-surface hover:text-ink-900",
        )}
        aria-label="Next page"
      >
        <span className="hidden sm:inline">Next</span>
        <span aria-hidden>›</span>
      </button>
    </div>
  );
}

/**
 * Build a compact page list with ellipses for long tables.
 * Examples (pageIndex zero-based, output one-based):
 *   (0, 5)  → [1, 2, 3, 4, 5]
 *   (0, 10) → [1, 2, 3, 4, 5, "…", 10]
 *   (5, 12) → [1, "…", 4, 5, 6, 7, "…", 12]
 *   (11, 12)→ [1, "…", 8, 9, 10, 11, 12]
 */
function buildPageList(pageIndex: number, pageCount: number): Array<number | "…"> {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const current = pageIndex + 1;
  const out: Array<number | "…"> = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(pageCount - 1, current + 1);
  if (left > 2) out.push("…");
  for (let p = left; p <= right; p++) out.push(p);
  if (right < pageCount - 1) out.push("…");
  out.push(pageCount);
  return out;
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/** Peek at up to 8 rows to decide if the accessor produces numbers. */
function inferIsNumeric<T>(
  acc: (row: T) => string | number | null,
  rows: T[]
): boolean {
  const sample = rows.slice(0, 8);
  for (const r of sample) {
    const v = acc(r);
    if (v === null || v === undefined) continue;
    return typeof v === "number";
  }
  return false;
}

function SortIndicator({ dir }: { dir: "asc" | "desc" | null }) {
  if (dir === "asc") {
    return <span className="text-ink-900" aria-hidden="true">▲</span>;
  }
  if (dir === "desc") {
    return <span className="text-ink-900" aria-hidden="true">▼</span>;
  }
  return <span className="text-ink-400 text-[10px]" aria-hidden="true">↕</span>;
}

function SearchIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-ink-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path strokeLinecap="round" d="M21 21l-4.3-4.3" />
    </svg>
  );
}

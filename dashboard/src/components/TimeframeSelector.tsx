"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import { useTimeframe } from "@/components/TimeframeContext";
import type { TimeWindow } from "@/lib/types";

interface Preset {
  value: TimeWindow;
  label: string;
}

const PRESETS: Preset[] = [
  { value: 7,   label: "Last 7 days"   },
  { value: 14,  label: "Last 14 days"  },
  { value: 30,  label: "Last 30 days"  },
  { value: 60,  label: "Last 60 days"  },
  { value: 90,  label: "Last 90 days"  },
  { value: 180, label: "Last 180 days" },
  { value: 365, label: "Last 365 days" },
];

/**
 * Dropdown-style timeframe selector in the topbar.
 *
 * Replaces the earlier 7/14/30 pill group. Click opens a menu with
 * seven preset ranges plus "All time" (= availableDays). Options that
 * exceed `availableDays` render disabled with an explanatory tooltip;
 * an "All time" entry at the bottom is always available and equals
 * the full on-disk range.
 *
 * Keyboard + screen-reader friendly: `role="menu"`, `role="menuitem"`,
 * Escape closes, click-outside closes.
 */
export function TimeframeSelector() {
  const { window, setWindow, availableDays, effectiveWindow } = useTimeframe();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on click-outside + Escape.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (
        menuRef.current?.contains(e.target as Node) ||
        buttonRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const currentLabel = labelForValue(window);
  const isClamped = window > availableDays && availableDays > 0;

  function pick(v: TimeWindow) {
    setWindow(v);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={clsx(
          "inline-flex items-center gap-2 px-3.5 py-1.5 text-xs rounded-full border transition-all",
          open
            ? "bg-surface border-primary-400 text-ink-900 shadow-card"
            : "bg-surface border-hairline text-ink-700 hover:border-hairline-strong hover:text-ink-900",
        )}
      >
        <CalendarIcon />
        <span className="font-medium tabular-nums">{currentLabel}</span>
        {isClamped && (
          <span className="text-warning text-[10px]" title={`Only ${availableDays} days of data available — effective window ${effectiveWindow}d.`}>
            (capped {availableDays}d)
          </span>
        )}
        <Chevron open={open} />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 top-full mt-2 bg-surface border border-hairline rounded-xl shadow-pop py-1.5 w-60 z-30"
        >
          <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-[0.14em] text-ink-500 font-semibold">
            Preset ranges
          </div>
          {PRESETS.map((opt) => {
            const active = window === opt.value;
            const disabled = availableDays > 0 && opt.value > availableDays;
            const tooltip = disabled
              ? `Only ${availableDays} day${availableDays === 1 ? "" : "s"} of data on disk — run Refresh → Backfill to extend.`
              : undefined;
            return (
              <MenuItem
                key={opt.value}
                active={active}
                disabled={disabled}
                onClick={() => !disabled && pick(opt.value)}
                title={tooltip}
              >
                {opt.label}
              </MenuItem>
            );
          })}
          {availableDays > 0 && (
            <>
              <div className="my-1 border-t border-hairline" />
              <MenuItem
                active={window === availableDays}
                onClick={() => pick(availableDays)}
              >
                All time ({availableDays} day{availableDays === 1 ? "" : "s"})
              </MenuItem>
            </>
          )}
          <div className="my-1 border-t border-hairline" />
          <MenuItem
            active={false}
            onClick={() => pick(30)}
          >
            <span className="text-ink-500">Reset to default (30d)</span>
          </MenuItem>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------

function MenuItem({
  active,
  disabled = false,
  onClick,
  title,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      role="menuitem"
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
      title={title}
      className={clsx(
        "w-full flex items-center justify-between gap-3 px-3 py-1.5 text-sm text-left rounded-md mx-1 transition-colors",
        disabled
          ? "text-ink-400 cursor-not-allowed"
          : active
          ? "bg-primary-600 text-white font-medium"
          : "text-ink-700 hover:bg-surface-muted hover:text-ink-900",
      )}
    >
      <span>{children}</span>
      {active && <CheckIcon />}
    </button>
  );
}

function labelForValue(n: number): string {
  const preset = PRESETS.find((p) => p.value === n);
  if (preset) return preset.label;
  return `Last ${n} days`;
}

function CalendarIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-primary-600" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v4M16 3v4" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={clsx("w-3 h-3 opacity-70 transition-transform", open && "rotate-180")}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

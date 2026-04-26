"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import type { TimeWindow } from "@/lib/types";

const STORAGE_KEY = "acme:timeframe";
/** Upper bound for a stored value — guard against corrupt localStorage. */
const MAX_WINDOW = 365;
const DEFAULT_WINDOW: TimeWindow = 30;

interface TimeframeValue {
  /** The user's selected window in days. */
  window: TimeWindow;
  /** How many daily aggregate files actually exist on disk. */
  availableDays: number;
  /**
   * The effective window used by rollups: `min(window, availableDays)`.
   * Selectors show a "capped at Xd" hint when this differs from `window`.
   */
  effectiveWindow: number;
  setWindow: (w: TimeWindow) => void;
}

const TimeframeCtx = createContext<TimeframeValue | null>(null);

export interface TimeframeProviderProps {
  children: React.ReactNode;
  /** Days of data on disk. Read server-side and threaded through. */
  availableDays: number;
}

/**
 * App-wide timeframe state.
 *
 * `window` is freeform days (7, 14, 30, 60, 90, 180, 365, or any
 * positive integer up to 365) so the dropdown can offer arbitrary
 * presets without changing the type. localStorage persists across
 * reloads; on first visit we auto-select the largest preset that fits
 * the available data so the default selection isn't silently capped.
 */
export function TimeframeProvider({ children, availableDays }: TimeframeProviderProps) {
  const [window, setWindowState] = useState<TimeWindow>(DEFAULT_WINDOW);

  useEffect(() => {
    let stored: TimeWindow | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n) && n > 0 && n <= MAX_WINDOW) {
          stored = n;
        }
      }
    } catch {
      // Private mode / disabled storage.
    }

    if (stored !== null) {
      // Respect the user's explicit choice even if data is now smaller
      // than it — the selector shows a "capped" badge in that case.
      setWindowState(stored);
    } else if (availableDays > 0) {
      // First visit: pick the largest preset that actually fits.
      const PRESET_DESC = [365, 180, 90, 60, 30, 14, 7];
      const best = PRESET_DESC.find((v) => v <= availableDays);
      if (best) setWindowState(best);
    }
  }, [availableDays]);

  const setWindow = (w: TimeWindow) => {
    if (!Number.isFinite(w) || w <= 0 || w > MAX_WINDOW) return;
    setWindowState(w);
    try {
      localStorage.setItem(STORAGE_KEY, String(w));
    } catch {
      // ignore
    }
  };

  const value = useMemo<TimeframeValue>(
    () => ({
      window,
      availableDays,
      effectiveWindow: Math.min(window, availableDays || window),
      setWindow,
    }),
    [window, availableDays],
  );

  return <TimeframeCtx.Provider value={value}>{children}</TimeframeCtx.Provider>;
}

/** Read the current timeframe state. Throws outside the provider. */
export function useTimeframe(): TimeframeValue {
  const ctx = useContext(TimeframeCtx);
  if (!ctx) {
    throw new Error("useTimeframe must be used inside <TimeframeProvider>");
  }
  return ctx;
}

"use client";

/**
 * Client wrapper around TrendChart that respects the global timeframe.
 *
 * The Overview page loads up to 30 days of trend points server-side
 * and hands the full array to this component. We slice to the
 * currently-selected window and remount the chart (via `key={window}`)
 * when it changes so Recharts' internal brush state resets cleanly
 * to valid indices for the new data length.
 */

import { useMemo } from "react";

import { TrendChart } from "@/components/TrendChart";
import { useTimeframe } from "@/components/TimeframeContext";
import type { TrendPoint } from "@/lib/types";

export function TrendChartSection({ data }: { data: TrendPoint[] }) {
  const { window } = useTimeframe();
  const visible = useMemo(() => data.slice(-window), [data, window]);

  // Remount the chart on window change so the Brush resets to a valid range.
  return <TrendChart key={window} data={visible} />;
}

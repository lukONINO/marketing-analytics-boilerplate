/**
 * Window-aware snapshot computation for metric cards.
 *
 * Given a chronological trend array + a metric key + a window size +
 * an aggregation mode, returns:
 *   - `current`   — sum (for counts) or avg (for scores) across the
 *                   last `windowDays` days
 *   - `prior`     — same aggregation across the immediately-preceding
 *                   equal window (window_days * 2 → window_days ago)
 *   - `delta_pct` — current vs prior, percent change
 *   - `direction_7d` — 7d-vs-prior-7d momentum, always computed on a
 *                     fixed 7-day comparison regardless of `windowDays`
 *
 * Pure / SSR-safe. Consumed inside the client `HistoricalMetricCard`
 * via useMemo keyed on `{trend, key, windowDays, aggregation}`.
 */

import type {
  AggregationMode,
  TrendPoint,
  WindowSnapshot,
} from "./types";

const FLAT_THRESHOLD = 0.05; // ±5%
// Minimum non-null days needed in EACH 7-day window before we'll
// emit a direction arrow. Below this, daily fluctuations are
// statistically meaningless and the arrow misleads more than it
// informs. Audit fix #20 (2026-04-26).
const MIN_DAYS_FOR_DIRECTION = 5;
// Minimum absolute value (in either window) below which we treat the
// metric as too small for a meaningful relative-change signal.
// Counter to the "+200%" trap when a metric goes from 0.3/day to
// 0.9/day — both are noise.
const MIN_ABSOLUTE_FOR_DIRECTION = 1;

type MetricKey = keyof Omit<TrendPoint, "date">;

/**
 * Extract a numeric series from a trend array for a given metric key.
 * Non-numeric entries (null / undefined) become `null` in the output
 * so downstream aggregation can skip them cleanly.
 */
function extractSeries(trend: TrendPoint[], key: MetricKey): (number | null)[] {
  return trend.map((p) => {
    const v = p[key];
    return typeof v === "number" ? v : null;
  });
}

function aggregate(values: (number | null)[], mode: AggregationMode): number | null {
  const nonNull = values.filter((v): v is number => v !== null);
  if (nonNull.length === 0) return null;
  const sum = nonNull.reduce((a, b) => a + b, 0);
  return mode === "sum" ? sum : sum / nonNull.length;
}

/**
 * Compute the window snapshot for one metric.
 */
export function computeWindowSnapshot(
  trend: TrendPoint[],
  key: MetricKey,
  windowDays: number,
  aggregation: AggregationMode,
): WindowSnapshot {
  const series = extractSeries(trend, key);

  // Current window (last N entries)
  const currentValues = series.slice(-windowDays);
  const current = aggregate(currentValues, aggregation);

  // Prior window (the N entries immediately before the current window)
  const priorValues = series.slice(-windowDays * 2, -windowDays);
  const prior = aggregate(priorValues, aggregation);

  // Delta current vs prior
  const delta_pct =
    current !== null && prior !== null && prior !== 0
      ? ((current - prior) / Math.abs(prior)) * 100
      : null;

  // Most recent non-null date in the current window — used for the
  // "as of X" chip when the last day's source was stale.
  let current_date: string | null = null;
  const startIdx = Math.max(0, trend.length - windowDays);
  for (let i = trend.length - 1; i >= startIdx; i--) {
    if (typeof trend[i][key] === "number") {
      current_date = trend[i].date;
      break;
    }
  }

  // 7d-vs-prior-7d direction: independent of windowDays, always a
  // last-7 vs previous-7 comparison on daily means. Gives a stable
  // "recent momentum" arrow regardless of what the user picked.
  //
  // Audit fix #20 (2026-04-26): suppress the arrow when either
  // window has fewer than MIN_DAYS_FOR_DIRECTION non-null days OR
  // both averages are below MIN_ABSOLUTE_FOR_DIRECTION — at low
  // volumes a single data point can flip up→down which misleads
  // more than informs. Returning null lets the UI render an explicit
  // "—" instead of a noisy arrow.
  const last7 = series.slice(-7).filter((v): v is number => v !== null);
  const prior7 = series.slice(-14, -7).filter((v): v is number => v !== null);
  let direction_7d: WindowSnapshot["direction_7d"] = null;
  if (
    last7.length >= MIN_DAYS_FOR_DIRECTION &&
    prior7.length >= MIN_DAYS_FOR_DIRECTION
  ) {
    const last7avg = last7.reduce((a, b) => a + b, 0) / last7.length;
    const prior7avg = prior7.reduce((a, b) => a + b, 0) / prior7.length;
    // Both windows below the absolute floor → no signal worth a direction.
    if (
      Math.max(last7avg, prior7avg) >= MIN_ABSOLUTE_FOR_DIRECTION
    ) {
      const rel = prior7avg !== 0 ? (last7avg - prior7avg) / Math.abs(prior7avg) : 0;
      if (Math.abs(rel) < FLAT_THRESHOLD) direction_7d = "flat";
      else direction_7d = rel > 0 ? "up" : "down";
    } else {
      direction_7d = "flat";
    }
  }

  const sample_size = currentValues.filter((v) => v !== null).length;
  const per_day_avg =
    aggregation === "sum" && current !== null && sample_size > 0
      ? current / sample_size
      : null;

  return {
    current,
    current_date,
    prior,
    delta_pct,
    direction_7d,
    sample_size,
    aggregation,
    window_days: windowDays,
    per_day_avg,
  };
}

/**
 * Score breakdown derivation.
 *
 * Replicates the Python compute_seo_score / compute_geo_score formulas
 * from scripts/aggregate_daily.py so the dashboard can show users
 * exactly which components contributed to the latest day's score and
 * how much. Audit fix #13 (B3) — keep the at-a-glance composite but
 * make it inspectable.
 *
 * Why we don't compute window-averaged breakdowns:
 *   The trend points only carry a few of the components (clicks,
 *   impressions, sessions) — not all (no per-day position, no
 *   per-day SoV). So the most we can show is the latest day's
 *   breakdown. The card's hero value is the windowed average, so
 *   we explicitly label the breakdown as "latest day" so the user
 *   knows the two won't match exactly.
 */

import type { DailyAggregate } from "./types";
import type { ScoreBreakdown } from "@/components/HistoricalMetricCard";

const SEO_CLICKS_CAP = 50;
const SEO_IMPRESSIONS_CAP = 2500;

export function computeSeoScoreBreakdown(
  daily: DailyAggregate | null,
): ScoreBreakdown | null {
  if (!daily?.summary?.seo?.available) return null;
  const seo = daily.summary.seo;

  const clicks = seo.total_clicks ?? 0;
  const impressions = seo.total_impressions ?? 0;
  const position = seo.avg_position; // may be null
  const indexing = seo.indexing_health; // 0-1 or null

  // Clamp each component (matches Python).
  const clicksClamped = Math.min(clicks / SEO_CLICKS_CAP, 1);
  const imprClamped = Math.min(impressions / SEO_IMPRESSIONS_CAP, 1);
  const posClamped =
    position == null ? 0.5 : Math.max(0, 1 - position / 20);
  const idxClamped = indexing == null ? 0.5 : indexing;

  // Contribution = clamp × weight × 100.
  const clicksContrib = clicksClamped * 0.4 * 100;
  const imprContrib = imprClamped * 0.3 * 100;
  const posContrib = posClamped * 0.2 * 100;
  const idxContrib = idxClamped * 0.1 * 100;

  return {
    components: [
      {
        label: "Clicks",
        raw_value: clicks.toLocaleString(),
        weight_pct: 40,
        contribution: clicksContrib,
        note: `Capped at ${SEO_CLICKS_CAP}/day`,
      },
      {
        label: "Impressions",
        raw_value: impressions.toLocaleString(),
        weight_pct: 30,
        contribution: imprContrib,
        note: `Capped at ${SEO_IMPRESSIONS_CAP.toLocaleString()}/day`,
      },
      {
        label: "Position",
        raw_value: position == null ? "—" : position.toFixed(1),
        weight_pct: 20,
        contribution: posContrib,
        note: position == null
          ? "Neutral fallback (no ranking data)"
          : "Lower position = higher score (1 → 0.95, 20 → 0)",
      },
      {
        label: "Indexing",
        raw_value: indexing == null ? "—" : `${(indexing * 100).toFixed(0)}%`,
        weight_pct: 10,
        contribution: idxContrib,
        note: indexing == null
          ? "Neutral fallback (no inspection data)"
          : "% of inspected URLs with verdict=PASS",
      },
    ],
    total: clicksContrib + imprContrib + posContrib + idxContrib,
    source_date: daily.date,
    caveat: "Latest day. The hero value above is the windowed average — these may differ.",
  };
}

export function computeGeoScoreBreakdown(
  daily: DailyAggregate | null,
): ScoreBreakdown | null {
  if (!daily?.summary?.geo?.available) return null;
  const geo = daily.summary.geo;

  const viz = geo.avg_visibility ?? 0;
  const sov = geo.avg_share_of_voice ?? 0;
  const sentiment = geo.avg_sentiment; // 0-100 or null
  const citations = geo.total_citations_window ?? 0;

  // Citations cap scales with the citations window length (Python
  // uses 166/day × window_days). Default 3-day window if unknown.
  let citationsWindowDays = 3;
  const cw = geo.citations_aggregation_window;
  if (cw && typeof cw === "object" && "start" in cw && "end" in cw) {
    try {
      const start = new Date(`${cw.start}T00:00:00Z`).getTime();
      const end = new Date(`${cw.end}T00:00:00Z`).getTime();
      const diffDays = Math.floor((end - start) / 86_400_000) + 1;
      if (diffDays > 0) citationsWindowDays = diffDays;
    } catch {
      /* keep default */
    }
  }
  const citationsCap = 166 * citationsWindowDays;

  const vizClamped = Math.min(viz, 1);
  const sovClamped = Math.min(sov * 2, 1);
  const sentClamped = sentiment == null ? 0.5 : sentiment / 100;
  const citClamped = Math.min(citations / citationsCap, 1);

  const vizContrib = vizClamped * 0.4 * 100;
  const sovContrib = sovClamped * 0.2 * 100;
  const sentContrib = sentClamped * 0.2 * 100;
  const citContrib = citClamped * 0.2 * 100;

  return {
    components: [
      {
        label: "Visibility",
        raw_value: `${(viz * 100).toFixed(0)}%`,
        weight_pct: 40,
        contribution: vizContrib,
        note: "Share of AI prompts that mention your brand (0–1)",
      },
      {
        label: "Share-of-voice",
        raw_value: `${(sov * 100).toFixed(1)}%`,
        weight_pct: 20,
        contribution: sovContrib,
        note: "Our share of brand mentions in our category (×2 then capped — typical SoV is 0–0.5)",
      },
      {
        label: "Sentiment",
        raw_value: sentiment == null ? "—" : `${sentiment.toFixed(0)}/100`,
        weight_pct: 20,
        contribution: sentContrib,
        note: sentiment == null
          ? "Neutral fallback (no sentiment data)"
          : "How positively AI describes us, 0–100",
      },
      {
        label: "Citations",
        raw_value: citations.toLocaleString(),
        weight_pct: 20,
        contribution: citContrib,
        note: `Capped at ${citationsCap} for a ${citationsWindowDays}-day citations window`,
      },
    ],
    total: vizContrib + sovContrib + sentContrib + citContrib,
    source_date: daily.date,
    caveat: "Latest day. The hero value above is the windowed average — these may differ.",
  };
}

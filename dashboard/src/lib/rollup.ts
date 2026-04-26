/**
 * Client-safe aggregation helpers.
 *
 * Server pages load the last N days of per-day slices via
 * `loadDailyPagesSlices` / `loadDailyTopicsSlices`. The client-side
 * table components call these functions inside a `useMemo` keyed on
 * the selected timeframe to produce a window-aggregated rollup
 * without a server round-trip.
 *
 * No "use client" directive — pure functions, importable from either
 * side of the RSC boundary. No filesystem access.
 */

import type {
  DailyPagesSlice,
  DailyTopicsSlice,
  RolledPage,
  RolledTopic,
} from "./types";

/**
 * Aggregate per-URL cross-channel metrics across the last `windowDays`
 * slices. Slices expected in chronological order (oldest first).
 *
 * Aggregation rules:
 *   - `seo_clicks`, `seo_impressions`, `ga_sessions`, `llm_sessions`,
 *     `peec_citations` → summed across days
 *   - `sources` → union of all source tags seen
 *   - `composite_score` → recomputed from summed values using the same
 *     formula as the Python aggregator, so longer windows produce
 *     larger scores (bigger denominators in the min() caps stay put)
 *   - `days_active` → number of days this URL had any non-zero signal
 *   - `first_seen` / `last_seen` → date range of activity
 */
export function rollPages(
  slices: DailyPagesSlice[],
  windowDays: number
): RolledPage[] {
  const window = slices.slice(-windowDays);
  const byUrl = new Map<string, RolledPage>();

  for (const slice of window) {
    for (const p of slice.pages) {
      const existing = byUrl.get(p.url);
      const seoClicks = p.seo_clicks ?? 0;
      const seoImpr = p.seo_impressions ?? 0;
      const gaSess = p.ga_sessions ?? 0;
      const llmSess = p.llm_sessions ?? 0;
      const peecCit = p.peec_citations ?? 0;
      const hasSignal =
        seoClicks > 0 || seoImpr > 0 || gaSess > 0 || llmSess > 0 || peecCit > 0;

      if (!existing) {
        byUrl.set(p.url, {
          url: p.url,
          seo_clicks: seoClicks,
          seo_impressions: seoImpr,
          ga_sessions: gaSess,
          llm_sessions: llmSess,
          peec_citations: peecCit,
          sources: [...p.sources],
          composite_score: 0, // recomputed below
          days_active: hasSignal ? 1 : 0,
          first_seen: slice.date,
          last_seen: slice.date,
        });
      } else {
        existing.seo_clicks += seoClicks;
        existing.seo_impressions += seoImpr;
        existing.ga_sessions += gaSess;
        existing.llm_sessions += llmSess;
        existing.peec_citations += peecCit;
        for (const src of p.sources) {
          if (!existing.sources.includes(src)) existing.sources.push(src);
        }
        if (hasSignal) existing.days_active += 1;
        // Slices are chronological, so later iterations update last_seen.
        existing.last_seen = slice.date;
      }
    }
  }

  // Recompute composite score with the same weights as the Python
  // aggregator, BUT scale each cap by the window length so the score
  // stays comparable across timeframes. Caps below are "good per-day
  // values" multiplied by windowDays.
  //
  // Audit fix (2026-04-26): previously caps were per-day values
  // applied to window sums, so a 30-day window could trivially
  // saturate caps tuned for a single day's volume — every page
  // would look like a 0.9+ composite. Scaling caps with windowDays
  // keeps "1.0 = consistently great every day in the window".
  const effectiveWindow = Math.max(1, window.length);
  const CLICKS_CAP = 50.0 * effectiveWindow;
  const GA_CAP = 200.0 * effectiveWindow;
  const PEEC_CAP = 50.0 * effectiveWindow;
  const LLM_CAP = 20.0 * effectiveWindow;

  const rolled = Array.from(byUrl.values());
  for (const r of rolled) {
    r.composite_score =
      0.40 * Math.min(r.seo_clicks / CLICKS_CAP, 1.0) +
      0.30 * Math.min(r.ga_sessions / GA_CAP, 1.0) +
      0.20 * Math.min(r.peec_citations / PEEC_CAP, 1.0) +
      0.10 * Math.min(r.llm_sessions / LLM_CAP, 1.0);
    r.sources.sort();
  }

  rolled.sort((a, b) => b.composite_score - a.composite_score);
  return rolled;
}

/**
 * Aggregate per-topic cross-channel metrics across the last `windowDays`
 * slices. Slices expected in chronological order.
 *
 * Aggregation rules:
 *   - `seo_clicks`, `seo_impressions`, `ga_views`, `geo_mentions`
 *     → summed across days
 *   - `geo_visibility` → mean of daily values, ignoring days where the
 *     topic didn't appear (visibility is a 0–1 ratio; summing would be
 *     nonsensical)
 *   - `peec_topic_ids` → union
 *   - `days_active` → number of days the topic had any signal
 */
export function rollTopics(
  slices: DailyTopicsSlice[],
  windowDays: number
): RolledTopic[] {
  const window = slices.slice(-windowDays);
  interface Accum extends RolledTopic {
    _viz_sum: number;
    _viz_count: number;
  }
  const byTopic = new Map<string, Accum>();

  for (const slice of window) {
    for (const t of slice.topics) {
      // Keys are `cluster::lang` for post-migration rows; fall back to
      // topic display name for old daily files (pre-2026-04-23) that
      // lack cluster/lang fields. Old rows collapse into a single
      // accumulator either way.
      const key =
        t.cluster && t.lang ? `${t.cluster}::${t.lang}` : t.topic;
      const existing = byTopic.get(key);
      const seoClicks = t.seo_clicks ?? 0;
      const seoImpr = t.seo_impressions ?? 0;
      const gaViews = t.ga_views ?? 0;
      const mentions = t.geo_mentions ?? 0;
      const viz = typeof t.geo_visibility === "number" ? t.geo_visibility : null;
      const hasSignal = seoClicks > 0 || seoImpr > 0 || gaViews > 0 || mentions > 0;

      if (!existing) {
        byTopic.set(key, {
          topic: t.topic,
          cluster: t.cluster,
          lang: t.lang,
          seo_clicks: seoClicks,
          seo_impressions: seoImpr,
          ga_views: gaViews,
          geo_visibility: 0, // computed at the end from _viz_sum/_viz_count
          geo_mentions: mentions,
          peec_topic_ids: [...t.peec_topic_ids],
          days_active: hasSignal ? 1 : 0,
          _viz_sum: viz !== null ? viz : 0,
          _viz_count: viz !== null ? 1 : 0,
        });
      } else {
        existing.seo_clicks += seoClicks;
        existing.seo_impressions += seoImpr;
        existing.ga_views += gaViews;
        existing.geo_mentions += mentions;
        for (const tid of t.peec_topic_ids) {
          if (!existing.peec_topic_ids.includes(tid)) existing.peec_topic_ids.push(tid);
        }
        if (hasSignal) existing.days_active += 1;
        if (viz !== null) {
          existing._viz_sum += viz;
          existing._viz_count += 1;
        }
      }
    }
  }

  const out: RolledTopic[] = [];
  for (const acc of byTopic.values()) {
    const avgViz = acc._viz_count > 0 ? acc._viz_sum / acc._viz_count : 0;
    // Strip the accumulator fields before emitting.
    const { _viz_sum: _s, _viz_count: _c, ...rest } = acc;
    void _s; void _c;
    out.push({ ...rest, geo_visibility: avgViz });
  }

  out.sort((a, b) => b.geo_mentions - a.geo_mentions);
  return out;
}

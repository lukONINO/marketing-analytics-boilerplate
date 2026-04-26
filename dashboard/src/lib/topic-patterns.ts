/**
 * Shared topic-classification constants.
 *
 * Lives in /lib (neutral module) rather than inside TopicClustersTable.tsx
 * because both a Server Component (app/topics/page.tsx, renders the
 * legend) and a Client Component (TopicClustersTable.tsx, renders the
 * cells) need the same `Pattern` values and `PATTERN_PILL` styling map.
 *
 * Re-exporting plain data from a "use client" module doesn't work in
 * the App Router — Next compiles the file as a client reference and
 * the constants read back as `undefined` on the server. Keep this file
 * directive-free so it's importable from either side of the boundary.
 */

import type { CrossChannelTopic } from "./types";

export type Pattern =
  | "rank_no_cite"
  | "cite_no_rank"
  | "orphan_traffic"
  | "active_both"
  | "quiet";

export const PATTERN_PILL: Record<Pattern, { label: string; cls: string }> = {
  rank_no_cite:   { label: "rank without citation", cls: "bg-warning-50 text-warning-600 ring-1 ring-inset ring-warning/25" },
  cite_no_rank:   { label: "citation without rank", cls: "bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-200" },
  orphan_traffic: { label: "orphan traffic",        cls: "bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-200" },
  active_both:    { label: "active both",           cls: "bg-success-50 text-success-600 ring-1 ring-inset ring-success/25" },
  quiet:          { label: "quiet",                 cls: "bg-surface-muted text-ink-500 ring-1 ring-inset ring-hairline" },
};

/**
 * Classify a topic row based on its cross-channel presence.
 *
 * Thresholds use a stronger floor than 0 to avoid misclassifying noise
 * as real signal — a single fluky click or one Peec mention shouldn't
 * flip a cluster from "quiet" to "active". The thresholds below are
 * symmetric in intent (any meaningful presence on a channel) even
 * though their absolute numbers differ:
 *
 *   - clicks ≥ 1 = real SEO presence (a click is a strong, intentional
 *     signal — even one click means we ranked AND someone selected us)
 *   - mentions ≥ 3 = real AI presence (mentions accumulate across
 *     multiple prompts × engines × days, so requiring 3 filters out
 *     incidental matches without being too strict)
 *
 * Audit note (2026-04-26): previously the AI threshold was `mentions > 10`
 * which was asymmetric — a cluster with 5 mentions and 0 clicks would
 * collapse to "quiet" instead of cite-without-rank. Tightened the SEO
 * threshold and loosened the AI threshold so both are consistent.
 */
export function classifyPattern(t: CrossChannelTopic): Pattern {
  const clicks = t.seo_clicks ?? 0;
  const views = t.ga_views ?? 0;
  const mentions = t.geo_mentions ?? 0;

  const hasSeo = clicks >= 1;
  const hasAi = mentions >= 3;

  if (hasSeo && !hasAi) return "rank_no_cite";
  if (!hasSeo && hasAi) return "cite_no_rank";
  if (hasSeo && hasAi) return "active_both";
  if (views > 0 && !hasSeo && !hasAi) return "orphan_traffic";
  return "quiet";
}

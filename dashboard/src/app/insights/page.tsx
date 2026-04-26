import { redirect } from "next/navigation";

/**
 * /insights → /strategy redirect.
 *
 * The dedicated Insights page was retired on 2026-04-26 — its panels
 * (4-state classification, Source Gaps, Visibility Improvements,
 * Claude notes) moved to:
 *   - per-cluster detail pages (`/topics/<cluster>`) for cluster-scoped
 *     versions of each panel
 *   - the Strategy page (`/strategy`) for the consolidated site-wide
 *     "Things to fix" list and the recent Claude findings widget
 *
 * Existing bookmarks land on Strategy. The route file stays so URL
 * sharing doesn't 404; Next.js' `redirect()` issues a 307.
 */
export default function InsightsRedirect(): never {
  redirect("/strategy");
}

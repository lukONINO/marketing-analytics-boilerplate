import { redirect } from "next/navigation";

/**
 * Legacy redirect — `/settings/website-pages` was renamed to
 * `/settings/clusters` on 2026-04-26 when the page-management surface
 * was consolidated with cluster creation. Keeping this stub so old
 * bookmarks / saved links continue to work.
 */
export default function LegacyWebsitePagesRedirect(): never {
  redirect("/settings/clusters");
}

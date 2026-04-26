/**
 * Legacy redirect: /actions → /tasks.
 *
 * The page was renamed from "Actions" to "Tasks" but the old URL
 * may live in bookmarks, the address bar history, or in external
 * references Claude has already written (e.g. linked_urls in prior
 * insights). Preserve the URL for those, but funnel all reads to the
 * canonical path.
 */

import { redirect } from "next/navigation";

export default function ActionsRedirect() {
  redirect("/tasks");
}

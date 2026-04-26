"use client";

/**
 * Breadcrumbs for nested routes.
 *
 * Renders nothing for top-level routes (`/`, `/insights`, `/tasks`,
 * `/topics`, `/settings`, etc.). Kicks in at depth ≥ 2, e.g.:
 *
 *   /topics/whitelabel            → Topic Clusters › Whitelabel
 *   /settings/data                → Settings › Data
 *   /settings/ai-workflows        → Settings › AI workflows
 *
 * Static segments resolve via the LABELS map. Dynamic segments (cluster
 * slugs) resolve via the `slugLabels` prop — the layout loads the
 * topic-cluster config and passes `slug → names.en` so breadcrumbs
 * show the real cluster name, not a titleized slug. If a slug isn't in
 * the map we fall back to a simple titleize so unknown paths still
 * render readable crumbs.
 *
 * Hidden below `md` — on mobile the topbar already carries the brand
 * and the page heading sits right below it, so crumbs would crowd the
 * narrow bar for little benefit.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const LABELS: Record<string, string> = {
  topics: "Topic Clusters",
  settings: "Settings",
  data: "Data",
  onboarding: "Onboarding",
  clusters: "Clusters & pages",
  "website-pages": "Website pages",
  "ai-workflows": "AI workflows",
  page: "Page",
  // `insights` retired 2026-04-26 — kept only so any breadcrumb that
  // accidentally lands on the redirect target reads cleanly during the
  // brief 307 hop.
  insights: "Strategy",
  tasks: "Tasks",
  actions: "Actions",
  strategy: "Strategy",
};

function titleize(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export interface BreadcrumbsProps {
  /**
   * Display-name lookup for dynamic route segments (e.g. cluster slugs).
   * Keyed by the raw URL segment. Falls back to titleize() on miss.
   */
  slugLabels?: Record<string, string>;
}

export function Breadcrumbs({ slugLabels = {} }: BreadcrumbsProps) {
  const pathname = usePathname() ?? "/";
  const allSegments = pathname.split("/").filter(Boolean);

  // Top-level route → nothing to show.
  if (allSegments.length < 2) return null;

  // Page-level analytics (`/topics/<slug>/page/<...path>`) collapses
  // the deep URL-path tail into a single "Page" crumb. Rendering 4+
  // path segments as separate crumbs makes the topbar unreadable.
  const pageIndex = allSegments.indexOf("page");
  const segments =
    pageIndex >= 0 && pageIndex < allSegments.length - 1
      ? [...allSegments.slice(0, pageIndex + 1)]
      : allSegments;

  const crumbs = segments.map((seg, i) => {
    const href = "/" + segments.slice(0, i + 1).join("/");
    const label = LABELS[seg] ?? slugLabels[seg] ?? titleize(seg);
    const isLast = i === segments.length - 1;
    return { href, label, isLast };
  });

  return (
    <nav
      aria-label="Breadcrumb"
      className="hidden md:flex min-w-0 items-center"
    >
      <ol className="flex items-center gap-1.5 min-w-0 text-sm">
        {crumbs.map((c, i) => (
          <li key={c.href} className="flex items-center gap-1.5 min-w-0">
            {i > 0 && <ChevronSep />}
            {c.isLast ? (
              <span
                aria-current="page"
                className="text-ink-900 font-medium truncate max-w-[18rem]"
              >
                {c.label}
              </span>
            ) : (
              <Link
                href={c.href}
                className="text-ink-500 hover:text-primary-700 transition-colors truncate max-w-[14rem]"
              >
                {c.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function ChevronSep() {
  return (
    <svg
      className="w-3 h-3 text-ink-400 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

"use client";

/**
 * Left sidebar — primary navigation + settings sub-nav.
 *
 * Layout behavior:
 *   - Desktop (md+): fixed left, always visible (256px wide).
 *   - Mobile (<md): hidden by default. MobileMenuToggle in the topbar
 *     opens a full-height drawer with a backdrop. The drawer closes on
 *     backdrop click, ESC, or any nav link click.
 */

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";

// ---------------------------------------------------------------------
// Mobile drawer open state — shared with MobileMenuToggle in the topbar
// ---------------------------------------------------------------------

interface MobileNavState {
  open: boolean;
  setOpen: (v: boolean) => void;
}

const MobileNavCtx = createContext<MobileNavState | null>(null);

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <MobileNavCtx.Provider value={{ open, setOpen }}>
      {children}
    </MobileNavCtx.Provider>
  );
}

export function useMobileNav(): MobileNavState {
  const ctx = useContext(MobileNavCtx);
  if (!ctx) {
    return { open: false, setOpen: () => {} };
  }
  return ctx;
}

// ---------------------------------------------------------------------
// Navigation structure
// ---------------------------------------------------------------------

interface NavItem {
  href: string;
  label: string;
  icon: (active: boolean) => React.ReactNode;
}

// Order: Overview → Strategy → Topic Clusters → Prompts → Tasks.
// Strategy lives directly under Overview because it's the second-most
// -visited surface (executive view of cross-channel state). Topic
// Clusters is the drill-down structure. Prompts is the input-quality
// audit surface for the Peec prompt set itself (added 2026-04-26).
// Insights was retired 2026-04-26 — its panels folded into Strategy +
// per-cluster detail. /insights still 307s to /strategy for any
// external links that might hit it.
const PRIMARY_NAV: NavItem[] = [
  { href: "/",                  label: "Overview",        icon: (a) => <OverviewIcon active={a} /> },
  { href: "/strategy",          label: "Strategy",        icon: (a) => <StrategyIcon active={a} /> },
  { href: "/topics",            label: "Topic Clusters",  icon: (a) => <ClustersIcon active={a} /> },
  { href: "/strategy/prompts",  label: "Prompts",         icon: (a) => <PromptsIcon active={a} />  },
  { href: "/tasks",             label: "Tasks",           icon: (a) => <TasksIcon active={a} />    },
];

const SETTINGS_NAV = [
  { href: "/settings/onboarding",   label: "Onboarding" },
  { href: "/settings/data",         label: "Data" },
  { href: "/settings/clusters",     label: "Clusters & pages" },
  { href: "/settings/ai-workflows", label: "AI workflows" },
] as const;

// ---------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------

export interface SidebarProps {
  notionUrl?: string | null;
}

export function Sidebar({ notionUrl }: SidebarProps) {
  const { open, setOpen } = useMobileNav();
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Operator email for the footer avatar — set NEXT_PUBLIC_OPERATOR_EMAIL
  // in your env to surface the signed-in user's address. Defaults to a
  // generic placeholder so the boilerplate stays neutral.
  const operatorEmail =
    process.env.NEXT_PUBLIC_OPERATOR_EMAIL || "you@acme.io";
  const operatorInitial = (operatorEmail[0] || "Y").toUpperCase();

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={clsx(
          "fixed inset-0 z-30 bg-primary-950/45 backdrop-blur-sm transition-opacity md:hidden",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
        onClick={() => setOpen(false)}
        aria-hidden
      />

      <aside
        className={clsx(
          "fixed top-0 left-0 z-40 h-dvh w-56",
          "bg-surface-sidebar",
          "border-r border-hairline",
          "flex flex-col transition-transform duration-200 ease-out",
          "md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
        aria-label="Primary navigation"
      >
        {/* Brand header — wordmark only, mono display font */}
        <div className="px-5 pt-6 pb-5 flex items-center gap-2">
          <Link
            href="/"
            className="flex items-baseline gap-2 group"
            aria-label="Acme — home"
          >
            <span className="font-display text-[18px] font-bold tracking-tight text-ink-900 group-hover:text-primary-700 transition-colors leading-none">
              AC<span className="text-primary-600">M</span>E
            </span>
            <span className="text-[9px] uppercase tracking-[0.22em] text-ink-600 font-semibold">
              GEO
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-auto md:hidden text-ink-600 hover:text-ink-900 transition-colors"
            aria-label="Close menu"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6l-6 12" />
            </svg>
          </button>
        </div>

        {/* Primary + Settings nav */}
        <nav className="px-3 flex-1 overflow-y-auto pb-4" aria-label="Primary">
          <NavGroup label="Workspace">
            {PRIMARY_NAV.map((item) => {
              // Active = best (longest) matching prefix wins. Stops the
              // /strategy item from also lighting up when the user is on
              // /strategy/prompts (which has its own nav entry). Tied on
              // length means an exact match against this item — active.
              const candidates = PRIMARY_NAV.filter((i) =>
                i.href === pathname ||
                (i.href !== "/" && pathname.startsWith(i.href + "/")) ||
                (i.href === "/" && pathname === "/"),
              );
              const best = candidates.reduce<NavItem | null>(
                (acc, i) => (!acc || i.href.length > acc.href.length ? i : acc),
                null,
              );
              const active = best?.href === item.href;
              return (
                <NavLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon(active)}
                  active={active}
                />
              );
            })}
          </NavGroup>

          <NavGroup label="Settings" className="mt-5">
            {SETTINGS_NAV.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                active={pathname === item.href || pathname.startsWith(item.href + "/")}
                dense
              />
            ))}
          </NavGroup>
        </nav>

        {/* Footer — Notion link + email avatar */}
        <div className="px-4 pb-4 pt-3 border-t border-hairline-subtle space-y-3">
          {notionUrl && (
            <a
              href={notionUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-[12px] text-ink-600 hover:text-primary-700 font-medium transition-colors"
              title="Open Marketing Reports database in Notion"
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4M12 16h.01" />
              </svg>
              Help &amp; Notion
              <svg className="w-3 h-3 ml-auto opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17L17 7M17 7H9M17 7v8" />
              </svg>
            </a>
          )}
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary-600 text-white text-[10px] font-semibold shrink-0">
              {operatorInitial}
            </span>
            <span className="text-[12px] text-ink-700 font-medium truncate">
              {operatorEmail}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------
// Mobile menu trigger
// ---------------------------------------------------------------------

export function MobileMenuToggle() {
  const { open, setOpen } = useMobileNav();
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg text-ink-600 hover:bg-surface-muted hover:text-ink-900 transition-colors"
      aria-label={open ? "Close navigation" : "Open navigation"}
      aria-expanded={open}
    >
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        {open ? (
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6l-6 12" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
        )}
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------------
// Shared link + group primitives
// ---------------------------------------------------------------------

function NavGroup({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={clsx("px-1", className)}>
      <div className="px-3 pb-2 text-[10px] uppercase tracking-[0.16em] text-ink-600 font-semibold">
        {label}
      </div>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

/**
 * NavLink — design-system sidebar item, active and default variants.
 * Active = primary-100 background, primary-700 icon + text, fully pill-rounded.
 * Default = ink-600 text + icon, no background; hover lightens with sidebar-accent.
 */
function NavLink({
  href,
  label,
  icon,
  active,
  dense = false,
}: {
  href: string;
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  dense?: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={clsx(
          "relative flex items-center gap-2.5 rounded-full text-[13px] transition-colors group",
          dense ? "px-3 py-1.5" : "px-3 py-2",
          active
            ? "bg-primary-100 text-primary-700 font-semibold"
            : "text-ink-600 hover:text-ink-900 hover:bg-hairline/50",
        )}
      >
        {icon && (
          <span className={clsx("shrink-0 transition-colors", active ? "text-primary-700" : "text-ink-600 group-hover:text-ink-900")}>
            {icon}
          </span>
        )}
        <span className="truncate">{label}</span>
      </Link>
    </li>
  );
}

// ---------------------------------------------------------------------
// Icons (stroke-based, shared line weight for visual coherence)
// ---------------------------------------------------------------------

function OverviewIcon({ active }: { active: boolean }) {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.1 : 1.8} aria-hidden>
      <rect x="3" y="3" width="7" height="9" rx="1.5" strokeLinecap="round" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" strokeLinecap="round" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" strokeLinecap="round" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ClustersIcon({ active }: { active: boolean }) {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.1 : 1.8} aria-hidden>
      <circle cx="12" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path strokeLinecap="round" d="M12 8.5v2.5m0 0L8 15m4-4l4 4" />
    </svg>
  );
}

function TasksIcon({ active }: { active: boolean }) {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.1 : 1.8} aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 10l2 2 4-4m-6 8h10" />
    </svg>
  );
}

function StrategyIcon({ active }: { active: boolean }) {
  // Three nested concentric arcs — visual reference to the 3-layer
  // measurement framework. Active state thickens the outer ring.
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.1 : 1.8} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5.5" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function PromptsIcon({ active }: { active: boolean }) {
  // Speech-bubble with a small caret — speech for "prompt", caret for
  // "the prompt is what AI parses". Active state thickens the outline.
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.1 : 1.8} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a2 2 0 012-2h12a2 2 0 012 2v9a2 2 0 01-2 2h-5l-4 4v-4H6a2 2 0 01-2-2V5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l2 2 4-4" />
    </svg>
  );
}

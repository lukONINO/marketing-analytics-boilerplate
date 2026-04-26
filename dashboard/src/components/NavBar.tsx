"use client";

/**
 * Topbar — sticky, thin, contextual controls only.
 */

import { Breadcrumbs } from "./Breadcrumbs";
import { MobileMenuToggle } from "./Sidebar";
import { RefreshButton } from "./RefreshButton";
import { TimeframeSelector } from "./TimeframeSelector";
import type { RefreshState } from "@/lib/types";

export interface NavBarProps {
  refreshState: RefreshState;
  slugLabels?: Record<string, string>;
}

export function NavBar({ refreshState, slugLabels }: NavBarProps) {
  return (
    <header className="sticky top-0 z-20 bg-surface-canvas/85 backdrop-blur-md border-b border-hairline">
      <div className="h-14 px-4 md:px-8 lg:px-10 flex items-center gap-3">
        {/* Mobile hamburger */}
        <MobileMenuToggle />

        {/* Mobile brand */}
        <div className="md:hidden flex items-baseline gap-2 shrink-0">
          <span className="font-display text-[15px] font-bold tracking-tight text-ink-900">
            AC<span className="text-primary-600">M</span>E
          </span>
          <span className="text-[9px] uppercase tracking-[0.22em] text-ink-600 font-semibold">GEO</span>
        </div>

        {/* Breadcrumbs */}
        <Breadcrumbs slugLabels={slugLabels} />

        <div className="flex-1" />

        {/* Contextual toolbar */}
        <div className="flex items-center gap-2 md:gap-3">
          <TimeframeSelector />
          <div className="w-px h-5 bg-hairline hidden sm:block" aria-hidden />
          <RefreshButton initialState={refreshState} />
        </div>
      </div>
    </header>
  );
}

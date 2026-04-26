"use client";

import clsx from "clsx";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface InfoTooltipProps {
  /** Body of the tooltip. Can be a string or JSX. Keep it tight. */
  content: React.ReactNode;
  /** Placement relative to the trigger. Defaults to 'top'. */
  placement?: "top" | "right" | "bottom" | "left";
  /** Override icon size in px. Defaults to 12. */
  size?: number;
  /** Accessible label read by screen readers. */
  label?: string;
  /** Width class for the popover body. Defaults to w-64. */
  widthClass?: string;
  className?: string;
}

/**
 * Info-icon + tooltip used on metric cards and table column headers.
 *
 * Opens on hover, focus, and click. Click-toggle lets touch users open,
 * and close via click-outside / Escape.
 *
 * Rendered through a React portal into `document.body` so that no
 * ancestor's `overflow-hidden` / `overflow-x-auto` / rounded-corners
 * clipping can cut the popover off. This is critical inside
 * `<table>` containers with horizontal-scroll wrappers: CSS resolves
 * `overflow-y: visible` to `auto` whenever either axis is non-visible,
 * so a tooltip opening upward from a column header would otherwise be
 * clipped by the scroll container.
 *
 * Position is recomputed on open and on viewport change; the tooltip
 * closes on scroll to avoid the fast-repositioning flicker that comes
 * with following the anchor during a scroll gesture.
 */
export function InfoTooltip({
  content,
  placement = "top",
  size = 12,
  label = "More info",
  widthClass = "w-64",
  className,
}: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [mounted, setMounted] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);

  // Portal only mounts client-side.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Hover-gap handling: when the cursor leaves the icon toward the
  // portal-rendered popover there's a brief moment where neither
  // `onMouseEnter` has fired yet. A short close delay prevents the
  // popover from flashing shut during that transit.
  function openNow() {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  }
  function scheduleClose() {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  }
  // Clean up any pending timer on unmount.
  useEffect(() => {
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    };
  }, []);

  // Measure the trigger rect whenever the tooltip opens.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    setRect(btnRef.current.getBoundingClientRect());
  }, [open]);

  // Close on scroll (anywhere) or on viewport resize — either would
  // otherwise leave the popover stuck to a stale anchor position.
  useEffect(() => {
    if (!open) return;
    function close() { setOpen(false); }
    window.addEventListener("scroll", close, { capture: true, passive: true });
    window.addEventListener("resize", close, { passive: true });
    return () => {
      window.removeEventListener("scroll", close, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  // Click-outside + Escape dismisses the click-opened state.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (
        btnRef.current?.contains(e.target as Node) ||
        popRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  // Convert rect + placement into fixed-position pixel coords + transform.
  const coords = useMemo(() => {
    if (!rect) return null;
    const gap = 6;
    switch (placement) {
      case "top":
        return {
          left: rect.left + rect.width / 2,
          top: rect.top - gap,
          transform: "translate(-50%, -100%)",
        };
      case "bottom":
        return {
          left: rect.left + rect.width / 2,
          top: rect.bottom + gap,
          transform: "translate(-50%, 0)",
        };
      case "left":
        return {
          left: rect.left - gap,
          top: rect.top + rect.height / 2,
          transform: "translate(-100%, -50%)",
        };
      case "right":
        return {
          left: rect.right + gap,
          top: rect.top + rect.height / 2,
          transform: "translate(0, -50%)",
        };
    }
  }, [rect, placement]);

  return (
    <span className={clsx("relative inline-flex align-middle", className)}>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onMouseEnter={openNow}
        onMouseLeave={scheduleClose}
        onFocus={openNow}
        onBlur={scheduleClose}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center justify-center rounded-full text-ink-500 hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/25 transition-colors"
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="6.5" />
          <circle cx="8" cy="5.25" r="0.6" fill="currentColor" stroke="none" />
          <path d="M8 7.25v3.75" strokeLinecap="round" />
        </svg>
      </button>
      {open && coords && mounted &&
        createPortal(
          <div
            ref={popRef}
            role="tooltip"
            // Critical color + opacity baked in as inline styles so they
            // can't be defeated by an ancestor's mix-blend / opacity /
            // backdrop-filter cascade — the portal target (`document.body`)
            // is outside our React tree, but global CSS rules on `body`
            // still apply, and inline `background-color` wins against
            // any class-based override. Switched to ink-900 + pure white
            // because primary-950 + primary-100 was rendering washed-out
            // when the canvas warmed up after the DS rework.
            style={{
              position: "fixed",
              left: coords.left,
              top: coords.top,
              transform: coords.transform,
              zIndex: 9999,
              backgroundColor: "#111111",
              color: "#ffffff",
              opacity: 1,
            }}
            className={clsx(
              "text-[11px] leading-relaxed rounded-lg shadow-pop px-3 py-2 font-normal normal-case tracking-normal pointer-events-auto",
              widthClass
            )}
            onMouseEnter={openNow}
            onMouseLeave={scheduleClose}
          >
            {content}
          </div>,
          document.body
        )
      }
    </span>
  );
}

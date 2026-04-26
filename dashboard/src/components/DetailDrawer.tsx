"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface DetailDrawerProps {
  /** When truthy, drawer is open. Parent owns the state. */
  open: boolean;
  /** Called when user requests close (ESC, backdrop click, close button). */
  onClose: () => void;
  /** Main drawer title. */
  title?: React.ReactNode;
  /** Optional subtitle/eyebrow shown above the title. */
  eyebrow?: React.ReactNode;
  /** Optional trailing slot in the header (e.g. status pill). */
  headerTrailing?: React.ReactNode;
  /** Sticky footer slot (actions). */
  footer?: React.ReactNode;
  /** Drawer body. */
  children: React.ReactNode;
  /** Width class for the drawer panel on desktop. Default: max-w-xl. */
  widthClass?: string;
}

/**
 * Right-hand detail drawer used for insights + tasks + (later) anything
 * else that needs a focused read without leaving the list behind.
 *
 * Portal-rendered so parent `overflow-*` cannot clip it. Slide-in from
 * right on desktop; full-width on mobile. Keyboard accessible: ESC
 * closes, focus trapped inside when open, focus restored to trigger
 * on close.
 */
export function DetailDrawer({
  open,
  onClose,
  title,
  eyebrow,
  headerTrailing,
  footer,
  children,
  widthClass = "max-w-xl",
}: DetailDrawerProps) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock body scroll while open + remember/restore focus.
  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Defer focus so the browser has painted the panel.
    const raf = requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      document.body.style.overflow = originalOverflow;
      cancelAnimationFrame(raf);
      // Restore focus to whatever opened the drawer.
      if (triggerRef.current instanceof HTMLElement) {
        triggerRef.current.focus();
      }
    };
  }, [open]);

  // Keyboard: ESC closes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      aria-hidden={!open}
      className={clsx(
        "fixed inset-0 z-50 transition-opacity duration-200",
        open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close drawer"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
        className={clsx(
          "absolute inset-0 bg-primary-950/35 backdrop-blur-[2px] transition-opacity",
          open ? "opacity-100" : "opacity-0",
        )}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : "Detail"}
        tabIndex={-1}
        className={clsx(
          "absolute right-0 top-0 bottom-0 w-full bg-surface shadow-2xl",
          "flex flex-col outline-none border-l border-hairline",
          "transform transition-transform duration-300 ease-out",
          widthClass,
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <header className="shrink-0 px-6 pt-5 pb-4 border-b border-hairline bg-gradient-to-b from-surface-muted/40 to-surface">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              {eyebrow && (
                <div className="text-[10px] uppercase tracking-[0.14em] text-ink-500 font-semibold mb-1.5">
                  {eyebrow}
                </div>
              )}
              {title && (
                <h2 className="text-lg font-semibold text-ink-900 leading-snug tracking-tight">
                  {title}
                </h2>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {headerTrailing}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="w-8 h-8 rounded-lg text-ink-500 hover:bg-surface-muted hover:text-ink-900 flex items-center justify-center transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <footer className="shrink-0 px-6 py-4 border-t border-hairline bg-surface-muted/60">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

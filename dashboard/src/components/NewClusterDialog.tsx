"use client";

/**
 * Modal for creating a custom cluster from the dashboard.
 *
 * The user supplies slug + EN name + DE name. Auto-suggests the slug
 * from the EN name (lowercased, kebab-cased) but lets the user edit.
 * Rejects slug collisions with the YAML taxonomy server-side.
 *
 * After a successful create, the parent calls router.refresh() so the
 * new cluster appears in the table + dropdowns immediately.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import clsx from "clsx";

export interface NewClusterDialogProps {
  open: boolean;
  onClose: () => void;
  /** Full list of existing slugs (config + custom). Used to pre-validate
   *  collisions without a server round-trip. */
  existingSlugs: string[];
}

export function NewClusterDialog({
  open,
  onClose,
  existingSlugs,
}: NewClusterDialogProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [nameEn, setNameEn] = useState("");
  const [nameDe, setNameDe] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mounted, setMounted] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) {
      setNameEn("");
      setNameDe("");
      setSlug("");
      setSlugTouched(false);
      setError(null);
      setBusy(false);
      // Defer focus so the portal has painted.
      const raf = requestAnimationFrame(() => firstInputRef.current?.focus());
      return () => cancelAnimationFrame(raf);
    }
  }, [open]);

  // Auto-fill slug from EN name until the user manually edits it.
  useEffect(() => {
    if (!slugTouched) {
      const auto = nameEn
        .toLowerCase()
        .replace(/[äöüß]/g, (c) => ({ ä: "a", ö: "o", ü: "u", ß: "ss" }[c] ?? c))
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      setSlug(auto);
    }
  }, [nameEn, slugTouched]);

  const slugInvalid =
    slug.length > 0 && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
  const slugCollides = existingSlugs.includes(slug);
  const submitDisabled =
    !nameEn.trim() || !nameDe.trim() || !slug || slugInvalid || slugCollides || busy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitDisabled) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/clusters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          names: { en: nameEn.trim(), de: nameDe.trim() },
        }),
      });
      if (!res.ok) {
        const { error: message } = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(message ?? `create failed (HTTP ${res.status})`);
        setBusy(false);
        return;
      }
      // Navigate directly into the new cluster's overview so the user
      // can start assigning pages immediately. router.push also
      // triggers a fresh Server Component render of the target, so
      // the newly-created cluster's config is loaded before the
      // overview paints — no stale-data flash.
      onClose();
      startTransition(() => {
        router.push(`/topics/${slug}`);
      });
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : String(e2));
      setBusy(false);
    }
  }

  // Close on ESC.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, busy, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-cluster-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <div
        className="absolute inset-0 bg-primary-950/45 backdrop-blur-sm"
        onClick={() => !busy && onClose()}
      />
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-md mx-4 bg-surface rounded-ds shadow-pop border border-hairline"
      >
        <div className="px-5 pt-4 pb-3 border-b border-hairline">
          <h2 id="new-cluster-title" className="text-base font-semibold text-ink-900">
            New cluster
          </h2>
          <p className="text-xs text-ink-500 mt-0.5 leading-relaxed">
            Create a custom cluster. It shows up in the table with 0s for SEO/AI
            metrics until you wire Peec topic IDs + GSC patterns for it in{" "}
            <code className="text-ink-700">config/topic_clusters.yaml</code>.
          </p>
        </div>

        <div className="px-5 py-4 space-y-4">
          <Field label="English name" required htmlFor="nc-en">
            <input
              id="nc-en"
              ref={firstInputRef}
              type="text"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              placeholder="e.g. Real Estate"
              className={inputClasses}
              disabled={busy}
              required
            />
          </Field>
          <Field label="German name" required htmlFor="nc-de">
            <input
              id="nc-de"
              type="text"
              value={nameDe}
              onChange={(e) => setNameDe(e.target.value)}
              placeholder="z.B. Immobilien"
              className={inputClasses}
              disabled={busy}
              required
            />
          </Field>
          <Field label="Slug" required htmlFor="nc-slug">
            <input
              id="nc-slug"
              type="text"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value.toLowerCase());
                setSlugTouched(true);
              }}
              placeholder="e.g. real-estate"
              className={clsx(
                inputClasses,
                (slugInvalid || slugCollides) && "border-danger/40 focus:ring-danger/25 focus:border-danger",
              )}
              disabled={busy}
              required
            />
            <p className="text-[11px] text-ink-500 mt-1">
              {slugInvalid ? (
                <span className="text-danger-600">
                  Use only lowercase letters, numbers, and single hyphens.
                </span>
              ) : slugCollides ? (
                <span className="text-danger-600">
                  &lsquo;{slug}&rsquo; already exists — pick a different slug.
                </span>
              ) : (
                <>Stable identifier. URL-safe. Can&apos;t be changed later.</>
              )}
            </p>
          </Field>

          {error && (
            <div className="text-xs text-danger-600 bg-danger-50 border border-danger/25 rounded-md px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-hairline bg-surface-muted flex items-center justify-end gap-2 rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-sm px-4 py-1.5 rounded-full text-ink-700 hover:bg-surface-muted transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitDisabled}
            className={clsx(
              "text-sm px-4 py-1.5 rounded-full transition-colors font-medium",
              submitDisabled
                ? "bg-surface-muted text-ink-400 cursor-not-allowed"
                : "bg-primary-600 text-white hover:bg-primary-700 shadow-card",
            )}
          >
            {busy ? "Creating…" : "Create cluster"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------

const inputClasses =
  "w-full px-3 py-2 text-sm border border-hairline rounded-lg bg-surface text-ink-900 placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-primary-600/25 focus:border-primary-400 transition-all";

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-ink-700 mb-1">
        {label} {required && <span className="text-red-600">*</span>}
      </label>
      {children}
    </div>
  );
}

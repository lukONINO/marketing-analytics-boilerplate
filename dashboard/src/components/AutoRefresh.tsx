"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Client-side auto-refresh. Calls router.refresh() on an interval,
 * which re-fetches the Server Component data (new file reads from disk)
 * WITHOUT a full browser reload — user scroll position is preserved.
 *
 * Default: 30 seconds. Matches the "Claude writes, dashboard reads" model.
 */
export function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}

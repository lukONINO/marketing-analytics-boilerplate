import Link from "next/link";
import path from "node:path";
import { stat } from "node:fs/promises";

import {
  loadCustomClusters,
  loadLatestDaily,
  loadNotionConfig,
  loadPageClusters,
  loadTopicClusters,
} from "@/lib/data";
import { loadLatestInventory } from "@/lib/scrape";

export const dynamic = "force-dynamic";

/**
 * Onboarding checklist. Walks the user through first-run setup in the
 * correct order, with live ✓/○ state for each step so someone returning
 * weeks later can see exactly what still needs to happen.
 *
 * Every item is derived from filesystem state (env file present,
 * config files populated, daily aggregate exists, inventory scraped)
 * — nothing here is stored separately. That means "completed" is
 * always accurate and items can't get out of sync with reality.
 */
export default async function SettingsOnboardingPage() {
  const repoRoot = path.resolve(process.cwd(), "..");

  const [
    envExists,
    notionConfig,
    topicClusters,
    customClusters,
    latestDaily,
    inventory,
    pageClusters,
  ] = await Promise.all([
    fileExists(path.join(repoRoot, ".env")),
    loadNotionConfig(),
    loadTopicClusters(),
    loadCustomClusters(),
    loadLatestDaily(),
    loadLatestInventory(),
    loadPageClusters(),
  ]);

  const steps: Step[] = [
    {
      title: "Set up environment credentials",
      done: envExists,
      description:
        "Create a .env file at the repo root with GSC_SERVICE_ACCOUNT_JSON_PATH (or _B64), GA4_PROPERTY_ID, and PEEC_API_KEY. Copy .env.example if present.",
      action: envExists
        ? undefined
        : {
            label: "Open repo root",
            href: "#",
            note: "Create /.env with required credentials, then refresh this page.",
          },
    },
    {
      title: "Configure topic clusters",
      done: topicClusters.length > 0,
      description:
        "config/topic_clusters.yaml lists your clusters with bilingual names, Peec topic IDs, and GSC/GA4 regex patterns. Edit directly when Peec topics change.",
      detail: topicClusters.length > 0
        ? `${topicClusters.length} clusters defined (${topicClusters.slice(0, 3).map((c) => c.slug).join(", ")}${topicClusters.length > 3 ? ", …" : ""})`
        : undefined,
    },
    {
      title: "Connect Notion (optional)",
      done: !!notionConfig.database_id,
      description:
        "The Marketing Reports Notion DB is where the weekly narrative reports land. Skip if you don't use Notion. See .claude/skills/marketing-analytics/notion-schema.md for the one-time bootstrap.",
      detail: notionConfig.database_id ? "DB connected" : undefined,
    },
    {
      title: "Run your first analytics refresh",
      done: latestDaily !== null,
      description:
        "Click Refresh data in the topbar. Pulls GSC + GA4 + LLM-traffic for yesterday, joins with Peec, and writes data/processed/daily/<date>.json. Takes ~60-90s.",
      detail: latestDaily ? `Latest daily aggregate: ${latestDaily[0] ?? "—"}` : undefined,
      action: latestDaily === null
        ? { label: "Go to Overview", href: "/" }
        : undefined,
    },
    {
      title: "Run your first content pipeline",
      done: inventory !== null,
      description:
        "Settings → Data → Run content pipeline. Scrapes your site, assigns pages to clusters, and computes visibility-improvement opportunities. Takes ~3-4 min.",
      detail: inventory
        ? `${inventory.ok_count}/${inventory.total_urls} pages, avg ${inventory.avg_word_count} words`
        : undefined,
      action: inventory === null
        ? { label: "Go to Data settings", href: "/settings/data" }
        : undefined,
    },
    {
      title: "Verify cluster assignments",
      done: !!pageClusters && pageClusters.assignments.length > 0,
      description:
        "Settings → Website pages. Check that every URL landed in a sensible cluster/language. Fix outliers with Move, then recompute if you touched many.",
      detail: pageClusters
        ? `${pageClusters.assignments.length} URLs assigned (${pageClusters.confidence_counts.url_pattern ?? 0} via URL, ${pageClusters.confidence_counts.body_keyword ?? 0} via keyword, ${pageClusters.confidence_counts.default ?? 0} defaulted)`
        : undefined,
      action: pageClusters && pageClusters.assignments.length > 0
        ? { label: "Review assignments", href: "/settings/website-pages" }
        : undefined,
    },
    {
      title: "Custom clusters (optional)",
      done: customClusters.clusters.length > 0,
      description:
        "Add your own cluster slots from the Topic Clusters page. Useful for campaign-specific or product-specific groupings that aren't in the config YAML. Peec/GSC metrics stay zero until you wire patterns for them.",
      detail: customClusters.clusters.length > 0
        ? `${customClusters.clusters.length} custom cluster${customClusters.clusters.length === 1 ? "" : "s"}: ${customClusters.clusters.map((c) => c.slug).join(", ")}`
        : "No custom clusters yet",
    },
    {
      title: "Register Claude workflows",
      done: true,
      description:
        "The .claude/skills/marketing-analytics/ directory contains the skill prompts Claude uses for cluster audits, source-gap refreshes, and visibility lifts. No setup needed — ask Claude 'analyze cluster <slug>' or similar from any chat.",
      action: {
        label: "See AI workflows",
        href: "/settings/ai-workflows",
      },
    },
  ];

  const done = steps.filter((s) => s.done).length;
  const total = steps.length;

  return (
    <>
      <header className="mb-8">
        <span className="inline-block text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-700 bg-primary-50 px-2 py-0.5 rounded-md ring-1 ring-inset ring-primary-200 mb-2">
          Settings
        </span>
        <h1 className="font-display text-[28px] md:text-[32px] font-bold text-ink-900 tracking-tight">
          Onboarding
        </h1>
        <p className="text-sm text-ink-600 mt-2 max-w-2xl leading-relaxed">
          First-run setup. Work through the list top-to-bottom — each step
          unlocks the next. State is read live from the filesystem, so
          checkmarks reflect reality.
        </p>
        <div className="mt-5 flex items-center gap-3">
          <div className="flex-1 max-w-sm h-2 bg-surface-muted rounded-full overflow-hidden border border-hairline">
            <div
              className="h-full bg-gradient-to-r from-primary-600 to-success-500 transition-all duration-500"
              style={{ width: `${(done / total) * 100}%` }}
            />
          </div>
          <span className="text-xs text-ink-700 font-medium tabular-nums">
            {done} / {total} complete
          </span>
        </div>
      </header>

      <section className="space-y-3">
        {steps.map((step, i) => (
          <StepCard key={step.title} step={step} index={i + 1} total={total} />
        ))}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------

interface Step {
  title: string;
  done: boolean;
  description: string;
  detail?: string;
  action?: {
    label: string;
    href: string;
    note?: string;
  };
}

function StepCard({ step, index, total }: { step: Step; index: number; total: number }) {
  return (
    <div
      className={`bg-surface border rounded-ds px-4 md:px-5 py-4 shadow-card transition-all ${
        step.done ? "border-success/25 bg-success-50/30" : "border-hairline"
      }`}
    >
      <div className="flex items-start gap-3">
        <StatusDot done={step.done} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-[0.14em] text-ink-500 font-semibold tabular-nums">
              Step {index} of {total}
            </span>
            {step.done && (
              <span className="text-[11px] text-success-600 font-semibold">✓ Done</span>
            )}
          </div>
          <h2 className="text-base font-semibold text-ink-900 mt-1 leading-snug tracking-tight">
            {step.title}
          </h2>
          <p className="text-sm text-ink-600 mt-1.5 leading-relaxed">
            {step.description}
          </p>
          {step.detail && (
            <p className="text-xs text-ink-700 mt-2 tabular-nums bg-surface-muted border border-hairline rounded-lg px-2.5 py-1.5 inline-block">
              {step.detail}
            </p>
          )}
          {step.action && (
            <div className="mt-3">
              {step.action.href === "#" ? (
                <span className="text-xs text-ink-500 italic">
                  {step.action.note ?? step.action.label}
                </span>
              ) : (
                <Link
                  href={step.action.href}
                  className="inline-flex items-center gap-1.5 text-xs bg-primary-600 text-white px-4 py-1.5 rounded-full hover:bg-primary-700 shadow-card transition-all font-medium"
                >
                  {step.action.label}
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusDot({ done }: { done: boolean }) {
  if (done) {
    return (
      <div className="w-6 h-6 rounded-full bg-success-500 text-white flex items-center justify-center shrink-0 shadow-card ring-4 ring-success-500/10">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
    );
  }
  return (
    <div className="w-6 h-6 rounded-full border-2 border-hairline-strong bg-surface flex items-center justify-center shrink-0">
      <div className="w-1.5 h-1.5 rounded-full bg-ink-400" />
    </div>
  );
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

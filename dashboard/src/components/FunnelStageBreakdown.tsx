"use client";

/**
 * Funnel-stage breakdown card grid.
 *
 * Three side-by-side cards, one per stage (Awareness / Consideration /
 * Decision). Each shows: prompt count, AI prompt coverage % for the
 * stage, classification breakdown (cited / mentioned / never reached),
 * and up to three example prompts.
 *
 * Used at all three drill levels (site, cluster, page when relevant).
 * Stage classification comes from analytics.ts heuristics (BOFU prompts
 * containing "vs" or brand-named, TOFU prompts starting with "what
 * is" / "how does", MOFU everything else).
 */

import clsx from "clsx";

import { InfoTooltip } from "@/components/InfoTooltip";
import {
  type FunnelStage,
  STAGE_META,
  type StageRollup,
} from "@/lib/analytics";

export interface FunnelStageBreakdownProps {
  byStage: Record<FunnelStage, StageRollup>;
  /** Optional title override; defaults to "Funnel-stage performance". */
  title?: string;
  /** Whether to show example prompts under each stage. */
  showExamples?: boolean;
}

const STAGE_ORDER: FunnelStage[] = ["TOFU", "MOFU", "BOFU"];

export function FunnelStageBreakdown({
  byStage,
  title = "Funnel-stage performance",
  showExamples = true,
}: FunnelStageBreakdownProps) {
  return (
    <section className="mb-8">
      <header className="flex items-center gap-1.5 mb-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
          {title}
        </h2>
        <InfoTooltip
          widthClass="w-[22rem]"
          label="About funnel stages"
          content={
            <>
              <strong>Three stages of buyer intent.</strong>
              <br />
              We classify each AI question (prompt) by what stage of the
              buying journey it represents:
              <br /><br />
              <strong>Awareness (TOFU)</strong> — &quot;what is
              [your category]?&quot;, &quot;how does it work?&quot;.
              People learning the category.
              <br />
              <strong>Consideration (MOFU)</strong> — &quot;best
              [your category] platform&quot;, &quot;options for [audience]&quot;.
              People comparing solutions.
              <br />
              <strong>Decision (BOFU)</strong> — &quot;[your brand] vs
              [competitor]&quot;, &quot;[your brand] pricing&quot;,
              &quot;reviews&quot;. People close to buying.
              <br /><br />
              Different stages need different content. Strong AI
              presence in BOFU but weak in TOFU means we&apos;re
              winning at the buying stage but missing earlier — buyers
              who don&apos;t hear about us in awareness questions
              never reach the comparison stage.
            </>
          }
        />
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {STAGE_ORDER.map((stage) => (
          <StageCard key={stage} stage={stage} rollup={byStage[stage]} showExamples={showExamples} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------

function StageCard({
  stage,
  rollup,
  showExamples,
}: {
  stage: FunnelStage;
  rollup: StageRollup;
  showExamples: boolean;
}) {
  const meta = STAGE_META[stage];
  const total = rollup.prompt_count;
  const coverage = total > 0 ? rollup.prompt_coverage : null;

  // Coverage tone: green ≥70, amber 40-70, red <40, neutral if no prompts
  const tone =
    coverage === null
      ? "neutral"
      : coverage >= 0.7
        ? "good"
        : coverage >= 0.4
          ? "warn"
          : "bad";
  const toneStyles = TONE_STYLES[tone];

  return (
    <article className="bg-surface border border-hairline rounded-2xl shadow-card overflow-hidden">
      <header
        className="px-4 py-3 border-b border-hairline"
        style={{
          // subtle stage-coloured top accent
          background: `linear-gradient(180deg, ${meta.color}0F 0%, transparent 100%)`,
        }}
      >
        <div className="flex items-baseline justify-between gap-2 mb-0.5">
          <div className="flex items-baseline gap-2">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: meta.color }}
              aria-hidden
            />
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">
              {stage}
            </span>
            <span className="text-sm font-semibold text-ink-900">
              {meta.label}
            </span>
          </div>
          <span className="text-[11px] text-ink-500 tabular-nums">
            {total} prompt{total === 1 ? "" : "s"}
          </span>
        </div>
        <p className="text-[11px] text-ink-600 leading-snug">{meta.description}</p>
      </header>

      <div className="px-4 py-4">
        {total === 0 ? (
          <div className="text-xs text-ink-500 italic py-3">
            No prompts in this stage yet.
          </div>
        ) : (
          <>
            {/* Coverage figure */}
            <div className="flex items-baseline gap-2 mb-3">
              <span
                className={clsx(
                  "text-3xl font-semibold tabular-nums leading-none",
                  toneStyles.value,
                )}
              >
                {coverage !== null ? `${(coverage * 100).toFixed(0)}%` : "—"}
              </span>
              <span className="text-xs text-ink-500">prompt coverage</span>
            </div>

            {/* Classification breakdown */}
            <div className="space-y-1.5 mb-3">
              <CountRow color="emerald" label="Cited" count={rollup.state_counts.A} total={total} />
              {rollup.state_counts.B > 0 && (
                <CountRow color="amber" label="Mentioned, not linked" count={rollup.state_counts.B} total={total} />
              )}
              <CountRow color="red" label="AI doesn't reach us" count={rollup.state_counts.C + rollup.state_counts.D} total={total} />
            </div>

            {showExamples && rollup.prompts_with_examples.length > 0 && (
              <div className="pt-3 border-t border-hairline">
                <div className="text-[10px] uppercase tracking-[0.12em] text-ink-500 font-semibold mb-1.5">
                  Top prompts
                </div>
                <ul className="space-y-1">
                  {rollup.prompts_with_examples.slice(0, 3).map((p) => (
                    <li
                      key={p.prompt_id}
                      className="text-[11px] text-ink-700 leading-snug truncate"
                      title={p.prompt_text}
                    >
                      <span
                        className={clsx(
                          "inline-block w-1 h-1 rounded-full mr-1.5 align-middle",
                          p.state === "A" ? "bg-emerald-500"
                          : p.state === "B" ? "bg-amber-500"
                          : "bg-red-500",
                        )}
                        aria-hidden
                      />
                      {p.prompt_text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------

function CountRow({
  color,
  label,
  count,
  total,
}: {
  color: "emerald" | "amber" | "red";
  label: string;
  count: number;
  total: number;
}) {
  const pct = total > 0 ? count / total : 0;
  const bgClass =
    color === "emerald" ? "bg-emerald-500"
    : color === "amber" ? "bg-amber-500"
    : "bg-red-500";

  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[11px] text-ink-700 min-w-[9rem]">{label}</span>
      <div className="flex-1 h-1.5 bg-surface-muted rounded-full overflow-hidden">
        <div
          className={clsx("h-full rounded-full", bgClass)}
          style={{ width: `${Math.max(pct * 100, count > 0 ? 4 : 0)}%` }}
        />
      </div>
      <span className="text-[11px] font-semibold text-ink-900 tabular-nums w-8 text-right">
        {count}
      </span>
    </div>
  );
}

const TONE_STYLES = {
  good: { value: "text-emerald-700" },
  warn: { value: "text-warning-600" },
  bad: { value: "text-danger-600" },
  neutral: { value: "text-ink-700" },
} as const;

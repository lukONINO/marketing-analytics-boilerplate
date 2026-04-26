/**
 * Prompt Improvements — issue detection over the Peec prompt set.
 *
 * Inputs:
 *   - geoDebug.prompts[]  — every tracked prompt with state + tags
 *   - peecTags             — name + quality flags for the tag dictionary
 *
 * Output: a list of `PromptIssue` objects, each with severity, the
 * affected prompt, a human-readable detail, and a copyable Claude
 * prompt for fixing it. The page renders this as an "Improvements"
 * panel above the per-prompt table.
 *
 * Detection rules are conservative — false positives create busywork.
 * Each rule has a comment explaining the signal it's reading and the
 * fix it implies.
 */

import type { GeoDebugFile, GeoPromptDiagnostic } from "./types";
import type { PeecTagsContext } from "./data";
// PeecTagsContext is exported from `lib/data.ts` (where the loader
// lives). Re-export here so consumers don't need to know the source.
export type { PeecTagsContext } from "./data";

// ---------------------------------------------------------------------
// Tag-id constants — these are stable for your Peec project. Replace
// the placeholders below with your project's actual tag IDs (or move
// them to a config file). Tracked via the geo-debug skill's playbook.
// ---------------------------------------------------------------------

const TAG_TOFU = "tg_REPLACE_WITH_YOUR_TOFU_TAG_ID";
const TAG_MOFU = "tg_REPLACE_WITH_YOUR_MOFU_TAG_ID";
const TAG_BOFU = "tg_REPLACE_WITH_YOUR_BOFU_TAG_ID";
const STAGE_TAGS = new Set([TAG_TOFU, TAG_MOFU, TAG_BOFU]);

const TAG_BRANDED_LOWER = "tg_REPLACE_WITH_YOUR_BRANDED_LOWER_TAG_ID";
const TAG_BRANDED_UPPER = "tg_REPLACE_WITH_YOUR_BRANDED_UPPER_TAG_ID";
const TAG_NON_BRANDED_LOWER = "tg_REPLACE_WITH_YOUR_NON_BRANDED_LOWER_TAG_ID";
const TAG_NON_BRANDED_UPPER = "tg_REPLACE_WITH_YOUR_NON_BRANDED_UPPER_TAG_ID";
const BRANDED_TAGS = new Set([TAG_BRANDED_LOWER, TAG_BRANDED_UPPER]);
const NON_BRANDED_TAGS = new Set([TAG_NON_BRANDED_LOWER, TAG_NON_BRANDED_UPPER]);

const TAG_LANG_EN = "tg_REPLACE_WITH_YOUR_EN_TAG_ID";
const TAG_LANG_DE = "tg_REPLACE_WITH_YOUR_DE_TAG_ID";
const LANG_TAGS = new Set([TAG_LANG_EN, TAG_LANG_DE]);

// Brand-name regex used to detect branded contamination. Set BRAND_REGEX
// in your env to override; defaults to "acme" so the boilerplate stays
// neutral — replace with your actual brand surface(s) in production.
const BRAND_RE = new RegExp(`\\b(?:${process.env.BRAND_REGEX || "acme"})\\b`, "i");
const BRAND_DISPLAY = (process.env.BRAND_DISPLAY_NAME || "your brand");

// ---------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------

export type PromptIssueKind =
  | "branded-contamination"
  | "non-branded-mistag"
  | "missing-stage-tag"
  | "missing-lang-tag"
  | "unmapped-cluster"
  | "tag-duplicate"
  | "tag-malformed"
  | "stale-state-d";

export type PromptIssueSeverity = "high" | "medium" | "low";

export interface PromptIssue {
  /** Stable id for React keys: `<prompt_id>:<kind>`. */
  id: string;
  prompt_id: string;
  prompt_text: string;
  kind: PromptIssueKind;
  severity: PromptIssueSeverity;
  /** Plain-English explanation of what's wrong. */
  detail: string;
  /** What the fix is (read-only summary). */
  suggested_action: string;
  /** Self-contained prompt the user pastes into Claude to do the fix. */
  claude_prompt: string;
}

export const ISSUE_KIND_META: Record<
  PromptIssueKind,
  { label: string; description: string }
> = {
  "branded-contamination": {
    label: "Branded contamination",
    description:
      "Prompt mentions your brand by name but isn't tagged branded — inflates the non-branded visibility metric (anti-pattern).",
  },
  "non-branded-mistag": {
    label: "Mis-tagged as branded",
    description:
      "Prompt is tagged branded but doesn't mention your brand — should be re-tagged non-branded.",
  },
  "missing-stage-tag": {
    label: "Missing funnel-stage tag",
    description:
      "Prompt has no TOFU / MOFU / BOFU tag — falls back to text heuristic (~92% accurate).",
  },
  "missing-lang-tag": {
    label: "Missing language tag",
    description:
      "Prompt has no EN / DE tag — Peec's language slicing won't include it.",
  },
  "unmapped-cluster": {
    label: "Topic not mapped to a cluster",
    description:
      "Prompt's topic_id isn't in `config/topic_clusters.yaml` — the prompt won't appear under any cluster on the dashboard.",
  },
  "tag-duplicate": {
    label: "Affected by tag duplicate",
    description:
      "Prompt uses one of a case-duplicate tag pair (e.g. `branded` vs `Branded`) — Peec splits the same concept into two tags.",
  },
  "tag-malformed": {
    label: "Affected by malformed tag",
    description:
      "Prompt uses a malformed tag (e.g. a prompt fragment committed as a tag).",
  },
  "stale-state-d": {
    label: "Stale state-D prompt",
    description:
      "State D and zero fanout queries — Peec isn't even running the prompt. Candidate to retire or rewrite.",
  },
};

// ---------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------

export function computePromptIssues(
  geoDebug: GeoDebugFile | null,
  peecTags: PeecTagsContext | null,
  knownClusterSlugs: Set<string>,
): PromptIssue[] {
  if (!geoDebug || !geoDebug.prompts) return [];

  const out: PromptIssue[] = [];
  const tagNameById = new Map((peecTags?.tags ?? []).map((t) => [t.id, t.name]));

  // Pre-compute the set of tag ids covered by any tag-quality flag.
  // We use these to decorate prompts that touch a duplicate / malformed
  // tag with a hint, even though the underlying issue is at the tag
  // level, not the prompt level.
  const dupTagIds = new Set<string>();
  const malformedTagIds = new Set<string>();
  for (const flag of peecTags?.tag_quality_flags ?? []) {
    if (flag.issue === "case_duplicate") {
      for (const id of flag.tag_ids) dupTagIds.add(id);
    } else if (flag.issue === "malformed_name") {
      malformedTagIds.add(flag.tag_id);
    }
  }

  for (const p of geoDebug.prompts) {
    const tagIds = p.tag_ids ?? [];
    const hasBrand = BRAND_RE.test(p.prompt_text);
    const isTaggedBranded = tagIds.some((t) => BRANDED_TAGS.has(t));
    const isTaggedNonBranded = tagIds.some((t) => NON_BRANDED_TAGS.has(t));
    const hasStageTag = tagIds.some((t) => STAGE_TAGS.has(t));
    const hasLangTag = tagIds.some((t) => LANG_TAGS.has(t));

    // ----- Branded contamination -----
    // Prompt has the brand name in the text but is tagged non-branded
    // (or has no branded tag at all). Visibility on these is artificially
    // high because the brand name is in the question itself — mixing them
    // with non-branded prompts inflates the non-branded score.
    if (hasBrand && !isTaggedBranded) {
      out.push({
        id: `${p.prompt_id}:branded-contamination`,
        prompt_id: p.prompt_id,
        prompt_text: p.prompt_text,
        kind: "branded-contamination",
        severity: "high",
        detail:
          `Prompt text contains "${BRAND_DISPLAY}" but the prompt isn't tagged with the branded tag (${tagNameById.get(TAG_BRANDED_LOWER) ?? "branded"}). ` +
          (isTaggedNonBranded
            ? "Currently tagged non-branded — that's the contamination."
            : "It has no branded/non-branded tag at all."),
        suggested_action: isTaggedNonBranded
          ? "Swap the non-branded tag for the branded tag in Peec."
          : "Add the branded tag in Peec.",
        claude_prompt: buildRetagPrompt(p, {
          add: [TAG_BRANDED_LOWER],
          remove: isTaggedNonBranded
            ? [TAG_NON_BRANDED_LOWER, TAG_NON_BRANDED_UPPER]
            : [],
          reason: `branded contamination — prompt contains brand name but isn't tagged branded`,
        }),
      });
    }

    // ----- Mis-tagged as branded -----
    // Inverse of the above. Tagged branded but no brand name in text.
    // Only flag when the prompt has clear category/non-branded framing
    // ("best", "vs", "comparison" without a brand mentioned).
    if (!hasBrand && isTaggedBranded) {
      out.push({
        id: `${p.prompt_id}:non-branded-mistag`,
        prompt_id: p.prompt_id,
        prompt_text: p.prompt_text,
        kind: "non-branded-mistag",
        severity: "medium",
        detail:
          `Prompt is tagged branded but doesn't mention your brand — branded should mean the brand is in the question itself.`,
        suggested_action: "Swap the branded tag for non-branded in Peec.",
        claude_prompt: buildRetagPrompt(p, {
          add: [TAG_NON_BRANDED_LOWER],
          remove: [TAG_BRANDED_LOWER, TAG_BRANDED_UPPER],
          reason: `non-branded mistag — prompt doesn't mention your brand`,
        }),
      });
    }

    // ----- Missing funnel-stage tag -----
    if (!hasStageTag) {
      out.push({
        id: `${p.prompt_id}:missing-stage-tag`,
        prompt_id: p.prompt_id,
        prompt_text: p.prompt_text,
        kind: "missing-stage-tag",
        severity: "medium",
        detail:
          `No TOFU / MOFU / BOFU tag on this prompt. The dashboard falls back to a text heuristic (~92% accurate); persisting the canonical tag gets it to 100%. ` +
          (p.stage ? `Heuristic guess: ${p.stage}.` : ""),
        suggested_action:
          "Add the matching funnel-stage tag (TOFU / MOFU / BOFU) in Peec.",
        claude_prompt: `add a funnel-stage tag to Peec prompt ${p.prompt_id}: "${p.prompt_text}"
Read the prompt text and decide TOFU / MOFU / BOFU:
  - TOFU = awareness ("what is", "how does", "why")
  - MOFU = consideration ("best X", "platforms for Y", "X vs Y")
  - BOFU = decision ("[your brand] vs Competitor A", "[your brand] pricing", "[your brand] reviews")
${p.stage ? `Heuristic suggests: ${p.stage}.` : ""}
Use the Peec MCP update_prompt tool to add the matching tag id:
  - TOFU = ${TAG_TOFU}
  - MOFU = ${TAG_MOFU}
  - BOFU = ${TAG_BOFU}`,
      });
    }

    // ----- Missing language tag -----
    if (!hasLangTag) {
      out.push({
        id: `${p.prompt_id}:missing-lang-tag`,
        prompt_id: p.prompt_id,
        prompt_text: p.prompt_text,
        kind: "missing-lang-tag",
        severity: "low",
        detail:
          `No EN / DE language tag. The dashboard derives language from the prompt text (umlauts + German tokens), but Peec's own slicing won't see it.`,
        suggested_action:
          "Add the EN or DE tag in Peec based on the prompt's actual language.",
        claude_prompt: `add a language tag to Peec prompt ${p.prompt_id}: "${p.prompt_text}"
Detected language: ${p.lang.toUpperCase()}.
Use the Peec MCP update_prompt tool to add tag id:
  - EN = ${TAG_LANG_EN}
  - DE = ${TAG_LANG_DE}`,
      });
    }

    // ----- Unmapped cluster -----
    // The prompt has a topic_id but it doesn't map to any cluster slug
    // in our config. Either the topic is new and we forgot to add it,
    // or it's been removed and we should clean up.
    if (p.cluster && !knownClusterSlugs.has(p.cluster)) {
      out.push({
        id: `${p.prompt_id}:unmapped-cluster`,
        prompt_id: p.prompt_id,
        prompt_text: p.prompt_text,
        kind: "unmapped-cluster",
        severity: "high",
        detail:
          `The prompt's topic_id (${p.topic_id}) maps to cluster slug "${p.cluster}" which isn't in config/topic_clusters.yaml. The prompt won't appear under any cluster.`,
        suggested_action:
          "Either add the topic to an existing cluster's peec_topic_ids, or create a new cluster.",
        claude_prompt: `the prompt "${p.prompt_text}" has topic_id ${p.topic_id} which currently maps to cluster slug "${p.cluster}", but that slug isn't defined in config/topic_clusters.yaml. Either:
  1. Add ${p.topic_id} to the peec_topic_ids list of an existing cluster, or
  2. Create a new cluster with this topic.
Open config/topic_clusters.yaml and decide which cluster best fits the prompt's intent. Then commit + re-run aggregate_daily.py to fold the change in.`,
      });
    }
    // Cluster-null case (no topic mapping at all) — also unmapped.
    if (!p.cluster) {
      out.push({
        id: `${p.prompt_id}:unmapped-cluster`,
        prompt_id: p.prompt_id,
        prompt_text: p.prompt_text,
        kind: "unmapped-cluster",
        severity: "high",
        detail:
          `The prompt has no cluster assignment. Either its topic_id (${p.topic_id}) isn't in any peec_topic_ids list in config/topic_clusters.yaml, or the prompt has no topic at all.`,
        suggested_action: "Assign the topic_id to a cluster in topic_clusters.yaml.",
        claude_prompt: `assign Peec topic_id ${p.topic_id} (used by prompt "${p.prompt_text}") to a cluster. Open config/topic_clusters.yaml, pick the right cluster, add the topic_id under that cluster's peec_topic_ids list, then commit + re-run aggregate_daily.py.`,
      });
    }

    // ----- Tag duplicate / malformed -----
    const dupHits = tagIds.filter((t) => dupTagIds.has(t));
    if (dupHits.length > 0) {
      const dupNames = dupHits.map((id) => tagNameById.get(id) ?? id);
      out.push({
        id: `${p.prompt_id}:tag-duplicate`,
        prompt_id: p.prompt_id,
        prompt_text: p.prompt_text,
        kind: "tag-duplicate",
        severity: "low",
        detail:
          `Prompt uses ${dupNames.length === 1 ? "a tag" : "tags"} that's part of a case-duplicate pair (${dupNames.join(", ")}). The dashboard's lowercase-merge handles this transparently, but the underlying Peec data is split.`,
        suggested_action: "Consolidate duplicate tags in the Peec project.",
        claude_prompt: `consolidate the case-duplicate tag pair ${dupHits.join(", ")} (names: ${dupNames.join(", ")}) in the Peec project. Use Peec MCP to (a) move all prompts off the duplicate, (b) delete the duplicate. Then re-pull peec data so geo_debug.json reflects the cleanup.`,
      });
    }
    const malHits = tagIds.filter((t) => malformedTagIds.has(t));
    if (malHits.length > 0) {
      out.push({
        id: `${p.prompt_id}:tag-malformed`,
        prompt_id: p.prompt_id,
        prompt_text: p.prompt_text,
        kind: "tag-malformed",
        severity: "low",
        detail:
          `Prompt uses a malformed tag (${malHits.map((id) => tagNameById.get(id) ?? id).join(", ")}). Looks like a prompt fragment was accidentally committed as a tag.`,
        suggested_action: "Remove the malformed tag from the Peec project.",
        claude_prompt: `the malformed Peec tag ${malHits.join(", ")} (likely a prompt fragment committed as a tag) is currently applied to prompt ${p.prompt_id}. Use Peec MCP to remove the tag from the prompt and delete the tag from the project.`,
      });
    }

    // ----- Stale state-D -----
    // State D + zero fanout = Peec isn't running the prompt OR no
    // search ever fires for it. Suggests retire/rewrite.
    if (p.state === "D" && (p.fanout_count ?? 0) === 0) {
      out.push({
        id: `${p.prompt_id}:stale-state-d`,
        prompt_id: p.prompt_id,
        prompt_text: p.prompt_text,
        kind: "stale-state-d",
        severity: "low",
        detail:
          `State D with no fanout queries — AI engines aren't running this prompt. Either the prompt phrasing yields no results, or it's structurally a non-question.`,
        suggested_action:
          "Rewrite the prompt or retire it. Pure category prompts (e.g. '[your industry term]') don't generate fanout — phrase as a buyer question.",
        claude_prompt: `Peec prompt ${p.prompt_id} ("${p.prompt_text}") is in State D with zero fanout. Either rewrite it as a buyer-question (e.g. "what is X" → "best X for use case Y"), or retire it. Recommend a rewrite that targets the same cluster (${p.cluster_display ?? p.cluster ?? "unknown"}, ${p.lang}).`,
      });
    }
  }

  // Sort: severity desc, then by prompt_id for stability.
  const SEV: Record<PromptIssueSeverity, number> = { high: 0, medium: 1, low: 2 };
  out.sort(
    (a, b) =>
      SEV[a.severity] - SEV[b.severity] || a.prompt_id.localeCompare(b.prompt_id),
  );
  return out;
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function buildRetagPrompt(
  p: GeoPromptDiagnostic,
  opts: { add: string[]; remove: string[]; reason: string },
): string {
  const lines = [
    `re-tag Peec prompt ${p.prompt_id}: "${p.prompt_text}"`,
    `Reason: ${opts.reason}.`,
  ];
  if (opts.add.length > 0) lines.push(`Add tag id(s): ${opts.add.join(", ")}`);
  if (opts.remove.length > 0) lines.push(`Remove tag id(s): ${opts.remove.join(", ")}`);
  lines.push(
    "Use the Peec MCP update_prompt tool. After the change, re-pull peec data so geo_debug.json reflects the new state.",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------
// Quick aggregates for the page header
// ---------------------------------------------------------------------

export interface PromptsHealthSummary {
  total: number;
  by_state: Record<"A" | "B" | "C" | "D", number>;
  by_stage: Record<"TOFU" | "MOFU" | "BOFU" | "unknown", number>;
  by_lang: Record<"en" | "de", number>;
  with_issues: number;
  /** Issues count by kind. */
  issue_counts: Record<PromptIssueKind, number>;
}

export function computePromptsHealthSummary(
  geoDebug: GeoDebugFile | null,
  issues: PromptIssue[],
): PromptsHealthSummary {
  const summary: PromptsHealthSummary = {
    total: geoDebug?.prompts?.length ?? 0,
    by_state: { A: 0, B: 0, C: 0, D: 0 },
    by_stage: { TOFU: 0, MOFU: 0, BOFU: 0, unknown: 0 },
    by_lang: { en: 0, de: 0 },
    with_issues: 0,
    issue_counts: {
      "branded-contamination": 0,
      "non-branded-mistag": 0,
      "missing-stage-tag": 0,
      "missing-lang-tag": 0,
      "unmapped-cluster": 0,
      "tag-duplicate": 0,
      "tag-malformed": 0,
      "stale-state-d": 0,
    },
  };
  for (const p of geoDebug?.prompts ?? []) {
    summary.by_state[p.state] += 1;
    if (p.stage === "TOFU" || p.stage === "MOFU" || p.stage === "BOFU") {
      summary.by_stage[p.stage] += 1;
    } else {
      summary.by_stage.unknown += 1;
    }
    if (p.lang === "en") summary.by_lang.en += 1;
    else if (p.lang === "de") summary.by_lang.de += 1;
  }
  const promptsWithIssues = new Set<string>();
  for (const i of issues) {
    summary.issue_counts[i.kind] += 1;
    promptsWithIssues.add(i.prompt_id);
  }
  summary.with_issues = promptsWithIssues.size;
  return summary;
}

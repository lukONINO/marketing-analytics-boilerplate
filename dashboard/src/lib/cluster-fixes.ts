/**
 * Cluster fix-list builders — pure data, server-safe.
 *
 * These were originally co-located with `<ClusterFixList>` in
 * `components/ClusterFixList.tsx`, but Next.js's `"use client"`
 * boundary turns every export of that file into a client-reference
 * proxy at build time. Server components calling the builders
 * directly hit:
 *
 *   "Attempted to call buildSiteFixList() from the server but
 *    buildSiteFixList is on the client."
 *
 * Splitting fixes that — the component stays client (it has hover
 * states + `<a onClick>` handlers), the builders live here in a
 * plain module so server pages can import + invoke them at render.
 */

import type { Insight, SourceGapDomain } from "@/lib/types";

// ---------------------------------------------------------------------
// Shape of a single row in the fix list.
// ---------------------------------------------------------------------

export interface ClusterFix {
  /** Stable id for React keys. */
  id: string;
  /**
   * What kind of attention this row needs:
   *   - "on-page"  — fix something on your site (rule-computed audit)
   *   - "outreach" — third-party citation gap (Peec source-gap)
   *   - "finding"  — Claude-written observation (insight)
   *
   * Visual badge is rendered per-kind on the dashboard.
   */
  kind: "on-page" | "outreach" | "finding";
  /** Severity for sort + tone. */
  severity: "high" | "medium" | "low";
  /** Headline — what to do. */
  title: string;
  /** One-line context — the truncated preview shown in the row. */
  detail: string;
  /** Optional URL — site page for on-page fixes, or insight evidence URL for findings. */
  url?: string;
  /** Cluster slug — set on site-wide lists to show which cluster this fix
   *  belongs to. Omitted on per-cluster lists (the page header carries
   *  that context). */
  cluster_slug?: string;
  /** Display name for the cluster — only used when `cluster_slug` is set. */
  cluster_label?: string;

  // ----- Drawer-only fields (populated for findings; optional for fixes) -----

  /**
   * Full body — only populated for `kind === "finding"`. Carries the
   * entire insight body so the drawer can render it without a second
   * fetch. Fixes don't have a richer text than `detail`.
   */
  body_full?: string;
  /** Insight tags (kebab-case) — only for findings. */
  tags?: string[];
  /** Insight `source_date` — what date the finding concerns. Findings only. */
  source_date?: string | null;
  /** Additional URLs from the insight — findings can link multiple references. */
  linked_urls?: string[];

  /**
   * Self-contained Claude prompt the user can paste to ask Claude to
   * implement / draft / progress this row. Populated for task rows
   * (kind on-page / outreach); usually empty for findings (which are
   * observations, not actions). Drives the "Copy prompt" button.
   */
  claude_prompt?: string;

  /**
   * Insight metadata — populated only when `kind === "finding"`. The
   * dashboard's drawer reads these to render the InsightActions button
   * row (Mark reviewed / Archive / Re-open / Delete). The id here is
   * the CANONICAL insight id (no `find:` prefix); `ClusterFix.id`
   * still has the prefix for React keys.
   */
  insight_id?: string;
  /** Current insight status — drives which transitions InsightActions offers. */
  insight_status?: "open" | "reviewed" | "archived";
}

// ---------------------------------------------------------------------
// Page-type filter — exclude index/category/aggregator URLs from
// thin-content opportunities.
//
// Rationale: visibility_improvements.py flags any page below the word
// threshold as THIN_BUT_TRAFFICKED. That's correct for substantive
// pages but creates noise for index pages whose job is to LIST other
// pages — the blog index isn't supposed to have 1500 words of body
// copy, it's supposed to be a directory.
//
// Patterns are conservative: only obvious aggregator endpoints. The
// homepage stays in (415 words on a homepage IS a real signal — most
// homepages should be substantive) and individual blog posts stay in.
// ---------------------------------------------------------------------

const INDEX_PAGE_PATTERNS: RegExp[] = [
  /\/blog\/?$/i,           // /blog, /blog/
  /\/de\/blog\/?$/i,       // /de/blog
  /\/category\/?$/i,
  /\/categories\/?$/i,
  /\/tag\/?$/i,
  /\/tags\/?$/i,
  /\/news\/?$/i,
  /\/press\/?$/i,
  /\/resources\/?$/i,
  /\/de\/ressourcen\/?$/i, // DE equivalent
];

function isIndexPage(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const path = new URL(url).pathname;
    return INDEX_PAGE_PATTERNS.some((re) => re.test(path));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
// Per-cluster builder — the one used by `/topics/[slug]`.
// ---------------------------------------------------------------------

/**
 * Plain-English titles for the rule-codes the visibility-improvements
 * pipeline emits. Lives next to the consumer because adding a new rule
 * requires updating the dashboard wording anyway.
 *
 * THIN_BUT_TRAFFICKED was retired 2026-04-26 — it's filtered out below
 * in `RETIRED_RULES`. Title kept here for any stragglers we might
 * accidentally render from old data, but the rule should never make
 * it into the action stream now.
 */
const VISIBILITY_RULE_TITLES: Record<string, string> = {
  RANK_WITHOUT_SCHEMA:    "Add schema markup",
  RANKER_WITHOUT_CLAIMS:  "Add numeric claims",
  LOW_CTR_WEAK_META:      "Rewrite meta description",
  BILINGUAL_GAP:          "Mirror in other language",
  CLUSTER_VISIBILITY_LAG: "Cluster lagging — invest in pillar page",
  ORPHAN_LONGFORM:        "Add internal links to this page",
};

/**
 * Per-rule Claude prompts for the on-page action stream. Each prompt
 * is self-contained — the user pastes it into Claude Code / Cowork and
 * Claude has enough context to do the work without a second turn.
 *
 * Variables (interpolated by `deriveOnPagePrompt` below):
 *   {url}      — the page URL (when set)
 *   {title}    — page title or rule-default title
 *   {cluster}  — cluster slug
 *   {lang}     — "en" | "de"
 */
const ON_PAGE_CLAUDE_PROMPTS: Record<string, string> = {
  RANK_WITHOUT_SCHEMA:
    "draft schema markup for {url}: read the current scrape, propose Article+FAQPage+Organization JSON-LD with author, datePublished, image, and 3 FAQ entries derived from the cluster's top GSC queries. Output the exact JSON-LD blocks to paste into your CMS.",
  RANKER_WITHOUT_CLAIMS:
    "inject numeric claims into {url}: read data/knowledge/proof-points.json + the cluster context, propose 3+ quantified statements (e.g. customer counts, deployment time, regulatory coverage, [your domain-specific metrics]) with the exact paragraphs they belong in. Use existing proof points — don't fabricate.",
  LOW_CTR_WEAK_META:
    "rewrite the title + meta description for {url}: pull current values from the latest scrape, write a new title (≥50 chars, includes the cluster term + an outcome number) and a meta description (1 claim + 1 CTA, ≤160 chars). Output both new strings only.",
  BILINGUAL_GAP:
    "draft a mirror page for the {cluster} cluster in {lang}: pick the highest-traffic counterpart page, translate it idiomatically (not literal), keep the schema, and adjust customer references to the {lang} market. Output the full page body.",
  CLUSTER_VISIBILITY_LAG:
    "draft a pillar page for the {cluster} cluster in {lang}: ≥1500 words, FAQPage schema, ≥5 numeric claims, decision table, and links from every existing cluster leaf page. Pull buyer intent from data/dashboard/geo_debug.json prompts in this cluster.",
  ORPHAN_LONGFORM:
    "audit {url} for missing inbound internal links: identify 5+ existing pages on your site that should link to it (same cluster, same lang preferred), draft the link text + target paragraph for each. Output the exact diffs.",
};

function deriveOnPagePrompt(opp: BuildFixListInputs["opportunities"][number]): string | undefined {
  const tpl = ON_PAGE_CLAUDE_PROMPTS[opp.rule];
  if (!tpl) return undefined;
  return tpl
    .replaceAll("{url}", opp.url || `the ${opp.cluster} cluster`)
    .replaceAll("{title}", opp.title ?? "")
    .replaceAll("{cluster}", opp.cluster)
    .replaceAll("{lang}", opp.lang);
}

function deriveOutreachPrompt(domain: string, cluster: string): string {
  return `draft an outreach email to ${domain} for the ${cluster} cluster: read data/dashboard/source_gaps.json to see which prompts AI cites this domain for, draft a one-paragraph pitch citing 2-3 of your differentiators ([describe your product positioning]), and propose the URL on your site we'd want them to link. Output the email body + suggested subject line only.`;
}

/**
 * Rules retired from the action stream. Stragglers in old
 * `visibility_improvements.json` files get filtered out at read time
 * so they never surface to the user, even before the next pipeline
 * run rewrites the file. Single source of truth for "Claude owns this
 * judgment now" decisions.
 */
const RETIRED_RULES = new Set<string>([
  "THIN_BUT_TRAFFICKED",
]);

export interface BuildFixListInputs {
  cluster: string;
  /** Visibility opportunities pre-filtered to this cluster. */
  opportunities: Array<{
    id: string;
    rule: string;
    severity: "high" | "medium" | "low";
    cluster: string;
    lang: "en" | "de";
    url: string;
    title: string | null;
    fix: string;
  }>;
  /** Source gap data for this cluster (en + de combined). */
  topCitedDomains: SourceGapDomain[];
}

/**
 * Combine the two sources into a prioritized list. Rules:
 *   - High-severity opportunities first (limit 4)
 *   - Then top source-gap domains where competitors are co-cited (limit 4)
 *   - Then medium-severity opportunities (limit 2)
 *   - Hard cap at 6 to keep the page scannable
 *
 * If you find yourself wanting to show 20 items, you should be on the
 * cluster-detail page's deeper drill-down (prompts table for state-D
 * gaps; pages table for thin content), not here. This list is the
 * shortlist of "actually do something this week".
 */
export function buildClusterFixList(inputs: BuildFixListInputs): ClusterFix[] {
  const fixes: ClusterFix[] = [];

  // Filter at the dashboard layer — two cuts:
  //   1. Retired rules (Claude owns the judgment now)
  //   2. Index/aggregator URLs (/blog, /category, etc.)
  // Cluster-level rules with empty URL pass through — they target the
  // cluster as a whole, not a specific page.
  const filteredOpps = inputs.opportunities.filter((o) => {
    if (RETIRED_RULES.has(o.rule)) return false;
    if (o.url && isIndexPage(o.url)) return false;
    return true;
  });
  const sortedOpps = [...filteredOpps].sort((a, b) => {
    const SEV = { high: 0, medium: 1, low: 2 };
    return SEV[a.severity] - SEV[b.severity];
  });

  // Pass 1: high-severity opportunities (on-page fixes)
  for (const o of sortedOpps) {
    if (o.severity !== "high") continue;
    if (fixes.length >= 4) break;
    fixes.push({
      id: `opp:${o.id}`,
      kind: "on-page",
      severity: o.severity,
      title: o.title || VISIBILITY_RULE_TITLES[o.rule] || "Visibility fix",
      detail: o.fix,
      url: o.url || undefined,
      claude_prompt: deriveOnPagePrompt(o),
    });
  }

  // Pass 2: top source-gap domains
  const competitorDomains = inputs.topCitedDomains
    .filter((d) => d.onino_co_cited_count === 0 && d.times_cited >= 2)
    .slice(0, 4);
  for (const d of competitorDomains) {
    if (fixes.length >= 5) break;
    fixes.push({
      id: `gap:${d.domain}`,
      kind: "outreach",
      severity: d.times_cited >= 5 ? "high" : "medium",
      title: `Add your brand to ${d.domain}`,
      detail: `AI cites ${d.domain} in ${d.times_cited} prompt${d.times_cited === 1 ? "" : "s"} about this cluster but never alongside your brand.`,
      url: undefined,
      claude_prompt: deriveOutreachPrompt(d.domain, inputs.cluster),
    });
  }

  // Pass 3: medium-severity opportunities to fill remaining slots
  for (const o of sortedOpps) {
    if (o.severity !== "medium") continue;
    if (fixes.length >= 6) break;
    fixes.push({
      id: `opp:${o.id}`,
      kind: "on-page",
      severity: o.severity,
      title: o.title || VISIBILITY_RULE_TITLES[o.rule] || "Visibility fix",
      detail: o.fix,
      url: o.url || undefined,
      claude_prompt: deriveOnPagePrompt(o),
    });
  }

  return fixes;
}

// ---------------------------------------------------------------------
// Site-wide builder — aggregates per-cluster lists across every
// cluster, optionally merges in Claude-written insights, and tags
// each row with the cluster slug + label so the user knows where to
// act.
//
// One section, three sources:
//   1. On-page rule-based audits     (visibility_improvements.json)
//   2. Outreach citation gaps        (source_gaps.json)
//   3. Claude-written findings       (insights.json — warning + critical)
//
// Splitting these previously created two surfaces ("Things to fix"
// + "Recent findings") that the user had to mentally merge anyway.
// One ranked list keeps the hierarchy honest.
// ---------------------------------------------------------------------

export interface BuildSiteFixListInputs {
  /** Every visibility opportunity (across all clusters). */
  opportunities: BuildFixListInputs["opportunities"];
  /** Map: cluster slug → top-cited domain rows (en + de pre-merged). */
  domainsByCluster: Map<string, SourceGapDomain[]>;
  /** Map: cluster slug → display label (English name). */
  labelByCluster: Map<string, string>;
  /**
   * Claude-written insights to fold into the action stream.
   *
   * Only `critical` + `warning` insights surface here — `info`
   * insights are routine observations that don't belong in an action
   * list. If you want the full insight stream, view `insights.json`
   * directly (no full-list dashboard page exists today; the file is
   * the archive).
   *
   * Insights without a recognizable cluster slug in `tags` still
   * appear, just without a cluster chip.
   */
  insights?: Insight[];
  /** Hard cap on the merged list. Defaults to 10. */
  limit?: number;
}

export function buildSiteFixList(inputs: BuildSiteFixListInputs): ClusterFix[] {
  const all: ClusterFix[] = [];

  // ----- Per-cluster fixes (on-page + outreach) -----
  const oppsByCluster = new Map<string, BuildFixListInputs["opportunities"]>();
  for (const o of inputs.opportunities) {
    const list = oppsByCluster.get(o.cluster) ?? [];
    list.push(o);
    oppsByCluster.set(o.cluster, list);
  }

  const allClusters = new Set([
    ...Array.from(oppsByCluster.keys()),
    ...Array.from(inputs.domainsByCluster.keys()),
  ]);

  for (const cluster of allClusters) {
    const label = inputs.labelByCluster.get(cluster) ?? cluster;
    const opps = oppsByCluster.get(cluster) ?? [];
    const domains = inputs.domainsByCluster.get(cluster) ?? [];
    const fixes = buildClusterFixList({
      cluster,
      opportunities: opps,
      topCitedDomains: domains,
    });
    for (const f of fixes) {
      all.push({
        ...f,
        id: `${cluster}:${f.id}`,
        cluster_slug: cluster,
        cluster_label: label,
      });
    }
  }

  // ----- Findings (Claude-written insights — the primary source) -----
  // Claude is the primary writer for findings, improvements, and flags
  // (per `dashboard-sync.md`'s 2026-04-26 contract update). Rule-based
  // items become a secondary mechanical floor that surfaces only when
  // there's not enough Claude-written depth to fill the action stream.
  //
  // Take up to 8 findings (out of the 10-row default cap) so a healthy
  // pipeline of weekly/daily Claude routines fully populates the
  // stream without rule rows. If Claude hasn't written enough findings
  // recently, rule rows fill the remaining slots.
  const findings = (inputs.insights ?? [])
    .filter((ins) => ins.status === "open" || ins.status === undefined)
    .filter((ins) => ins.severity === "critical" || ins.severity === "warning")
    .slice(0, 8)
    .map((ins) => insightToFix(ins, inputs.labelByCluster));
  all.push(...findings);

  // ----- Sort + cap -----
  // Priority order:
  //   1. By severity desc (critical/high → warning/medium → info/low)
  //   2. Within same severity: findings FIRST, then on-page, then outreach.
  //      Findings carry richer reasoning (verification gates 1–4 per
  //      dashboard-sync.md), so they earn primary placement. On-page
  //      and outreach rules are still surfaced for coverage but defer
  //      to findings when both apply.
  const SEV: Record<ClusterFix["severity"], number> = { high: 0, medium: 1, low: 2 };
  const KIND: Record<ClusterFix["kind"], number> = { finding: 0, "on-page": 1, outreach: 2 };
  all.sort((a, b) => SEV[a.severity] - SEV[b.severity] || KIND[a.kind] - KIND[b.kind]);
  return all.slice(0, inputs.limit ?? 10);
}

// ---------------------------------------------------------------------
// Insight → ClusterFix mapping
//
// Maps the insight severity scale (critical / warning / info) onto the
// fix severity scale (high / medium / low) so the unified action list
// can sort across both. Detail truncation: 200 chars to keep rows
// scannable; the full body lives in insights.json for anyone who wants
// to dig deeper.
// ---------------------------------------------------------------------

function insightToFix(ins: Insight, labelByCluster: Map<string, string>): ClusterFix {
  const SEV_MAP: Record<Insight["severity"], ClusterFix["severity"]> = {
    critical: "high",
    warning: "medium",
    info: "low",
  };

  // Pull the first cluster slug out of `tags` if any of them match a
  // known cluster. The tag-set is small and ad-hoc so we just intersect
  // with the label map. First match wins.
  let clusterSlug: string | undefined;
  let clusterLabel: string | undefined;
  for (const tag of ins.tags ?? []) {
    if (labelByCluster.has(tag)) {
      clusterSlug = tag;
      clusterLabel = labelByCluster.get(tag);
      break;
    }
  }

  const detail = (ins.body ?? "").split(/\n\n/)[0].slice(0, 200);

  return {
    id: `find:${ins.id}`,
    kind: "finding",
    severity: SEV_MAP[ins.severity],
    title: ins.title,
    detail: detail || "(no body)",
    url: ins.linked_urls?.[0],
    cluster_slug: clusterSlug,
    cluster_label: clusterLabel,
    body_full: ins.body,
    tags: ins.tags,
    source_date: ins.source_date,
    linked_urls: ins.linked_urls,
    insight_id: ins.id,
    insight_status: ins.status,
  };
}

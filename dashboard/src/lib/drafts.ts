/**
 * Page-draft loader.
 *
 * Claude writes new-page drafts into `data/drafts/pages/*.md` per the
 * `page-drafts.md` skill contract. Each draft is markdown with YAML
 * frontmatter. The settings page lists them; users copy-paste the body
 * into their CMS (Webflow/Framer/etc.) when ready to publish.
 *
 * No mutations — this is a read-only surface. Users mark drafts as
 * "published" by asking Claude to update the frontmatter.
 */

import path from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";

const REPO_ROOT = path.resolve(process.cwd(), "..");
const DRAFTS_DIR = path.join(REPO_ROOT, "data", "drafts", "pages");

export type DraftStatus = "draft" | "review" | "ready" | "published";

export interface PageDraft {
  /** Filename stem without the .md extension, used as React key. */
  filename: string;
  /** Draft identifier from frontmatter. */
  id: string | null;
  /** Working title. */
  title: string | null;
  /** Target URL slug, e.g. /solutions/your-solution */
  slug: string | null;
  /** Suggested meta description. */
  meta_description: string | null;
  /** Lifecycle stage. */
  status: DraftStatus;
  /** Suggested schema.org types to wire up on the live page. */
  schema_suggestions: string[];
  /** Task that motivated this draft (tsk_...) — optional. */
  source_task: string | null;
  /** Target CMS / language — informational. */
  target_language: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** Word count of the markdown body (excludes frontmatter). */
  word_count: number;
  /** Full markdown body (no frontmatter). */
  body: string;
}

/**
 * Parse the YAML frontmatter block of a markdown file. We only need a
 * tiny subset (no full YAML spec): simple `key: value` and
 * `key: [a, b]` forms. Nested / multiline YAML is not supported —
 * draft authors must keep values flat per the skill contract.
 */
function parseFrontmatter(md: string): { fm: Record<string, unknown>; body: string } {
  if (!md.startsWith("---\n")) return { fm: {}, body: md };
  const end = md.indexOf("\n---", 4);
  if (end < 0) return { fm: {}, body: md };
  const fmText = md.slice(4, end);
  const body = md.slice(end + 4).replace(/^\n+/, "");

  const fm: Record<string, unknown> = {};
  for (const rawLine of fmText.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    if (!val) {
      fm[key] = null;
    } else if (val.startsWith("[") && val.endsWith("]")) {
      // [a, b, c] → array of strings
      fm[key] = val.slice(1, -1).split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
    } else {
      fm[key] = val.replace(/^['"]|['"]$/g, "");
    }
  }
  return { fm, body };
}

function toStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function toStatus(v: unknown): DraftStatus {
  if (v === "draft" || v === "review" || v === "ready" || v === "published") return v;
  return "draft";
}

/**
 * Load all drafts, sorted by updated_at desc (newest first). Returns
 * an empty array if the directory doesn't exist yet.
 */
export async function loadDrafts(): Promise<PageDraft[]> {
  try {
    await stat(DRAFTS_DIR);
  } catch {
    return [];
  }
  const files = (await readdir(DRAFTS_DIR)).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
  const drafts: PageDraft[] = [];
  for (const f of files) {
    try {
      const raw = await readFile(path.join(DRAFTS_DIR, f), "utf-8");
      const { fm, body } = parseFrontmatter(raw);
      drafts.push({
        filename: f.replace(/\.md$/, ""),
        id: toStringOrNull(fm.id),
        title: toStringOrNull(fm.title),
        slug: toStringOrNull(fm.slug),
        meta_description: toStringOrNull(fm.meta_description),
        status: toStatus(fm.status),
        schema_suggestions: toStringArray(fm.schema_suggestions),
        source_task: toStringOrNull(fm.source_task),
        target_language: toStringOrNull(fm.target_language),
        created_at: toStringOrNull(fm.created_at),
        updated_at: toStringOrNull(fm.updated_at),
        word_count: body.trim().split(/\s+/).filter(Boolean).length,
        body,
      });
    } catch {
      // Skip unreadable files; surfacing an error per-file isn't worth the noise.
    }
  }

  drafts.sort((a, b) => {
    const at = a.updated_at ?? a.created_at ?? "";
    const bt = b.updated_at ?? b.created_at ?? "";
    return bt.localeCompare(at);
  });
  return drafts;
}

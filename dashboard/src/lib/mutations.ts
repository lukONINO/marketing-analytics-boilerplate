/**
 * Shared mutation helpers for insights + tasks.
 *
 * Until now the dashboard was strictly read-only (Claude wrote,
 * dashboard read). The UI now needs to mutate in two cases:
 *   - User archives/deletes an insight
 *   - User drags a task to a new column, or archives/deletes a task
 *
 * Writes go through atomic `.tmp → rename` so a crashed write never
 * leaves a partial file for the dashboard to render. Claude's own
 * writes (via the Write tool) use the same JSON shape — no contract
 * change, just a second writer.
 */

import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

import type {
  ClusterOverride,
  ClusterOverridesFile,
  CustomCluster,
  CustomClustersFile,
  Insight,
  InsightsFile,
  PillarPagesFile,
  PromptIssueDismissal,
  PromptIssueDismissalsFile,
  Task,
  TasksFile,
} from "./types";

const REPO_ROOT = path.resolve(process.cwd(), "..");
const DASHBOARD_DIR = path.join(REPO_ROOT, "data", "dashboard");
const INSIGHTS_PATH = path.join(DASHBOARD_DIR, "insights.json");
const TASKS_PATH = path.join(DASHBOARD_DIR, "tasks.json");
const PILLAR_PAGES_PATH = path.join(DASHBOARD_DIR, "pillar_pages.json");
const OVERRIDES_PATH = path.join(DASHBOARD_DIR, "cluster_overrides.json");
const CUSTOM_CLUSTERS_PATH = path.join(DASHBOARD_DIR, "custom_clusters.json");
const PROMPT_ISSUE_DISMISSALS_PATH = path.join(
  DASHBOARD_DIR,
  "prompt_issue_dismissals.json",
);

async function readJsonSafe<T>(p: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(p, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(p: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await rename(tmp, p);
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------

export async function loadInsightsFile(): Promise<InsightsFile> {
  return readJsonSafe<InsightsFile>(INSIGHTS_PATH, { last_updated: null, insights: [] });
}

export async function patchInsightStatus(
  id: string,
  status: Insight["status"],
): Promise<Insight | null> {
  const file = await loadInsightsFile();
  const idx = file.insights.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  file.insights[idx] = { ...file.insights[idx], status };
  file.last_updated = nowIso();
  await writeJsonAtomic(INSIGHTS_PATH, file);
  return file.insights[idx];
}

export async function deleteInsight(id: string): Promise<boolean> {
  const file = await loadInsightsFile();
  const before = file.insights.length;
  file.insights = file.insights.filter((i) => i.id !== id);
  if (file.insights.length === before) return false;
  file.last_updated = nowIso();
  await writeJsonAtomic(INSIGHTS_PATH, file);
  return true;
}

// ---------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------

export async function loadTasksFile(): Promise<TasksFile> {
  return readJsonSafe<TasksFile>(TASKS_PATH, { last_updated: null, tasks: [] });
}

export interface TaskPatch {
  status?: Task["status"];
  /** When status changes to deferred, append a reason to description. */
  reason?: string;
  /** Reassign to a different team. The route validates the value
   *  against the TASK_OWNERS enum before passing it in. */
  owner?: Task["owner"];
}

export async function patchTask(id: string, patch: TaskPatch): Promise<Task | null> {
  const file = await loadTasksFile();
  const idx = file.tasks.findIndex((t) => t.id === id);
  if (idx < 0) return null;

  const current = file.tasks[idx];
  const updated: Task = { ...current, updated_at: nowIso() };

  if (patch.status && patch.status !== current.status) {
    updated.status = patch.status;
    // Mirror the dashboard-sync.md contract: appending a deferred reason
    // to the description is Claude's convention; match it here so status
    // history stays in one place.
    if (patch.status === "deferred" && patch.reason) {
      const note = `\n\nDeferred ${nowIso().slice(0, 10)} (via UI): ${patch.reason}`;
      updated.description = (current.description ?? "") + note;
    }
  }

  if (patch.owner) {
    updated.owner = patch.owner;
  }

  file.tasks[idx] = updated;
  file.last_updated = nowIso();
  await writeJsonAtomic(TASKS_PATH, file);
  return updated;
}

export async function deleteTask(id: string): Promise<boolean> {
  const file = await loadTasksFile();
  const before = file.tasks.length;
  file.tasks = file.tasks.filter((t) => t.id !== id);
  if (file.tasks.length === before) return false;
  file.last_updated = nowIso();
  await writeJsonAtomic(TASKS_PATH, file);
  return true;
}

// ---------------------------------------------------------------------
// Pillar pages — set / clear the pillar URL for a (cluster, lang)
// ---------------------------------------------------------------------

export async function loadPillarPagesFile(): Promise<PillarPagesFile> {
  return readJsonSafe<PillarPagesFile>(PILLAR_PAGES_PATH, {
    last_updated: null,
    pillars: {},
  });
}

/**
 * Set or unset the pillar URL for a (cluster, lang) pair. Passing null
 * for `url` removes the designation. Returns the updated map.
 */
export async function setPillarPage(
  cluster: string,
  lang: "en" | "de",
  url: string | null,
): Promise<PillarPagesFile> {
  const file = await loadPillarPagesFile();
  const key = `${cluster}::${lang}`;
  if (url) {
    file.pillars[key] = url;
  } else {
    delete file.pillars[key];
  }
  file.last_updated = nowIso();
  await writeJsonAtomic(PILLAR_PAGES_PATH, file);
  return file;
}

// ---------------------------------------------------------------------
// Cluster overrides — move a URL to a different cluster
// ---------------------------------------------------------------------

export async function loadClusterOverridesFile(): Promise<ClusterOverridesFile> {
  return readJsonSafe<ClusterOverridesFile>(OVERRIDES_PATH, {
    last_updated: null,
    overrides: [],
  });
}

/**
 * Upsert a manual cluster override for a single URL. Passing null for
 * `cluster` removes the override (page falls back to its Python-assigned
 * cluster). Returns the full updated file.
 */
export async function setClusterOverride(
  url: string,
  cluster: string | null,
  source: ClusterOverride["source"] = "manual-ui",
): Promise<ClusterOverridesFile> {
  const file = await loadClusterOverridesFile();
  applyOverrideToFile(file, url, cluster, source);
  file.last_updated = nowIso();
  await writeJsonAtomic(OVERRIDES_PATH, file);
  return file;
}

/**
 * Set the same cluster override on many URLs in one atomic write.
 * `cluster: null` clears the overrides for all listed URLs. Used by
 * the cluster-overview page's bulk-assign action and by the Claude
 * skill prompt that moves a page list in one go.
 *
 * Returns { updated: [{url, cluster}, ...] } with the ACTUAL changes
 * (noops — URL already in that cluster — are excluded). This lets the
 * client show "Moved N pages" accurately rather than echoing the
 * requested count.
 */
export async function setClusterOverrideBulk(
  urls: string[],
  cluster: string | null,
  source: ClusterOverride["source"] = "manual-ui",
): Promise<{
  file: ClusterOverridesFile;
  updated: { url: string; cluster: string | null }[];
}> {
  const file = await loadClusterOverridesFile();
  const updated: { url: string; cluster: string | null }[] = [];

  for (const url of urls) {
    const existing = file.overrides.find((o) => o.url === url);
    // Skip noops: setting the same cluster, or clearing when no
    // override exists. Keeps the updated list honest.
    if (cluster && existing?.cluster === cluster) continue;
    if (!cluster && !existing) continue;
    applyOverrideToFile(file, url, cluster, source);
    updated.push({ url, cluster });
  }

  if (updated.length === 0) return { file, updated };

  file.last_updated = nowIso();
  await writeJsonAtomic(OVERRIDES_PATH, file);
  return { file, updated };
}

/**
 * In-place apply one override to an already-loaded file. Caller is
 * responsible for the write + last_updated. Extracted so single +
 * bulk can share the same logic without each doing I/O per URL.
 */
function applyOverrideToFile(
  file: ClusterOverridesFile,
  url: string,
  cluster: string | null,
  source: ClusterOverride["source"],
): void {
  const idx = file.overrides.findIndex((o) => o.url === url);
  if (cluster) {
    const entry: ClusterOverride = {
      url,
      cluster,
      updated_at: nowIso(),
      source,
    };
    if (idx >= 0) file.overrides[idx] = entry;
    else file.overrides.push(entry);
  } else if (idx >= 0) {
    file.overrides.splice(idx, 1);
  }
}

// ---------------------------------------------------------------------
// Custom clusters
// ---------------------------------------------------------------------

export async function loadCustomClustersFile(): Promise<CustomClustersFile> {
  return readJsonSafe<CustomClustersFile>(CUSTOM_CLUSTERS_PATH, {
    last_updated: null,
    clusters: [],
  });
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function createCustomCluster(input: {
  slug: string;
  names: { en: string; de: string };
}): Promise<CustomCluster> {
  const slug = input.slug.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) {
    throw new Error(
      "slug must be lowercase letters, numbers, and hyphens (e.g. 'my-new-cluster')",
    );
  }
  if (!input.names.en.trim() || !input.names.de.trim()) {
    throw new Error("names.en and names.de are required");
  }

  const file = await loadCustomClustersFile();
  if (file.clusters.some((c) => c.slug === slug)) {
    throw new Error(`cluster slug '${slug}' already exists`);
  }

  const entry: CustomCluster = {
    slug,
    names: { en: input.names.en.trim(), de: input.names.de.trim() },
    created_at: nowIso(),
    source: "custom",
  };
  file.clusters.push(entry);
  file.last_updated = nowIso();
  await writeJsonAtomic(CUSTOM_CLUSTERS_PATH, file);
  return entry;
}

export async function deleteCustomCluster(slug: string): Promise<boolean> {
  const file = await loadCustomClustersFile();
  const before = file.clusters.length;
  file.clusters = file.clusters.filter((c) => c.slug !== slug);
  if (file.clusters.length === before) return false;
  file.last_updated = nowIso();
  await writeJsonAtomic(CUSTOM_CLUSTERS_PATH, file);
  return true;
}

// ---------------------------------------------------------------------
// Prompt issue dismissals — user clears a "Suggested change" row on
// /strategy/prompts after fixing it directly in Peec (or judging it a
// false positive). Persisted so the row stays gone across reloads,
// across geo-debug pulls that still detect the same issue, and across
// dev-server restarts.
// ---------------------------------------------------------------------

export async function loadPromptIssueDismissalsFile(): Promise<PromptIssueDismissalsFile> {
  return readJsonSafe<PromptIssueDismissalsFile>(PROMPT_ISSUE_DISMISSALS_PATH, {
    last_updated: null,
    dismissals: [],
  });
}

/**
 * Add a dismissal. If the issue id is already dismissed, the existing
 * record is replaced (lets the user update the reason without first
 * un-dismissing). Returns the persisted record.
 */
export async function addPromptIssueDismissal(input: {
  id: string;
  prompt_id: string;
  kind: string;
  reason?: string;
}): Promise<PromptIssueDismissal> {
  const file = await loadPromptIssueDismissalsFile();
  const idx = file.dismissals.findIndex((d) => d.id === input.id);
  const entry: PromptIssueDismissal = {
    id: input.id,
    prompt_id: input.prompt_id,
    kind: input.kind,
    dismissed_at: nowIso(),
    ...(input.reason ? { reason: input.reason } : {}),
  };
  if (idx >= 0) file.dismissals[idx] = entry;
  else file.dismissals.push(entry);
  file.last_updated = nowIso();
  await writeJsonAtomic(PROMPT_ISSUE_DISMISSALS_PATH, file);
  return entry;
}

/**
 * Remove a dismissal — undoes a previous dismiss. Returns true if a
 * record was removed, false if no matching id existed.
 */
export async function deletePromptIssueDismissal(id: string): Promise<boolean> {
  const file = await loadPromptIssueDismissalsFile();
  const before = file.dismissals.length;
  file.dismissals = file.dismissals.filter((d) => d.id !== id);
  if (file.dismissals.length === before) return false;
  file.last_updated = nowIso();
  await writeJsonAtomic(PROMPT_ISSUE_DISMISSALS_PATH, file);
  return true;
}

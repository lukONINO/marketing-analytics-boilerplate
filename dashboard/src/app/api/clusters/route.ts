/**
 * POST /api/clusters
 *   body: { slug: string, names: { en: string, de: string } }
 *
 * Create a new custom cluster. Slug must be kebab-case [a-z0-9-]. Names
 * are display strings for EN and DE tabs. Duplicates (slug already in
 * the YAML *or* already in custom_clusters.json) are rejected.
 *
 * Returns 201 with the created cluster on success.
 *
 * Localhost-only.
 */

import { NextResponse } from "next/server";
import path from "node:path";
import { readFile } from "node:fs/promises";
import yaml from "js-yaml";

import { createCustomCluster } from "@/lib/mutations";
import type { TopicCluster } from "@/lib/types";

export const dynamic = "force-dynamic";

const REPO_ROOT = path.resolve(process.cwd(), "..");
const CLUSTERS_YAML = path.join(REPO_ROOT, "config", "topic_clusters.yaml");

async function configClusterSlugs(): Promise<string[]> {
  try {
    const raw = await readFile(CLUSTERS_YAML, "utf-8");
    const doc = yaml.load(raw) as { clusters?: TopicCluster[] } | null;
    return (doc?.clusters ?? []).map((c) => c.slug);
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  let body: { slug?: unknown; names?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.slug !== "string" || !body.slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }
  if (
    !body.names ||
    typeof body.names !== "object" ||
    typeof (body.names as { en?: unknown }).en !== "string" ||
    typeof (body.names as { de?: unknown }).de !== "string"
  ) {
    return NextResponse.json(
      { error: "names.en and names.de required (strings)" },
      { status: 400 },
    );
  }

  const slug = body.slug.trim().toLowerCase();

  // Collision with a YAML cluster is not something we can rescue.
  const configSlugs = await configClusterSlugs();
  if (configSlugs.includes(slug)) {
    return NextResponse.json(
      {
        error:
          `slug '${slug}' is already defined in config/topic_clusters.yaml — pick a different slug or remove the YAML entry first`,
      },
      { status: 409 },
    );
  }

  try {
    const created = await createCustomCluster({
      slug,
      names: body.names as { en: string; de: string },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = message.includes("already exists") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

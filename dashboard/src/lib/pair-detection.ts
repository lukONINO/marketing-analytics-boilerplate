/**
 * Translation-pair detection for site pages.
 *
 * Problem: when the user reassigns a page to a different cluster, the
 * translated counterpart should usually follow. Detecting the pair
 * without an explicit hreflang tag is heuristic — slugs are often full
 * translations (not literal mirrors), e.g.
 *
 *   EN: /blog/build-vs.-buy-how-to-choose-a-platform-in-the-eu
 *   DE: /de/blog/selbst-entwickeln-oder-kaufen-...-eu-aus
 *
 * Strategy (score 0-100 per candidate, pick the best over threshold):
 *   - +40 if the URL stems share a rare keyword (regulatory / industry /
 *     brand token specific to your market — see RARE_SIGNALS below)
 *   - +30 if titles overlap in ≥3 normalized tokens (after stripping
 *     stopwords + mapping known EN↔DE translation pairs)
 *   - +20 if URL paths are both under /blog/ or both under the same
 *     /industries|branchen/, /for|kunden/, /solutions|lösungen/ stem
 *   - +10 if body word-counts are within 30% of each other (often the
 *     translation is 10-20% longer than the original)
 *
 * Scores ≥ 50 are surfaced as "likely pair"; 30-49 as "possible pair,
 * confirm"; below 30 we return nothing.
 *
 * Future: once the scrape captures <link rel="alternate" hreflang="de">,
 * we replace this with the exact pair URL and retire the heuristic.
 * Keep the interface stable so the caller doesn't change.
 */

import type { PageClusterAssignment } from "./types";

export interface PairCandidate {
  url: string;
  title: string | null;
  score: number;
  /** Short human-readable reason strings — "shared keyword: foo", etc. */
  reasons: string[];
}

// ---------------------------------------------------------------------
// Normalization tables
// ---------------------------------------------------------------------

/** EN tokens → a canonical form shared with DE (and vice-versa). Only
 *  high-signal vocabulary we've seen actually produce matches. Customize
 *  for your industry's vocabulary; the entries below are illustrative. */
const BILINGUAL_TOKEN_MAP: Record<string, string> = {
  // platform / plattform
  platform: "platform",
  plattform: "platform",
  platforms: "platform",
  plattformen: "platform",
  // whitelabel
  whitelabel: "whitelabel",
  "white-label": "whitelabel",
  // fund
  fund: "fund",
  funds: "fund",
  fonds: "fund",
  // real estate / immobilien
  real: "realestate",
  estate: "realestate",
  immobilien: "realestate",
  immobilie: "realestate",
  // bond / anleihe
  bond: "bond",
  bonds: "bond",
  anleihe: "bond",
  anleihen: "bond",
  // debt / schulden
  debt: "debt",
  schulden: "debt",
  schuld: "debt",
  // equity / eigenkapital
  equity: "equity",
  eigenkapital: "equity",
  eigenkapitals: "equity",
  // investor / investor
  investor: "investor",
  investors: "investor",
  investoren: "investor",
  investorenmanagement: "investor-mgmt",
  // launch / launchen
  launch: "launch",
  launching: "launch",
  launchen: "launch",
  // regulation / regulierung
  regulation: "regulation",
  regulierung: "regulation",
  regulations: "regulation",
  regulatorische: "regulation",
  regulatory: "regulation",
  // asset
  asset: "asset",
  assets: "asset",
  vermögenswert: "asset",
  vermögenswerte: "asset",
  // kyc / aml stay identical
  kyc: "kyc",
  aml: "aml",
  // compliance
  compliance: "compliance",
  konform: "compliance",
  "konforme": "compliance",
  // secondary market / sekundärmarkt
  secondary: "secondary",
  sekundärmarkt: "secondary",
  markets: "market",
  market: "market",
  markt: "market",
  märkte: "market",
  // months in timelines
  months: "month",
  monate: "month",
  monaten: "month",
  // cooperative / genossenschaft
  cooperative: "cooperative",
  genossenschaft: "cooperative",
  genossenschaften: "cooperative",
  // security
  security: "security",
  sicherheit: "security",
  sicherer: "security",
};

/** Stopwords to drop before token comparison. */
const STOPWORDS = new Set([
  // EN
  "the", "a", "an", "and", "or", "of", "to", "for", "with", "in", "on",
  "is", "are", "was", "were", "be", "been", "being", "how", "why", "what",
  "that", "this", "these", "those", "it", "its", "by", "at", "as", "from",
  "into", "about", "your", "you", "we", "our", "us", "can", "do", "does",
  "best", "top", "guide", "2026", "2025", "2024",
  // DE
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einer", "einen",
  "und", "oder", "aber", "für", "mit", "von", "zu", "zur", "zum", "im", "in",
  "auf", "an", "ist", "sind", "war", "waren", "sein", "hat", "haben", "wie",
  "warum", "was", "dass", "diese", "dieser", "dieses", "ihr", "ihre", "ihren",
  "wir", "uns", "unser", "unsere", "unseres", "kann", "können", "welche",
  "welcher", "welches", "als", "auch", "bei", "durch", "nach", "vor", "über",
  "unter",
]);

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function normalizeToken(raw: string): string | null {
  const lower = raw.toLowerCase().trim().replace(/[^a-z0-9äöüß-]/g, "");
  if (!lower || lower.length < 3) return null;
  if (STOPWORDS.has(lower)) return null;
  return BILINGUAL_TOKEN_MAP[lower] ?? lower;
}

function tokenize(text: string | null): Set<string> {
  if (!text) return new Set();
  const out = new Set<string>();
  for (const raw of text.split(/[\s\/\-–—_.,:;!?()"'«»„“”]+/)) {
    const norm = normalizeToken(raw);
    if (norm) out.add(norm);
  }
  return out;
}

function pathStem(url: string): string {
  try {
    return new URL(url).pathname
      .replace(/^\/de\//, "/")
      .replace(/^\//, "")
      .split("/")[0] ?? "";
  } catch {
    return "";
  }
}

function wordCountRatio(a: number, b: number): number {
  if (!a || !b) return 0;
  return Math.min(a, b) / Math.max(a, b);
}

// ---------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------

/**
 * Rare, high-signal tokens that strongly imply two URLs are translations
 * of the same underlying topic. Customize for your industry — these are
 * placeholders; replace with regulatory acronyms, named partners, named
 * customer brands, technical IDs, etc. that occur in your slugs.
 *
 * Set the RARE_SIGNALS env var (comma-separated) to override at runtime
 * without code changes.
 */
const RARE_SIGNALS: string[] =
  (process.env.RARE_SIGNALS || "").split(",").map((s) => s.trim()).filter(Boolean).length > 0
    ? (process.env.RARE_SIGNALS as string).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [
        // Replace with industry-specific rare tokens, e.g.:
        // "[regulatory-acronym]", "[partner-brand]", "[customer-name]", "[product-id]",
      ];

function scorePair(
  source: PageClusterAssignment,
  candidate: PageClusterAssignment,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const sourceTokens = new Set([
    ...tokenize(source.title),
    ...tokenize(source.url.replace(/\W+/g, " ")),
  ]);
  const candTokens = new Set([
    ...tokenize(candidate.title),
    ...tokenize(candidate.url.replace(/\W+/g, " ")),
  ]);
  const shared = new Set<string>();
  for (const t of sourceTokens) if (candTokens.has(t)) shared.add(t);

  // (a) Rare keyword in the URL slug
  const sharedRare = [...shared].filter((t) => RARE_SIGNALS.includes(t));
  if (sharedRare.length > 0) {
    score += 40;
    reasons.push(`shared keyword: ${sharedRare.join(", ")}`);
  }

  // (b) Token overlap in titles + slugs
  if (shared.size >= 3) {
    score += 30;
    reasons.push(
      `${shared.size} overlapping tokens (${[...shared].slice(0, 4).join(", ")})`,
    );
  } else if (shared.size === 2) {
    score += 15;
    reasons.push(`${shared.size} overlapping tokens`);
  }

  // (c) Same path category (both /blog/, both /industries/, etc.)
  const sStem = pathStem(source.url);
  const cStem = pathStem(candidate.url);
  const equivalent: Record<string, string> = {
    industries: "industries",
    branchen: "industries",
    for: "customers",
    kunden: "customers",
    solutions: "solutions",
    lösungen: "solutions",
    l_C3_B6sungen: "solutions",
    product: "product",
    produkt: "product",
    blog: "blog",
  };
  const sCat = equivalent[sStem] ?? sStem;
  const cCat = equivalent[cStem] ?? cStem;
  if (sCat && sCat === cCat) {
    score += 20;
    reasons.push(`both under /${sStem}/ or equivalent`);
  }

  // (d) Word-count ratio — translations are usually within 30% of each other
  const wcRatio = wordCountRatio(source.word_count ?? 0, candidate.word_count ?? 0);
  if (wcRatio >= 0.7) {
    score += 10;
    reasons.push(`word counts within ${Math.round((1 - wcRatio) * 100)}%`);
  }

  return { score, reasons };
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

/**
 * Given a source assignment, return the highest-scoring candidate
 * counterpart in the opposite language, or null if nothing crosses the
 * minimum score. Only considers pages whose `lang` is the opposite of
 * the source's `lang`.
 */
export function findTranslationPair(
  source: PageClusterAssignment,
  allAssignments: PageClusterAssignment[],
  minScore = 30,
): PairCandidate | null {
  const otherLang: "en" | "de" = source.lang === "en" ? "de" : "en";
  let best: PairCandidate | null = null;
  for (const candidate of allAssignments) {
    if (candidate.url === source.url) continue;
    if (candidate.lang !== otherLang) continue;
    const { score, reasons } = scorePair(source, candidate);
    if (score < minScore) continue;
    if (!best || score > best.score) {
      best = {
        url: candidate.url,
        title: candidate.title,
        score,
        reasons,
      };
    }
  }
  return best;
}

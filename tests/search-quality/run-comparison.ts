#!/usr/bin/env npx tsx
/**
 * Search quality comparison.
 *
 * Submits fixture recipes, then runs queries and measures how well
 * the search finds expected matches.
 *
 * Usage: source .env && npx tsx tests/search-quality/run-comparison.ts
 *
 * Requires: DATABASE_URL, running backend at http://localhost:3101,
 * and a valid API key in SOUPNET_TEST_KEY env var.
 */

import { TEST_RECIPES, EXPECTED_MATCHES } from "./fixtures";
import type { TestRecipe, ExpectedMatch } from "./fixtures";

const BASE = process.env["BACKEND_URL"] ?? "http://localhost:3101";
const API_KEY = process.env["SOUPNET_TEST_KEY"];

if (!API_KEY) {
  console.error("Error: SOUPNET_TEST_KEY env var is required.");
  console.error("Generate a key via the API and set it:");
  console.error("  export SOUPNET_TEST_KEY=cn_d_...");
  process.exit(1);
}

// ── Types ────────────────────────────────────────────────────────────────────

interface JsonResult {
  id: string;
  recipe: string;
  score: {
    combined: number;
    semantic: number | null;
    lexical: number | null;
  };
  evidence: unknown[];
}

interface JsonResponse {
  ok: boolean;
  error?: string;
  data?: {
    recipeId: string;
    searchMode: string;
    results: JsonResult[];
    totalResults: number;
    page: number;
    totalPages: number;
  };
}

interface QueryMetrics {
  queryTag: string;
  query: string;
  expectedTags: string[];
  foundTags: string[];
  precision5: number;
  precision10: number;
  mrr: number;
  scoreSpread: number;
  searchMode: string;
  topResults: Array<{ tag: string | null; recipe: string; score: number }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function submitRecipe(
  recipe: string,
  evidenceFor: string,
): Promise<JsonResponse> {
  const params = new URLSearchParams({
    key: API_KEY!,
    trace: recipe,
    ef: evidenceFor,
    format: "json",
  });

  const res = await fetch(`${BASE}/check?${params.toString()}`);
  return (await res.json()) as JsonResponse;
}

/**
 * Match a result's recipe text to a fixture tag via substring matching.
 * Returns the tag if matched, null otherwise.
 */
function matchResultToTag(
  resultRecipe: string,
  fixtures: TestRecipe[],
): string | null {
  for (const fixture of fixtures) {
    // Use a generous substring match — fixtures have unique text
    if (
      resultRecipe.includes(fixture.recipe) ||
      fixture.recipe.includes(resultRecipe)
    ) {
      return fixture.tag;
    }
    // Fallback: check for a significant shared substring (first 40 chars)
    const snippet = fixture.recipe.slice(0, 60);
    if (resultRecipe.includes(snippet)) {
      return fixture.tag;
    }
  }
  return null;
}

function computePrecisionAtK(
  foundTags: string[],
  expectedTags: string[],
  k: number,
): number {
  const topK = foundTags.slice(0, k);
  if (topK.length === 0) return 0;
  const hits = topK.filter((t) => expectedTags.includes(t)).length;
  return hits / Math.min(k, expectedTags.length);
}

function computeMRR(foundTags: string[], expectedTags: string[]): number {
  for (let i = 0; i < Math.min(foundTags.length, 20); i++) {
    if (expectedTags.includes(foundTags[i]!)) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("# Search Quality Comparison Report");
  console.log(`\nBackend: ${BASE}`);
  console.log(`Key prefix: ${API_KEY!.slice(0, 8)}...`);
  console.log(`Fixtures: ${TEST_RECIPES.length} recipes, ${EXPECTED_MATCHES.length} queries`);
  console.log();

  // Step 1: Submit all fixture recipes
  console.log("## Step 1: Submitting fixture recipes\n");
  const recipeIds = new Map<string, string>();

  for (const fixture of TEST_RECIPES) {
    const response = await submitRecipe(fixture.recipe, fixture.evidenceFor);
    if (response.ok && response.data?.recipeId) {
      recipeIds.set(fixture.tag, response.data.recipeId);
      console.log(`- [x] ${fixture.tag} -> #${response.data.recipeId}`);
    } else {
      console.log(`- [ ] ${fixture.tag} -> ERROR: ${response.error ?? "unknown"}`);
    }
  }

  console.log();

  // Step 2: Run queries and measure results
  console.log("## Step 2: Running queries\n");
  const allMetrics: QueryMetrics[] = [];

  for (const expected of EXPECTED_MATCHES) {
    const response = await submitRecipe(expected.query, expected.queryEvidenceFor);

    if (!response.ok || !response.data) {
      console.log(`### ${expected.queryTag}: ERROR\n`);
      console.log(`Error: ${response.error ?? "unknown"}\n`);
      continue;
    }

    const results = response.data.results;
    const searchMode = response.data.searchMode;

    // Map results to fixture tags
    const resultTags = results.map((r) => matchResultToTag(r.recipe, TEST_RECIPES));
    const foundTags = resultTags.filter((t): t is string => t !== null);

    // Compute metrics
    const precision5 = computePrecisionAtK(foundTags, expected.shouldMatchTags, 5);
    const precision10 = computePrecisionAtK(foundTags, expected.shouldMatchTags, 10);
    const mrr = computeMRR(foundTags, expected.shouldMatchTags);

    const scores = results.map((r) => r.score.combined);
    const scoreSpread =
      scores.length > 1
        ? Math.max(...scores) - Math.min(...scores)
        : 0;

    const topResults = results.slice(0, 10).map((r) => ({
      tag: matchResultToTag(r.recipe, TEST_RECIPES),
      recipe: r.recipe.slice(0, 80) + (r.recipe.length > 80 ? "..." : ""),
      score: r.score.combined,
    }));

    const metrics: QueryMetrics = {
      queryTag: expected.queryTag,
      query: expected.query,
      expectedTags: expected.shouldMatchTags,
      foundTags,
      precision5,
      precision10,
      mrr,
      scoreSpread,
      searchMode,
      topResults,
    };
    allMetrics.push(metrics);

    // Print per-query report
    console.log(`### ${expected.queryTag}`);
    console.log(`Query: "${expected.query.slice(0, 80)}..."`);
    console.log(`Search mode: ${searchMode}`);
    console.log(`Expected matches: ${expected.shouldMatchTags.join(", ")}`);
    console.log(`Found in top-10: ${foundTags.length > 0 ? foundTags.join(", ") : "(none)"}`);
    console.log(`Precision@5: ${(precision5 * 100).toFixed(1)}%`);
    console.log(`Precision@10: ${(precision10 * 100).toFixed(1)}%`);
    console.log(`MRR: ${mrr.toFixed(3)}`);
    console.log(`Score spread: ${scoreSpread.toFixed(4)}`);
    console.log();

    if (topResults.length > 0) {
      console.log("| Rank | Tag | Score | Recipe |");
      console.log("|------|-----|-------|--------|");
      topResults.forEach((r, i) => {
        const tagLabel = r.tag ?? "(unmatched)";
        const isExpected = expected.shouldMatchTags.includes(r.tag ?? "");
        const marker = isExpected ? " **" : "";
        console.log(`| ${i + 1} | ${tagLabel}${marker} | ${r.score.toFixed(4)} | ${r.recipe} |`);
      });
      console.log();
    }
  }

  // Step 3: Aggregate metrics
  console.log("## Summary\n");

  if (allMetrics.length === 0) {
    console.log("No queries completed successfully.\n");
    return;
  }

  const avgP5 = allMetrics.reduce((s, m) => s + m.precision5, 0) / allMetrics.length;
  const avgP10 = allMetrics.reduce((s, m) => s + m.precision10, 0) / allMetrics.length;
  const avgMRR = allMetrics.reduce((s, m) => s + m.mrr, 0) / allMetrics.length;
  const modes = [...new Set(allMetrics.map((m) => m.searchMode))];

  console.log("| Metric | Value |");
  console.log("|--------|-------|");
  console.log(`| Avg Precision@5 | ${(avgP5 * 100).toFixed(1)}% |`);
  console.log(`| Avg Precision@10 | ${(avgP10 * 100).toFixed(1)}% |`);
  console.log(`| Avg MRR | ${avgMRR.toFixed(3)} |`);
  console.log(`| Search mode(s) | ${modes.join(", ")} |`);
  console.log(`| Queries run | ${allMetrics.length} |`);
  console.log(`| Fixtures submitted | ${recipeIds.size}/${TEST_RECIPES.length} |`);
  console.log();

  // Exit code: fail if avg MRR is 0 (nothing matched at all)
  if (avgMRR === 0) {
    console.log("WARNING: No expected matches found in any query. Check search index.\n");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

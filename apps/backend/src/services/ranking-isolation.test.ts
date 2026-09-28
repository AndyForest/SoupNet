/**
 * Triage ratings never reach ranking (drafts-and-triage slice 1: rubric
 * S1-B8 (b); scenarios DT-RAT-06, DT-RAT-07).
 *
 * Static guard: none of the files that retrieve, score, cluster, or select
 * results may mention the rating columns or fields. Self-ratings are useful
 * for sorting a review queue and unsafe as a relevance signal (the corpus's
 * calibration audit, recipe ff54eafd), and "context shapes rendering, never
 * ranking" is a standing rule. A file that needs a rating for a legitimate
 * non-ranking reason belongs outside this list; moving code into one of
 * these files and reading a rating there is exactly what this test stops.
 *
 * Slice 2 extends the same list to the draft and verification columns.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..", "..");

/** Every file the ranking path runs through, per the slice-1 rubric. */
const RANKING_FILES = [
  "apps/backend/src/services/vector-search.service.ts",
  "apps/backend/src/services/search-pipeline.ts",
  "apps/backend/src/services/clustering.service.ts",
  "packages/domain/src/mmr.ts",
  "packages/domain/src/ranking-config.ts",
] as const;

/** The rating columns (traces.impact, traces.uncertainty), their wire and
 *  field names, and the concept's own name. */
const RATING_TERMS = /\b(impact|uncertainty|triage|TriageRating\w*|parseTriageRating\w*)\b/i;

describe("ranking code never reads triage ratings (S1-B8 b, DT-RAT-07)", () => {
  for (const file of RANKING_FILES) {
    it(`${file} does not reference impact, uncertainty, or triage ratings`, () => {
      const source = readFileSync(join(repo, file), "utf-8");
      const hits = source
        .split("\n")
        .map((line, i) => ({ line: i + 1, text: line }))
        .filter(({ text }) => RATING_TERMS.test(text));
      expect(hits, `${file} mentions a rating: ${JSON.stringify(hits)}`).toEqual([]);
    });
  }

  // Slice 2 (rubric "Security properties": ratings and draft state are never
  // read by ranking). These files FILTER on the draft rule through the authz
  // module's fragments (traceIdVisibleTo, traceVisibleTo, publishedTrace),
  // which keep the columns out of this code; what they must never do is read
  // the draft or verification columns themselves, to score, order, or
  // cluster by them.
  const DRAFT_TERMS = /(draft_state|draftState|draft_resolved_\w+|draftResolved\w*)/;
  for (const file of RANKING_FILES) {
    it(`${file} does not reference the draft or verification columns (slice 2)`, () => {
      const source = readFileSync(join(repo, file), "utf-8");
      const hits = source
        .split("\n")
        .map((line, i) => ({ line: i + 1, text: line }))
        .filter(({ text }) => DRAFT_TERMS.test(text));
      expect(hits, `${file} mentions a draft column: ${JSON.stringify(hits)}`).toEqual([]);
    });
  }

  it("the scan list covers files that exist (a rename must update this test, not silently skip)", () => {
    for (const file of RANKING_FILES) {
      expect(() => readFileSync(join(repo, file), "utf-8"), file).not.toThrow();
    }
  });
});

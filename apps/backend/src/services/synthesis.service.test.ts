import { describe, it, expect } from "vitest";
import { toSynthesisInput, maybeSynthesize } from "./synthesis.service";
import type { EnrichedResult } from "./result-enricher";
import type { EvidenceSearchResult } from "./vector-search.service";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

/**
 * Layer-1 unit tests for the pure/no-I/O parts of the synthesis service.
 * The eligibility SELECT and the provider call are exercised end-to-end by the
 * integration tests (check.test.ts / mcp.test.ts) under the stub provider.
 */

function enriched(overrides: Partial<EnrichedResult> = {}): EnrichedResult {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    claimText: "As a role, I prefer X so that Y.",
    createdAt: "2026-07-01T00:00:00.000Z",
    semanticScore: 0.9,
    evidence: [{ id: "e1", content: "Evidence one", references: [] }],
    ...overrides,
  };
}

describe("toSynthesisInput", () => {
  it("maps enriched results onto SynthesisInput, using createdAt as the judgment date", () => {
    const input = toSynthesisInput("As a checker, I want a profile.", [enriched()]);
    expect(input.checkedRecipe).toBe("As a checker, I want a profile.");
    expect(input.results).toHaveLength(1);
    expect(input.results[0]).toMatchObject({
      id: "11111111-1111-1111-1111-111111111111",
      recipe: "As a role, I prefer X so that Y.",
      judgmentDate: "2026-07-01T00:00:00.000Z",
      evidence: ["Evidence one"],
    });
  });

  it("maps related evidence to { recipeId, content }", () => {
    const related: EvidenceSearchResult[] = [
      {
        evidenceId: "ev",
        parentTraceId: "22222222-2222-2222-2222-222222222222",
        parentTraceText: "parent recipe",
        evidenceContent: "related snippet",
        semanticScore: 0.7,
      },
    ];
    const input = toSynthesisInput("checked", [], related);
    expect(input.relatedEvidence).toEqual([
      { recipeId: "22222222-2222-2222-2222-222222222222", content: "related snippet" },
    ]);
  });

  it("handles no results and no related evidence", () => {
    const input = toSynthesisInput("checked", []);
    expect(input.results).toEqual([]);
    expect(input.relatedEvidence).toEqual([]);
  });
});

describe("maybeSynthesize", () => {
  it("returns an empty object without touching the db when synthesis was not requested", async () => {
    // A db that throws if used — proves the requested=false short-circuit runs
    // before any query.
    const db = {
      execute: () => {
        throw new Error("db should not be queried when requested=false");
      },
    } as unknown as PostgresJsDatabase;

    const result = await maybeSynthesize({
      db,
      userId: "user",
      requested: false,
      checkedRecipe: "checked",
      results: [enriched()],
    });
    expect(result).toEqual({});
  });
});

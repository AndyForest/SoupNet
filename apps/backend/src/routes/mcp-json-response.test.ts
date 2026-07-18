import { describe, it, expect } from "vitest";
import { buildMcpJsonResponse } from "./mcp";
import type { SubmitAndSearchResult } from "../services/trace.service";
import type { EnrichedResult } from "../services/result-enricher";

/**
 * Layer-1 tests for the MCP JSON response builder — specifically the
 * pagination-cleanup invariants (2026-07-05): the actions block must never
 * advertise a param the check_recipe tool doesn't accept. The old shape
 * hinted page=N (no page param on the tool), expand=true, sort=recent and
 * filter=keyword (web /check params with no MCP equivalent).
 */

function makeResult(overrides: Partial<SubmitAndSearchResult> = {}): SubmitAndSearchResult {
  return {
    traceId: "7676e323-e4a8-493e-b705-febfac26081a",
    traceText: "As a developer, I chose X so that Y.",
    results: [],
    totalResults: 25,
    currentPage: 1,
    totalPages: 2,
    searchMode: "semantic",
    clustered: true,
    ...overrides,
  };
}

function makeEnriched(id: string, clusterSize?: number): EnrichedResult {
  return {
    id,
    claimText: `Recipe ${id}`,
    createdAt: "2026-07-01T00:00:00Z",
    semanticScore: 0.8,
    ...(clusterSize !== undefined ? { clusterSize } : {}),
    evidence: [],
  };
}

describe("buildMcpJsonResponse related evidence", () => {
  it("carries the source recipe UUID on each entry plus a lookup hint (2026-07-05: id-less entries forced re-checks)", () => {
    const response = buildMcpJsonResponse(
      makeResult({
        relatedEvidence: [
          {
            evidenceId: "e1",
            parentTraceId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
            parentTraceText: "As a dev, I chose X.",
            evidenceContent: "Interpretation here",
            semanticScore: 0.76,
          },
        ],
      }),
      [makeEnriched("a")],
      1,
    );
    const data = response["data"] as Record<string, unknown>;
    const related = data["relatedEvidence"] as Array<Record<string, unknown>>;
    expect(related[0]!["recipeId"]).toBe("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
    expect(String(data["relatedEvidenceHint"])).toContain("get_recipes");
  });

  it("omits the hint when there is no related evidence", () => {
    const response = buildMcpJsonResponse(makeResult(), [makeEnriched("a")], 1);
    const data = response["data"] as Record<string, unknown>;
    expect(data["relatedEvidenceHint"]).toBeUndefined();
  });
});

describe("buildMcpJsonResponse actions hints", () => {
  it("never emits a nextPage hint (the tool accepts no page param)", () => {
    const response = buildMcpJsonResponse(makeResult(), [makeEnriched("a", 5)], 1);
    const data = response["data"] as Record<string, unknown>;
    const actions = data["actions"] as Record<string, unknown>;
    expect(actions["nextPage"]).toBeUndefined();
    expect(JSON.stringify(actions)).not.toContain("page=");
  });

  it("replaces pagination with a narrowing hint when more results exist", () => {
    const response = buildMcpJsonResponse(makeResult({ totalPages: 3 }), [makeEnriched("a")], 1);
    const actions = (response["data"] as Record<string, unknown>)["actions"] as Record<string, unknown>;
    expect(String(actions["narrow"])).toContain("read_recipe_books");
    expect(String(actions["narrow"])).toContain("axes");
  });

  it("omits the narrowing hint when all results fit", () => {
    const response = buildMcpJsonResponse(makeResult({ totalPages: 1 }), [makeEnriched("a")], 1);
    const actions = (response["data"] as Record<string, unknown>)["actions"] as Record<string, unknown>;
    expect(actions["narrow"]).toBeUndefined();
  });

  it("only advertises params the MCP tool accepts (no expand/sort/filter hints)", () => {
    const response = buildMcpJsonResponse(makeResult({ totalPages: 4 }), [makeEnriched("a", 7)], 1);
    const data = response["data"] as Record<string, unknown>;
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("expand=true");
    expect(serialized).not.toContain("sort=recent");
    expect(serialized).not.toContain("filter=keyword");
    // moreClusters survives — clusters IS a real tool param.
    const actions = data["actions"] as Record<string, unknown>;
    expect(String(actions["moreClusters"])).toContain("clusters");
  });

  it("known_recipes renders an id-only stub (id + similarity + cluster slot; no recipe text, no evidence body)", () => {
    const enriched = makeEnriched("known-1", 4);
    enriched.claimText = "A".repeat(120);
    enriched.evidence = [{ id: "e1", content: "should not appear", references: [] }];
    const response = buildMcpJsonResponse(makeResult(), [enriched, makeEnriched("fresh-2")], 1, new Set(["known-1"]));
    const results = (response["data"] as Record<string, unknown>)["results"] as Array<Record<string, unknown>>;

    const stub = results[0]!;
    expect(stub["known"]).toBe(true);
    expect(stub["recipe"]).toBeUndefined(); // id-only stub — no gist (operator ruling)
    expect(stub["clusterSize"]).toBe(4); // stub keeps its cluster slot
    expect(stub["evidence"]).toBeUndefined();
    expect(stub["drillDown"]).toBeUndefined();
    // ONE similarity vocabulary (recipe ef245b63): a single raw-cosine field.
    expect(stub["similarity"]).toBe(0.8);
    expect(stub["score"]).toBeUndefined();

    const fresh = results[1]!;
    expect(fresh["known"]).toBeUndefined();
    expect(fresh["evidence"]).toBeDefined();
  });

  it("pipeline-flagged known results (session known-set) render the same id-only stub without the param set", () => {
    const enriched = makeEnriched("session-known-1", 3);
    enriched.known = true;
    enriched.evidence = [{ id: "e1", content: "should not appear", references: [] }];
    const response = buildMcpJsonResponse(makeResult(), [enriched], 1);
    const results = (response["data"] as Record<string, unknown>)["results"] as Array<Record<string, unknown>>;
    const stub = results[0]!;
    expect(stub["known"]).toBe(true);
    expect(stub["recipe"]).toBeUndefined();
    expect(stub["evidence"]).toBeUndefined();
    expect(stub["drillDown"]).toBeUndefined();
  });

  it("full items list their cluster's known members as knownMembers ({id, similarity} pairs)", () => {
    const enriched = makeEnriched("promoted-1", 5);
    enriched.knownClusterMembers = [
      { id: "known-a", similarity: 0.94 },
      { id: "known-b", similarity: 0.87 },
    ];
    const response = buildMcpJsonResponse(makeResult(), [enriched], 1);
    const results = (response["data"] as Record<string, unknown>)["results"] as Array<Record<string, unknown>>;
    const item = results[0]!;
    expect(item["recipe"]).toBe("Recipe promoted-1"); // full item, not a stub
    expect(item["knownMembers"]).toEqual([
      { id: "known-a", similarity: 0.94 },
      { id: "known-b", similarity: 0.87 },
    ]);
    expect(item["knownStubs"]).toBeUndefined(); // retired per-row stub objects (2026-07-18)
    expect(item["score"]).toBeUndefined(); // retired score object (recipe ef245b63)
    expect(item["similarity"]).toBe(0.8);
  });

  it("stub rows are trimmed: no createdAt (operator ruling 2026-07-18)", () => {
    const enriched = makeEnriched("known-slim", 2);
    enriched.known = true;
    const response = buildMcpJsonResponse(makeResult(), [enriched], 1);
    const results = (response["data"] as Record<string, unknown>)["results"] as Array<Record<string, unknown>>;
    expect(results[0]!["createdAt"]).toBeUndefined();
  });

  it("full-item group carries id + name only; evidence entries drop evidenceId/strategy; known parents ride relatedEvidenceKnown", () => {
    const enriched = makeEnriched("fresh-1");
    enriched.group = { id: "g1", name: "Book", description: "should not appear" };
    const response = buildMcpJsonResponse(
      makeResult({
        relatedEvidence: [{
          evidenceId: "ev-1",
          parentTraceId: "parent-1",
          parentTraceText: "Parent recipe text",
          evidenceContent: "Evidence body",
          semanticScore: 0.7,
        }],
        relatedEvidenceKnown: [
          { recipeId: "seen-parent-1", similarity: 0.79 },
          { recipeId: "seen-parent-2", similarity: 0.66 },
        ],
      }),
      [enriched],
      1,
    );
    const data = response["data"] as Record<string, unknown>;
    const item = (data["results"] as Array<Record<string, unknown>>)[0]!;
    expect(item["group"]).toEqual({ id: "g1", name: "Book" });
    const entry = (data["relatedEvidence"] as Array<Record<string, unknown>>)[0]!;
    expect(entry).toEqual({
      recipeId: "parent-1",
      parentRecipe: "Parent recipe text",
      evidence: "Evidence body",
      similarity: 0.7,
    });
    expect(data["relatedEvidenceKnown"]).toEqual([
      { recipeId: "seen-parent-1", similarity: 0.79 },
      { recipeId: "seen-parent-2", similarity: 0.66 },
    ]);
  });

  it("echoes the session token as data.sessionId when the service resolved one", () => {
    const response = buildMcpJsonResponse(makeResult({ sessionId: "sess-uuid-1" }), [makeEnriched("a")], 1);
    expect((response["data"] as Record<string, unknown>)["sessionId"]).toBe("sess-uuid-1");
    const without = buildMcpJsonResponse(makeResult(), [makeEnriched("a")], 1);
    expect((without["data"] as Record<string, unknown>)["sessionId"]).toBeUndefined();
  });

  it("drill-down hint references the clusters param, not expand", () => {
    const response = buildMcpJsonResponse(makeResult(), [makeEnriched("a", 9)], 1);
    const results = (response["data"] as Record<string, unknown>)["results"] as Array<Record<string, unknown>>;
    const drill = results[0]!["drillDown"] as Record<string, unknown>;
    expect(String(drill["hint"])).toContain("clusters value");
    expect(String(drill["hint"])).not.toContain("expand");
  });
});

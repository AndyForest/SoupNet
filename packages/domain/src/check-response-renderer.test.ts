import { describe, it, expect } from "vitest";
import {
  renderCheckResponseMarkdown,
  fenceCheckResponseMarkdown,
} from "./check-response-renderer";
import type { CheckResponseJson } from "./check-response-renderer";

const UUID_A = "550e8400-e29b-41d4-a716-446655440000";
const UUID_B = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const CHECK_ID = "7676e323-e4a8-493e-b705-febfac26081a";

function baseResponse(): CheckResponseJson {
  return {
    ok: true,
    data: {
      recipeId: CHECK_ID,
      searchMode: "semantic",
      clustered: true,
      results: [
        {
          id: UUID_A,
          recipe: "As a developer working on an API, I chose Hono so that edge deployment stays possible.",
          createdAt: "2026-04-03T12:34:56.000Z",
          group: { id: "g1", name: "SoupNet" },
          score: { combined: 0.9, semantic: 0.87 },
          clusterSize: 12,
          evidence: [
            {
              interpretation: "Hono runs on Web Standard APIs.",
              clusterSize: 3,
              references: [
                { quote: "Hono handles our edge case", source: "Framework meeting, 2026-03-01" },
              ],
            },
          ],
        },
        {
          id: UUID_B,
          recipe: "As a designer, I prefer warm palettes so that pages feel human.",
          createdAt: "2026-05-10T08:00:00.000Z",
          score: { combined: 0.5, semantic: null, lexical: 0.42 },
          evidence: [],
        },
      ],
      totalResults: 2,
      page: 1,
      totalPages: 1,
    },
  };
}

describe("renderCheckResponseMarkdown", () => {
  it("renders error responses as Error text", () => {
    expect(renderCheckResponseMarkdown({ ok: false, error: "bad key" })).toBe("Error: bad key");
    expect(renderCheckResponseMarkdown({ ok: true })).toBe("Error: Unknown error");
    expect(renderCheckResponseMarkdown({ ok: false })).toBe("Error: Unknown error");
  });

  it("keeps the check's own recipeId prominent on the first line", () => {
    const text = renderCheckResponseMarkdown(baseResponse());
    expect(text.split("\n")[0]).toBe(`Recipe checked as #${CHECK_ID}`);
  });

  it("carries full recipe UUID and similarity inline on every exemplar line", () => {
    const text = renderCheckResponseMarkdown(baseResponse());
    const lines = text.split("\n");
    const lineA = lines.find((l) => l.startsWith("#1 "));
    const lineB = lines.find((l) => l.startsWith("#2 "));
    // Single line: rank, similarity, full UUID, timestamp, cluster size, book — together.
    expect(lineA).toBe(`#1 (87% similar) ${UUID_A} -- 2026-04-03T12:34Z (represents 12 similar recipes) [SoupNet]`);
    expect(lineB).toBe(`#2 (42% keyword) ${UUID_B} -- 2026-05-10T08:00Z`);
  });

  it("renders timestamps as explicit UTC, never a bare date slice (2026-07-05: a minutes-old check read as tomorrow)", () => {
    // 2026-07-06T02:31Z is still 2026-07-05 for everyone west of UTC. The
    // old date-only slice showed "2026-07-06" — a future-looking date. The
    // explicit Z timestamp is convertible to the reader's local time.
    const res = baseResponse();
    res.data!.results![0]!.createdAt = "2026-07-06T02:31:07.000Z";
    const text = renderCheckResponseMarkdown(res);
    expect(text).toContain(`${UUID_A} -- 2026-07-06T02:31Z`);
    expect(text).not.toMatch(/-- 2026-07-06 /); // no bare-date rendering
    // Date objects (the web copy-back path) get the same treatment.
    res.data!.results![0]!.createdAt = new Date("2026-07-06T02:31:07.000Z");
    expect(renderCheckResponseMarkdown(res)).toContain(`${UUID_A} -- 2026-07-06T02:31Z`);
  });

  it("passes non-UTC date strings through unchanged rather than mislabeling them Z", () => {
    const res = baseResponse();
    res.data!.results![0]!.createdAt = "2026-07-05T22:31:07-04:00";
    const text = renderCheckResponseMarkdown(res);
    expect(text).toContain("2026-07-05T22:31:07-04:00");
    expect(text).not.toContain("2026-07-05T22:31Z");
  });

  it("renders evidence with references (regression: old HTTP MCP formatter read evidenceFor and dropped all evidence)", () => {
    const text = renderCheckResponseMarkdown(baseResponse());
    expect(text).toContain("  Supporting: Hono runs on Web Standard APIs. (3 similar entries)");
    expect(text).toContain('    > "Hono handles our edge case"');
    expect(text).toContain("    -- Framework meeting, 2026-03-01");
  });

  it("never emits pagination text; emits a narrowing hint when more results exist", () => {
    const res = baseResponse();
    res.data!.totalPages = 4;
    res.data!.page = 1;
    const text = renderCheckResponseMarkdown(res);
    expect(text).not.toMatch(/Page \d+ of \d+/);
    expect(text).toContain("Narrow with read_recipe_books=<slugs>");
  });

  it("omits the narrowing hint when everything fits on one page", () => {
    const text = renderCheckResponseMarkdown(baseResponse());
    expect(text).not.toContain("Narrow with read_recipe_books");
    expect(text).not.toMatch(/Page \d+ of \d+/);
  });

  it("handles empty results", () => {
    const res: CheckResponseJson = {
      ok: true,
      data: { recipeId: CHECK_ID, searchMode: "semantic", results: [], totalResults: 0, page: 1, totalPages: 0 },
    };
    const text = renderCheckResponseMarkdown(res);
    expect(text).toContain("No similar recipes found.");
  });

  it("picks up formatWarning from either location (MCP: in data; /check JSON: top-level)", () => {
    const inData = baseResponse();
    inData.data!.formatWarning = "warn-in-data";
    expect(renderCheckResponseMarkdown(inData)).toContain("Format suggestion: warn-in-data");

    const topLevel = baseResponse();
    topLevel.formatWarning = "warn-top-level";
    expect(renderCheckResponseMarkdown(topLevel)).toContain("Format suggestion: warn-top-level");
  });

  it("renders related evidence and concept axes", () => {
    const res = baseResponse();
    res.data!.relatedEvidence = [
      { evidenceId: "e1", parentRecipe: "As a dev, I chose X.", evidence: "Interpretation here", similarity: 0.76 },
    ];
    res.data!.conceptAxes = { axisA: "accessibility", axisB: "performance" };
    const text = renderCheckResponseMarkdown(res);
    expect(text).toContain("Related evidence from other recipes:");
    expect(text).toContain("  - Interpretation here (76% similar)");
    expect(text).toContain('Concept axes: "accessibility" (X) / "performance" (Y)');
  });

  it("carries the source recipe UUID on related-evidence entries with a lookup hint (2026-07-05: id-less entries forced re-checks)", () => {
    const res = baseResponse();
    res.data!.relatedEvidence = [
      { evidenceId: "e1", recipeId: UUID_B, parentRecipe: "As a dev, I chose X.", evidence: "Interpretation here", similarity: 0.76 },
    ];
    const text = renderCheckResponseMarkdown(res);
    expect(text).toContain(`    From recipe ${UUID_B}: "As a dev, I chose X."`);
    expect(text).toContain("Fetch any full recipe by id: get_recipes (MCP) or GET /recipes?ids=<id>");
  });

  it("renders search-only responses with a no-logging header instead of a recipeId", () => {
    const res = baseResponse();
    delete res.data!.recipeId;
    res.data!.searchOnly = true;
    res.data!.filter = "postgres migrations";
    const text = renderCheckResponseMarkdown(res);
    expect(text.split("\n")[0]).toBe('Read-only search for "postgres migrations" — no recipe was logged.');
    expect(text).not.toContain("Recipe checked as #");
  });

  it("renders file reference metadata including hash and region", () => {
    const res = baseResponse();
    res.data!.results![0]!.evidence![0]!.references!.push({
      quote: "",
      source: "",
      fileUrl: "https://x/uploads/abc.png",
      fileMimeType: "image/png",
      originalFilename: "shot.png",
      fileHash: "deadbeef",
      regionMeta: { image_box: { x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.9 } },
    });
    const text = renderCheckResponseMarkdown(res);
    expect(text).toContain("    [file: shot.png (image/png)]");
    expect(text).toContain("    [sha256: deadbeef]");
    expect(text).toContain("    [region x 10%–50%, y 20%–90%]");
  });

  it("falls back through semantic → lexical → combined → n/a for the similarity label", () => {
    const res = baseResponse();
    res.data!.results = [
      { id: UUID_A, recipe: "r", createdAt: "2026-01-01T00:00:00Z", score: { combined: 0.1234, semantic: null, lexical: null } },
      { id: UUID_B, recipe: "r2", createdAt: "2026-01-02T00:00:00Z" },
    ];
    const text = renderCheckResponseMarkdown(res);
    expect(text).toContain(`#1 (score 0.12) ${UUID_A}`);
    expect(text).toContain(`#2 (similarity n/a) ${UUID_B}`);
  });

  describe("known_recipes stubs (rendering only)", () => {
    it("renders a declared-known result as a one-line stub with id, gist, and similarity", () => {
      const res = baseResponse();
      const longRecipe = "As a developer working on an API, I chose Hono so that edge deployment stays possible and the framework keeps working across runtimes.";
      res.data!.results![0]!.recipe = longRecipe;
      const text = renderCheckResponseMarkdown(res, { knownRecipeIds: [UUID_A] });
      const stubLine = text.split("\n").find((l) => l.startsWith("#1 "));
      expect(stubLine).toContain(`#1 (87% similar) ${UUID_A} [known to you] (represents 12 similar recipes): `);
      expect(stubLine).toContain(longRecipe.slice(0, 80));
      expect(stubLine!.endsWith("…")).toBe(true);
      // Stub means: no body, no evidence for this result.
      expect(text).not.toContain("Supporting: Hono runs on Web Standard APIs.");
      // The other result still renders in full.
      expect(text).toContain("Recipe: As a designer, I prefer warm palettes");
    });

    it("does not stub results that aren't in knownRecipeIds", () => {
      const text = renderCheckResponseMarkdown(baseResponse(), { knownRecipeIds: [UUID_B] });
      expect(text).toContain("Recipe: As a developer working on an API");
      expect(text).toContain("[known to you]");
      expect(text).not.toContain("Recipe: As a designer, I prefer warm palettes");
    });
  });
});

describe("fenceCheckResponseMarkdown", () => {
  it("wraps in a fenced markdown block with a filename hint", () => {
    const fenced = fenceCheckResponseMarkdown("hello");
    expect(fenced).toBe("```markdown soup-net-check-result.md\nhello\n```");
  });
});

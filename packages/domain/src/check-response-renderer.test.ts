import { describe, it, expect } from "vitest";
import {
  renderCheckResponseMarkdown,
  fenceCheckResponseMarkdown,
  buildOwnExcludedNote,
  flatListPageLine,
  FLAT_LIST_CLAIM_CHARS,
  searchZeroResultLine,
} from "./check-response-renderer";
import type { CheckResponseJson } from "./check-response-renderer";

const UUID_A = "550e8400-e29b-41d4-a716-446655440000";
const UUID_B = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const CHECK_ID = "7676e323-e4a8-493e-b705-febfac26081a";

function baseResponse(): CheckResponseJson {
  return {
    ok: true,
    data: {
      checked: { recipeId: CHECK_ID },
      searchMode: "semantic",
      clustered: true,
      results: [
        {
          recipeId: UUID_A,
          recipe: "As a developer working on an API, I chose Hono so that edge deployment stays possible.",
          createdAt: "2026-04-03T12:34:56.000Z",
          recipeBook: { recipeBookId: "g1", name: "SoupNet" },
          similarity: 0.87,
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
          recipeId: UUID_B,
          recipe: "As a designer, I prefer warm palettes so that pages feel human.",
          createdAt: "2026-05-10T08:00:00.000Z",
          similarity: null,
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
    // ONE similarity vocabulary (recipe ef245b63): no lexical/combined
    // fallbacks — and no chip at all when the score is absent (exact
    // lexical/qualifier matches; 2026-08-19 comprehensibility pass).
    expect(lineB).toBe(`#2 ${UUID_B} -- 2026-05-10T08:00Z`);
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
      data: { checked: { recipeId: CHECK_ID }, searchMode: "semantic", results: [], totalResults: 0, page: 1, totalPages: 0 },
    };
    const text = renderCheckResponseMarkdown(res);
    expect(text).toContain("No similar recipes found.");
    // Slice 7 (S7-D8): thin results are a cue to think harder and check more.
    expect(text).toContain("When results in your context are thin, think harder and check more of your calls, rather than stretching a distant match.");
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
      { recipe: "As a dev, I chose X.", evidence: [{ interpretation: "Interpretation here" }], similarity: 0.76 },
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
      { recipeId: UUID_B, recipe: "As a dev, I chose X.", evidence: [{ interpretation: "Interpretation here" }], similarity: 0.76 },
    ];
    const text = renderCheckResponseMarkdown(res);
    expect(text).toContain(`    From recipe ${UUID_B}: "As a dev, I chose X."`);
    expect(text).toContain("Fetch any full recipe by id: get_recipes (MCP) or GET /recipes?ids=<id>");
  });

  it("renders known evidence parents as ONE compact line of id + similarity pairs (seam 2, 2026-07-18 reshape)", () => {
    const res = baseResponse();
    res.data!.relatedEvidence = [
      { recipeId: "novel-id", recipe: "As a dev, I chose Y.", evidence: [{ interpretation: "Novel interpretation" }], similarity: 0.7 },
    ];
    res.data!.relatedEvidenceKnown = [
      { recipeId: UUID_B, similarity: 0.79 },
      { recipeId: "seen-2", similarity: 0.655 },
    ];
    const text = renderCheckResponseMarkdown(res);
    expect(text).toContain(`  Known evidence parents (already shown): ${UUID_B} 79%, seen-2 66%`);
    expect(text).toContain("  - Novel interpretation (70% similar)");
  });

  it("renders the known-parents line even when every candidate parent was known (no novel entries)", () => {
    const res = baseResponse();
    res.data!.relatedEvidenceKnown = [{ recipeId: UUID_B, similarity: 0.8 }];
    const text = renderCheckResponseMarkdown(res);
    expect(text).toContain("Related evidence from other recipes:");
    expect(text).toContain(`  Known evidence parents (already shown): ${UUID_B} 80%`);
  });

  it("renders search-only responses with a no-logging header instead of a recipeId", () => {
    const res = baseResponse();
    delete res.data!.checked;
    res.data!.searchOnly = true;
    res.data!.filter = "postgres migrations";
    const text = renderCheckResponseMarkdown(res);
    expect(text.split("\n")[0]).toBe('Read-only search for "postgres migrations".');
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

  it("omits the similarity chip when the score is absent — no lexical/combined fallbacks (recipe ef245b63), no n/a placeholder (2026-08-19)", () => {
    const res = baseResponse();
    res.data!.results = [
      { recipeId: UUID_A, recipe: "r", createdAt: "2026-01-01T00:00:00Z", similarity: null },
      { recipeId: UUID_B, recipe: "r2", createdAt: "2026-01-02T00:00:00Z" },
    ];
    const text = renderCheckResponseMarkdown(res);
    expect(text).toContain(`#1 ${UUID_A}`);
    expect(text).toContain(`#2 ${UUID_B}`);
    expect(text).not.toContain("similarity n/a");
  });

  describe("premium synthesis", () => {
    it("renders a ## Synthesis section between the header and the exemplars when synthesis is present", () => {
      const res = baseResponse();
      res.data!.synthesis = "You favor Hono for edge deployment [id-a] over warm palettes [id-b].";
      const text = renderCheckResponseMarkdown(res);
      const headerPos = text.indexOf(`Recipe checked as #${CHECK_ID}`);
      const synthPos = text.indexOf("## Synthesis");
      const firstExemplarPos = text.indexOf("#1 ");
      expect(synthPos).toBeGreaterThan(headerPos);
      expect(synthPos).toBeLessThan(firstExemplarPos);
      expect(text).toContain("## Synthesis\nYou favor Hono for edge deployment [id-a] over warm palettes [id-b].");
    });

    it("renders the notice as a plain line (no heading) when only synthesisNotice is present", () => {
      const res = baseResponse();
      res.data!.synthesisNotice = "Synthesis is a premium feature — enable it in settings.";
      const text = renderCheckResponseMarkdown(res);
      expect(text).not.toContain("## Synthesis");
      const noticePos = text.indexOf("Synthesis is a premium feature");
      const firstExemplarPos = text.indexOf("#1 ");
      expect(noticePos).toBeGreaterThan(0);
      expect(noticePos).toBeLessThan(firstExemplarPos);
    });

    it("prefers the synthesis section over the notice when both are set", () => {
      const res = baseResponse();
      res.data!.synthesis = "Profile paragraph.";
      res.data!.synthesisNotice = "premium hint";
      const text = renderCheckResponseMarkdown(res);
      expect(text).toContain("## Synthesis\nProfile paragraph.");
      expect(text).not.toContain("premium hint");
    });

    it("omits both when neither is set", () => {
      const text = renderCheckResponseMarkdown(baseResponse());
      expect(text).not.toContain("## Synthesis");
    });

    it("still renders the synthesis section in position when there are no exemplars", () => {
      const res: CheckResponseJson = {
        ok: true,
        data: {
          checked: { recipeId: CHECK_ID },
          searchMode: "semantic",
          results: [],
          totalResults: 0,
          page: 1,
          totalPages: 0,
          synthesis: "A profile even with no similar recipes.",
        },
      };
      const text = renderCheckResponseMarkdown(res);
      const synthPos = text.indexOf("## Synthesis");
      const noResultsPos = text.indexOf("No similar recipes found.");
      expect(synthPos).toBeGreaterThan(0);
      expect(synthPos).toBeLessThan(noResultsPos);
    });
  });

  describe("known-set stubs (rendering only)", () => {
    it("renders a declared-known result as a one-line id-only stub (no gist text)", () => {
      const res = baseResponse();
      const recipeText = res.data!.results![0]!.recipe!;
      const text = renderCheckResponseMarkdown(res, { knownRecipeIds: [UUID_A] });
      const stubLine = text.split("\n").find((l) => l.startsWith("#1 "));
      expect(stubLine).toBe(`#1 (87% similar) ${UUID_A} [known to you] (represents 12 similar recipes)`);
      // Id-only: no recipe text on the stub (operator ruling — the gist is
      // an ossification risk; bodies come from get_recipes).
      expect(stubLine).not.toContain(recipeText.slice(0, 40));
      // Stub means: no body, no evidence for this result.
      expect(text).not.toContain("Supporting: Hono runs on Web Standard APIs.");
      // The other result still renders in full.
      expect(text).toContain("Recipe: As a designer, I prefer warm palettes");
    });

    it("stubs results the builder flagged known (session known-set), without opts", () => {
      const res = baseResponse();
      res.data!.results![0]!.known = true;
      const text = renderCheckResponseMarkdown(res);
      const stubLine = text.split("\n").find((l) => l.startsWith("#1 "));
      expect(stubLine).toBe(`#1 (87% similar) ${UUID_A} [known to you] (represents 12 similar recipes)`);
      expect(text).not.toContain("Recipe: As a developer working on an API");
    });

    it("does not stub results that aren't in knownRecipeIds", () => {
      const text = renderCheckResponseMarkdown(baseResponse(), { knownRecipeIds: [UUID_B] });
      expect(text).toContain("Recipe: As a developer working on an API");
      expect(text).toContain("[known to you]");
      expect(text).not.toContain("Recipe: As a designer, I prefer warm palettes");
    });

    it("renders knownMembers on a full item as one compact cluster-mates line with percentages", () => {
      const res = baseResponse();
      res.data!.results![0]!.knownMembers = [
        { recipeId: UUID_B, similarity: 0.94 },
        { recipeId: "seen-2", similarity: 0.87 },
      ];
      const text = renderCheckResponseMarkdown(res);
      expect(text).toContain(`  [cluster also holds 2 you've seen: ${UUID_B} 94%, seen-2 87%]`);
      // The item itself still renders in full.
      expect(text).toContain("Recipe: As a developer working on an API");
    });
  });

  describe("sessionId line", () => {
    it("renders one session line when data.sessionId is present", () => {
      const res = baseResponse();
      res.data!.sessionId = "0f8d0af7-9503-4f92-a2f0-a8e11b79900d";
      const text = renderCheckResponseMarkdown(res);
      expect(text).toContain(
        "Session: 0f8d0af7-9503-4f92-a2f0-a8e11b79900d — pass session_id on your next check to keep responses lean.",
      );
    });

    it("still renders the session line when there are no results", () => {
      const res: CheckResponseJson = {
        ok: true,
        data: { checked: { recipeId: CHECK_ID }, searchMode: "semantic", results: [], totalResults: 0, page: 1, totalPages: 0, sessionId: "abc12345" },
      };
      const text = renderCheckResponseMarkdown(res);
      expect(text).toContain("No similar recipes found.");
      expect(text).toContain("Session: abc12345 — pass session_id on your next check");
    });

    it("omits the session line when sessionId is absent", () => {
      expect(renderCheckResponseMarkdown(baseResponse())).not.toContain("Session:");
    });
  });
});

describe("fenceCheckResponseMarkdown", () => {
  it("wraps in a fenced markdown block with a filename hint", () => {
    const fenced = fenceCheckResponseMarkdown("hello");
    expect(fenced).toBe("```markdown soup-net-check-result.md\nhello\n```");
  });
});

describe("buildOwnExcludedNote (cold-start v2 Phase A)", () => {
  it("returns empty when no own-exclusion applied", () => {
    expect(buildOwnExcludedNote(undefined, 10)).toBe("");
    expect(buildOwnExcludedNote(0, 10)).toBe("");
  });

  it("names a partial exclusion with the override pointer", () => {
    const note = buildOwnExcludedNote(3, 10);
    expect(note).toContain("3 of them are your own recipes");
    expect(note).toContain("author:anyone");
  });

  it("says 'all N' when the whole scope is the caller's own (solo-corpus trap)", () => {
    const note = buildOwnExcludedNote(10, 10);
    expect(note).toContain("all 10 are your own recipes");
    expect(note).toContain("author:anyone");
  });

  it("an empty is:draft search points at is:expired and is not a thin-corpus signal", () => {
    for (const filter of ["is:draft", "is:draft intent:int_abcdefghijklmnopqrstuvwx", "wording is:draft"]) {
      const line = searchZeroResultLine({ filter, searchedCorpusSize: 7 });
      expect(line).toBe("No open drafts match among the 7 recipes in scope. Expired drafts aren't listed here; is:expired finds them.");
    }
    // Not a poll for open drafts: the ordinary line.
    for (const filter of ["-is:draft wording", "is:expired", "wording"]) {
      expect(searchZeroResultLine({ filter, searchedCorpusSize: 7 }), filter).toContain("thin-corpus signal");
    }
    expect(searchZeroResultLine({ searchedCorpusSize: 7 })).toContain("thin-corpus signal");
    // An unrecognized intent: id still says so first.
    expect(searchZeroResultLine({ filter: "is:draft intent:int_abcdefghijklmnopqrstuvwx", intentNotRecognized: true })).toContain("not recognized");
    // Both markdown paths carry it.
    for (const extra of [{}, { listOrder: "triage" as const }]) {
      const text = renderCheckResponseMarkdown({ ok: true, data: { searchOnly: true, filter: "is:draft", results: [], totalResults: 0, ...extra } });
      expect(text).toContain("is:expired finds them");
    }
  });

  it("renders inside the zero-result search markdown", () => {
    const text = renderCheckResponseMarkdown({
      ok: true,
      data: {
        searchOnly: true,
        filter: "test",
        results: [],
        totalResults: 0,
        searchedCorpusSize: 5,
        searchedOwnExcluded: 5,
      },
    });
    expect(text).toContain("No matches among the 5 recipes in scope");
    expect(text).toContain("all 5 are your own recipes");
    expect(text).toContain("thin-corpus signal");
  });
});

// drafts-and-triage slice 1: the deposit's triage ratings in the markdown
// report (MCP default format and the web copy-back).
describe("renderCheckResponseMarkdown — triage ratings", () => {
  const base = (checked: Record<string, unknown>, extra: Record<string, unknown> = {}): CheckResponseJson => ({
    ok: true,
    data: { checked: { recipeId: "r-1", recipe: "x", ...checked }, results: [], ...extra },
  });

  it("S1-B1 / DT-RAT-01: echoes the ratings as the agent's own, right under the checked line", () => {
    const text = renderCheckResponseMarkdown(base({ impact: "high", uncertainty: "medium" }));
    expect(text.startsWith("Recipe checked as #r-1\nYour ratings: impact high, uncertainty medium (triage only, never ranking).\n")).toBe(true);
  });

  it("S1-B2: agents that never rate see no ratings line (JSON carries the nulls)", () => {
    expect(renderCheckResponseMarkdown(base({ impact: null, uncertainty: null }))).not.toContain("Your ratings");
    expect(renderCheckResponseMarkdown(base({}))).not.toContain("Your ratings");
  });

  it("S1-B3 / S1-B5: a ratings notice renders with the stored ratings", () => {
    const text = renderCheckResponseMarkdown(base({ impact: "low", uncertainty: null }, { ratingsNotice: "First ratings stand." }));
    expect(text).toContain("Your ratings: impact low, uncertainty not rated (triage only, never ranking).\nFirst ratings stand.\n");
  });

  it("read-only searches carry no ratings line", () => {
    const text = renderCheckResponseMarkdown({ ok: true, data: { searchOnly: true, checked: { recipeId: "r", impact: "high" }, results: [] } });
    expect(text).not.toContain("Your ratings");
  });
});

describe("renderCheckResponseMarkdown — drafts (slice 2)", () => {
  it("DT-VIS-01: a draft deposit says so under the checked line", () => {
    const r = baseResponse();
    r.data!.checked = { recipeId: CHECK_ID, draftState: "unverified" };
    r.data!.draftNotice = "Deposited as a draft: until it is verified, only you and your own agents can see it.";
    const md = renderCheckResponseMarkdown(r);
    const [first, second] = md.split("\n");
    expect(first).toBe(`Recipe checked as #${CHECK_ID}`);
    expect(second).toContain("Deposited as a draft");
  });

  it("DT-VIS-06: an own draft in results is labelled on its line, full and stub alike", () => {
    const r = baseResponse();
    r.data!.results![0]!.draftState = "unverified";
    r.data!.results!.push({ recipeId: UUID_B, known: true, similarity: 0.5, draftState: "unverified" });
    const md = renderCheckResponseMarkdown(r);
    const lines = md.split("\n");
    expect(lines.find((l) => l.includes(UUID_A))).toContain("[unverified draft");
    expect(lines.find((l) => l.includes(UUID_B) && l.includes("[known to you]"))).toContain("[unverified draft");
  });

  it("a published recipe carries no draft label", () => {
    const md = renderCheckResponseMarkdown(baseResponse());
    expect(md).not.toContain("draft");
  });
});

describe("renderCheckResponseMarkdown — ratings on own drafts (slice 3, S3-AG2, S3-Z4)", () => {
  it("a rated own draft's label names the ratings, adding at most 40 bytes", () => {
    const unrated = baseResponse();
    unrated.data!.results![0]!.draftState = "unverified";
    const rated = baseResponse();
    rated.data!.results![0] = { ...rated.data!.results![0]!, draftState: "unverified", impact: "medium", uncertainty: null };
    const a = renderCheckResponseMarkdown(unrated);
    const b = renderCheckResponseMarkdown(rated);
    expect(b).toContain("; impact medium, uncertainty not rated]");
    const grew = Buffer.byteLength(b, "utf8") - Buffer.byteLength(a, "utf8");
    expect(grew).toBeGreaterThan(0);
    expect(grew).toBeLessThanOrEqual(40);
  });

  it("an unrated own draft renders exactly as before, and ratings on a non-draft row are never printed", () => {
    const before = baseResponse();
    before.data!.results![0]!.draftState = "unverified";
    const withNulls = baseResponse();
    withNulls.data!.results![0] = { ...withNulls.data!.results![0]!, draftState: "unverified", impact: null, uncertainty: null };
    expect(renderCheckResponseMarkdown(withNulls)).toBe(renderCheckResponseMarkdown(before));
    const published = baseResponse();
    published.data!.results![0] = { ...published.data!.results![0]!, impact: "high", uncertainty: "high" };
    expect(renderCheckResponseMarkdown(published)).toBe(renderCheckResponseMarkdown(baseResponse()));
  });
});

// Slice 10: the dispatch line and the expired label (S10-D1, S10-D5, S10-R3).
describe("renderCheckResponseMarkdown — drafts as a bus", () => {
  const base = { ok: true as const, data: { totalResults: 1, results: [{ recipeId: "r1", recipe: "As a dev, I prefer X so that Y.", similarity: 0.7 }] } };

  it("puts the open question line after the exemplars, before related evidence", () => {
    const text = renderCheckResponseMarkdown({
      ...base,
      data: {
        ...base.data,
        relatedEvidence: [{ recipeId: "r2", recipe: "As a dev, I prefer Z.", similarity: 0.6, evidence: [{ interpretation: "because" }] }],
        openQuestion: { recipeId: "d1", askedAt: "2026-10-24T10:00:00Z" },
      },
    });
    const line = "Open question near this call: d1 (asked 2026-10-24). If your context settles it, resolve it; otherwise leave it.";
    expect(text).toContain(line);
    expect(text.indexOf(line)).toBeGreaterThan(text.indexOf("#1 "));
    expect(text.indexOf(line)).toBeLessThan(text.indexOf("Related evidence from other recipes"));
  });

  it("adds nothing when there is no open question", () => {
    expect(renderCheckResponseMarkdown(base)).not.toContain("Open question");
  });

  it("labels an expired draft in results with why it expired", () => {
    const text = renderCheckResponseMarkdown({
      ...base,
      data: { ...base.data, results: [{ ...base.data.results[0]!, draftState: "unverified", draftExpired: "age" }] },
    });
    expect(text).toContain("[expired draft: it was deposited with no intent over 7 days ago");
  });
});

describe("the flat list (slice 8b, S8b-L1, S8b-L2)", () => {
  const long = `As a steward ${"x".repeat(300)}`;
  const flat = (over: Record<string, unknown> = {}): CheckResponseJson => ({
    ok: true,
    data: {
      searchOnly: true,
      filter: "author:me",
      searchId: "s-1",
      listOrder: "judgment",
      perPage: 50,
      results: [
        { recipeId: UUID_A, recipe: "Short claim.", createdAt: "2026-01-15T00:00:00.000Z", loggedAt: "2026-10-26T01:00:00.000Z", changedAt: "2026-10-26T02:00:00.000Z", recipeBook: { name: "SoupNet" } },
        { recipeId: UUID_B, recipe: long, createdAt: "2026-10-20T08:15:00.000Z", loggedAt: "2026-10-20T08:15:00.000Z", changedAt: "2026-10-26T03:00:00.000Z", draftState: "unverified", impact: "high", uncertainty: null, known: true },
      ],
      totalResults: 120,
      page: 1,
      totalPages: 3,
      sessionId: "sess-1",
      intentNotice: "Intent: int_x",
      ...over,
    },
  });

  it("lists every row in full with its id, time and book, then the page line naming the next page", () => {
    const text = renderCheckResponseMarkdown(flat());
    expect(text).toContain("120 recipe(s) match, listed newest judgment date first; each row shows its judgment date:");
    expect(text).toContain(`- ${UUID_A} 2026-01-15T00:00Z [SoupNet] Short claim.`);
    // A known recipe is not stubbed: a sweep needs every id (S8b-L5).
    expect(text).toContain(`- ${UUID_B} 2026-10-20T08:15Z`);
    expect(text).not.toContain("known to you");
    expect(text).toContain("Page 1 of 3, 50 per page. Next: page=2.");
    expect(text).toContain("Fetch full recipes by id");
    expect(text).toContain("Session: sess-1");
    expect(text).toContain("Intent: int_x");
    expect(text).not.toMatch(/similar recipe\(s\) found|clustered to|Related evidence/);
  });

  it("cuts a long claim at the limit with an ellipsis, and labels the viewer's own draft", () => {
    const text = renderCheckResponseMarkdown(flat());
    const line = text.split("\n").find((l) => l.includes(UUID_B))!;
    expect(line).toContain(`${long.slice(0, FLAT_LIST_CLAIM_CHARS)}…`);
    expect(line).not.toContain(long.slice(0, FLAT_LIST_CLAIM_CHARS + 1));
    expect(line).toMatch(/draft/);
  });

  it("shows the time each order reads: logged for triage, changed for changed-after:", () => {
    const triage = renderCheckResponseMarkdown(flat({ listOrder: "triage" }));
    expect(triage).toContain("listed in triage order");
    expect(triage).toContain(`- ${UUID_A} 2026-10-26T01:00Z`);
    const changed = renderCheckResponseMarkdown(flat({ listOrder: "changed" }));
    expect(changed).toContain("listed latest change first");
    expect(changed).toContain(`- ${UUID_A} 2026-10-26T02:00Z`);
  });

  it("falls back to the judgment date when a row carries no other time", () => {
    const bare = flat({ listOrder: "changed", results: [{ recipeId: UUID_A, recipe: "Short claim.", createdAt: "2026-01-15T00:00:00.000Z" }], totalResults: 1, totalPages: 1 });
    const text = renderCheckResponseMarkdown(bare);
    expect(text).toContain(`- ${UUID_A} 2026-01-15T00:00Z Short claim.`);
    expect(text).toContain("Page 1 of 1, 50 per page. This is the last page.");
    const triage = renderCheckResponseMarkdown({ ...bare, data: { ...bare.data, listOrder: "triage" } });
    expect(triage).toContain(`- ${UUID_A} 2026-01-15T00:00Z`);
  });

  it("an empty page past the end says so; no matches is the zero line", () => {
    const past = renderCheckResponseMarkdown(flat({ results: [], page: 4 }));
    expect(past).toContain("Page 4 is past the end: 120 match(es) on 3 page(s) of 50.");
    const none = renderCheckResponseMarkdown(flat({ results: [], totalResults: 0, totalPages: 0, searchedCorpusSize: 7, sessionId: undefined, intentNotice: undefined }));
    expect(none).toContain("No matches among the 7 recipes in scope");
    expect(none).not.toContain("Session:");
  });

  it("tolerates missing page fields and ids", () => {
    const text = renderCheckResponseMarkdown(flat({ results: [{ recipe: "No id." }], totalResults: undefined, page: undefined, totalPages: undefined, perPage: undefined }));
    expect(text).toContain("1 recipe(s) match");
    expect(text).toContain("- ? ");
    expect(text).toContain("Page 1 of 1, 1 per page. This is the last page.");
  });

  it("flatListPageLine at the listing depth (F110): the last reachable page says so instead of naming the next", () => {
    expect(flatListPageLine({ page: 199, totalPages: 300, totalResults: 15_000, perPage: 50 })).toBe("Page 199 of 300, 50 per page. Next: page=200.");
    expect(flatListPageLine({ page: 200, totalPages: 300, totalResults: 15_000, perPage: 50 })).toBe(
      "Page 200 of 300, 50 per page. This is the last page the list reaches (its first 10,000 matches). "
      + "Narrow the query with changed-after:, created-after: or read_recipe_books to reach the rest.",
    );
    // Exactly at the reach with nothing beyond it: an ordinary last page.
    expect(flatListPageLine({ page: 200, totalPages: 200, totalResults: 10_000, perPage: 50 })).toBe("Page 200 of 200, 50 per page. This is the last page.");
  });

  it("flatListPageLine: middle, last, past the end, and nothing for no matches", () => {
    expect(flatListPageLine({ page: 2, totalPages: 3, totalResults: 120, perPage: 50 })).toBe("Page 2 of 3, 50 per page. Next: page=3.");
    expect(flatListPageLine({ page: 3, totalPages: 3, totalResults: 120, perPage: 50 })).toBe("Page 3 of 3, 50 per page. This is the last page.");
    expect(flatListPageLine({ page: 9, totalPages: 3, totalResults: 120, perPage: 50 })).toBe("Page 9 is past the end: 120 match(es) on 3 page(s) of 50.");
    expect(flatListPageLine({ page: 1, totalPages: 0, totalResults: 0, perPage: 50 })).toBe("");
  });

  it("a checked response is never the flat list, even with listOrder set", () => {
    const text = renderCheckResponseMarkdown({ ok: true, data: { checked: { recipeId: UUID_A }, listOrder: "judgment", results: [], totalResults: 0 } });
    expect(text).toContain(`Recipe checked as #${UUID_A}`);
    expect(text).not.toContain("recipe(s) match");
  });
});

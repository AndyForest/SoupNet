import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { hybridSearch, evidenceSearch } from "./vector-search.service";
import { runSearchPipeline } from "./search-pipeline";
import { embedQuery } from "../lib/embeddings/provider";

/**
 * Embed-once contract tests (2026-07-01 latency findings).
 *
 * The provider module is fully mocked so no Gemini client (and no ../db
 * import chain) is loaded; the searches themselves run against the real
 * integration DB. Asserts:
 *   - a provided queryVectorStr means ZERO embedding calls in hybridSearch,
 *     evidenceSearch, and the whole search pipeline;
 *   - without one, the pipeline resolves the query embedding exactly ONCE
 *     and shares it between trace search and evidence search (previously two
 *     identical sequential API calls per check).
 */

vi.mock("../lib/embeddings/provider", () => ({
  embedQuery: vi.fn(async () => new Array(3072).fill(0.01) as number[]),
  embedMultimodal: vi.fn(async () => new Array(3072).fill(0.01) as number[]),
  batchEmbed: vi.fn(async () => []),
  getEmbeddingProviderId: () => "stub" as const,
  // The search services now filter on model_id (fail-safe across providers), so
  // the mock must supply it too — else getEmbeddingModelId() is undefined at the
  // query call site. Any stable string works; these tests assert embed-call
  // counts against NO_SUCH_GROUP, not result rows.
  getEmbeddingModelId: () => "stub-embeddings",
}));

const BASE = process.env["BACKEND_URL"] ?? "";
const VEC_3072 = `[${new Array(3072).fill(0.01).join(",")}]`;
// Any syntactically valid uuid works — empty search results are fine, the
// assertions are about which code path resolves the query vector.
const NO_SUCH_GROUP = "00000000-0000-4000-8000-000000000000";

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getDb: typeof import("../db").getDb;

describe.skipIf(!BASE)("query-vector reuse (embed-once contract)", () => {
  beforeAll(async () => {
    getDb = (await import("../db")).getDb;
  });

  beforeEach(() => {
    vi.mocked(embedQuery).mockClear();
  });

  it("hybridSearch with queryVectorStr makes no embedding call", async () => {
    const res = await hybridSearch(getDb(), {
      recipeText: "As a tester, I check that no embed call happens.",
      groupIds: [NO_SUCH_GROUP],
      limit: 5,
      offset: 0,
      queryVectorStr: VEC_3072,
    });
    expect(res.searchMode).toBe("semantic");
    expect(embedQuery).not.toHaveBeenCalled();
  });

  it("hybridSearch without queryVectorStr falls back to one embedding call", async () => {
    await hybridSearch(getDb(), {
      recipeText: "As a tester, I check the fallback embed path.",
      groupIds: [NO_SUCH_GROUP],
      limit: 5,
      offset: 0,
    });
    expect(embedQuery).toHaveBeenCalledTimes(1);
  });

  it("evidenceSearch with queryVectorStr makes no embedding call", async () => {
    await evidenceSearch(getDb(), {
      queryText: "As a tester, I check evidence search reuse.",
      groupIds: [NO_SUCH_GROUP],
      queryVectorStr: VEC_3072,
    });
    expect(embedQuery).not.toHaveBeenCalled();
  });

  it("runSearchPipeline with queryVectorStr makes no embedding call", async () => {
    await runSearchPipeline({
      db: getDb(),
      groupIds: [NO_SUCH_GROUP],
      query: "As a tester, I check the pipeline reuses the caller's vector.",
      queryVectorStr: VEC_3072,
      perPage: 5,
    });
    expect(embedQuery).not.toHaveBeenCalled();
  });

  it("runSearchPipeline without queryVectorStr embeds exactly once for both searches", async () => {
    await runSearchPipeline({
      db: getDb(),
      groupIds: [NO_SUCH_GROUP],
      query: "As a tester, I check the pipeline embeds once and shares it.",
      perPage: 5,
    });
    expect(embedQuery).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect } from "vitest";
import { batchEmbed } from "./gemini-client";

/**
 * Real Gemini embedding API smoke test.
 *
 * This is the SINGLE test in the suite that intentionally bypasses the stub
 * provider and exercises the real network path. Embeddings are cheap, so one
 * call per test run is acceptable. Everything else uses the stub provider
 * (EMBEDDINGS_PROVIDER=stub) and runs offline.
 *
 * Skips automatically when GEMINI_API_KEY is unset. When a key is present,
 * this test will fail loudly if Gemini's API contract changes (response shape,
 * dimensionality, model id) — which is the whole point of having one real test.
 *
 * If this test starts flaking, the right fix is to investigate Gemini's
 * status / our key / our request shape — NOT to mock it. The stub provider
 * already covers the "tests should be fast and free" use case.
 */

const HAS_KEY = Boolean(process.env["GEMINI_API_KEY"]);

describe.skipIf(!HAS_KEY)("gemini-client real API smoke test", () => {
  it("batchEmbed returns a 3072-dim numeric vector for a single text", async () => {
    const out = await batchEmbed(
      ["ClaimNet smoke test — verify Gemini embedding API integration."],
      "RETRIEVAL_DOCUMENT",
    );

    expect(out).toHaveLength(1);
    const vec = out[0]!;
    expect(vec).toHaveLength(3072);
    expect(vec.every((v) => typeof v === "number" && Number.isFinite(v))).toBe(true);

    const sumAbs = vec.reduce((acc, v) => acc + Math.abs(v), 0);
    expect(sumAbs).toBeGreaterThan(0);
  }, 30_000);

  it("batchEmbed returns one vector per input", async () => {
    const out = await batchEmbed(["one", "two"], "RETRIEVAL_DOCUMENT");
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(3072);
    expect(out[1]).toHaveLength(3072);
    expect(out[0]).not.toEqual(out[1]);
  }, 30_000);
});

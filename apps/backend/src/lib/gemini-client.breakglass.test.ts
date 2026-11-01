import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { batchEmbed, embedQuery } from "./gemini-client";

describe("emergency fallback wire", () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

  beforeEach(() => {
    calls.length = 0;
    vi.stubEnv("GEMINI_API_KEY", "fake");
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      return new Response(JSON.stringify({ embedding: { values: [1] }, embeddings: [{ values: [1] }] }));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends GA on the batch path whatever the row is labelled, with no taskType", async () => {
    await batchEmbed(["x"], "SEMANTIC_SIMILARITY", "gemini-embedding-2-preview");
    expect(calls[0]!.url).toContain("/models/gemini-embedding-2:batchEmbedContents");
    const request = (calls[0]!.body["requests"] as Array<Record<string, unknown>>)[0]!;
    expect(request["model"]).toBe("models/gemini-embedding-2");
    expect(request).not.toHaveProperty("taskType");
  });

  it("sends GA on the sync path, with no taskType", async () => {
    await embedQuery("x");
    expect(calls[0]!.url).toContain("/models/gemini-embedding-2:embedContent");
    expect(calls[0]!.body["model"]).toBe("models/gemini-embedding-2");
    expect(calls[0]!.body).not.toHaveProperty("taskType");
  });
});

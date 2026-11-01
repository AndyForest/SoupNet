import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The one setting path for the model. Each test loads provider.ts fresh for its env. */
async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const name of [
    "EMBEDDINGS_PROVIDER",
    "EMBEDDINGS_MODEL",
    "EMBEDDINGS_REBUILD_TARGET",
    "EMBEDDINGS_REBUILD_VECTORS_PER_MINUTE",
  ]) {
    vi.stubEnv(name, env[name] ?? "");
  }
  return import("./provider");
}

describe("embedding model configuration", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("gemini: reads the id from EMBEDDINGS_MODEL; unset waits for the database, and never defaults", async () => {
    const p = await load({ EMBEDDINGS_PROVIDER: "gemini", EMBEDDINGS_MODEL: "gemini-embedding-2" });
    expect(p.getEmbeddingModelId()).toBe("gemini-embedding-2");
    expect(p.getActiveEmbeddingModelIds()).toEqual(["gemini-embedding-2"]);

    for (const unset of ["", "   "]) {
      const empty = await load({ EMBEDDINGS_PROVIDER: "gemini", EMBEDDINGS_MODEL: unset });
      expect(() => empty.validateEmbeddingConfig()).not.toThrow();
      expect(() => empty.getEmbeddingModelId()).toThrow(/isn't settled/);
      empty.setResolvedGeminiReadModel("gemini-embedding-2-preview");
      expect(empty.getEmbeddingModelId()).toBe("gemini-embedding-2-preview");
    }
  });

  it("gemini: refuses an id it doesn't know, naming the ones it does", async () => {
    const p = await load({ EMBEDDINGS_PROVIDER: "gemini", EMBEDDINGS_MODEL: "gemini-embedding-2-previw" });
    expect(() => p.validateEmbeddingConfig()).toThrow(/not a known.*gemini-embedding-2-preview/);
  });

  it("rebuild target: an active model, refused when unknown or the same as reads", async () => {
    const p = await load({
      EMBEDDINGS_PROVIDER: "gemini",
      EMBEDDINGS_MODEL: "gemini-embedding-2-preview",
      EMBEDDINGS_REBUILD_TARGET: "gemini-embedding-2",
    });
    p.validateEmbeddingConfig();
    expect(p.getActiveEmbeddingModelIds()).toEqual(["gemini-embedding-2-preview", "gemini-embedding-2"]);

    const unknown = await load({
      EMBEDDINGS_PROVIDER: "gemini",
      EMBEDDINGS_MODEL: "gemini-embedding-2-preview",
      EMBEDDINGS_REBUILD_TARGET: "gemini-3",
    });
    expect(() => unknown.validateEmbeddingConfig()).toThrow(/EMBEDDINGS_REBUILD_TARGET.*not a known/);

    const same = await load({
      EMBEDDINGS_PROVIDER: "gemini",
      EMBEDDINGS_MODEL: "gemini-embedding-2",
      EMBEDDINGS_REBUILD_TARGET: "gemini-embedding-2",
    });
    expect(() => same.validateEmbeddingConfig()).toThrow(/already use/);
  });

  it("a rebuild target needs a provider that can run two models", async () => {
    const stub = await load({ EMBEDDINGS_PROVIDER: "stub", EMBEDDINGS_REBUILD_TARGET: "anything" });
    expect(() => stub.validateEmbeddingConfig()).toThrow(/not supported/);
    expect(stub.getEmbeddingProviderId()).toBe("stub");

    const local = await load({ EMBEDDINGS_PROVIDER: "local", EMBEDDINGS_REBUILD_TARGET: "anything" });
    expect(() => local.validateEmbeddingConfig()).toThrow(/not supported/);
  });

  it("openai-compatible: a target keeps the same id shape as the read model", async () => {
    const p = await load({
      EMBEDDINGS_PROVIDER: "openai-compatible",
      EMBEDDINGS_MODEL: "org/old-model",
      EMBEDDINGS_REBUILD_TARGET: "org/new-model",
    });
    p.validateEmbeddingConfig();
    expect(p.getActiveEmbeddingModelIds()).toEqual(["oai:old-model", "oai:new-model"]);
  });

  it("stub still needs no model, and ignores EMBEDDINGS_MODEL", async () => {
    const p = await load({ EMBEDDINGS_PROVIDER: "stub", EMBEDDINGS_MODEL: "ignored" });
    p.validateEmbeddingConfig();
    expect(p.getEmbeddingModelId()).toBe("stub-embeddings");
  });

  it("the rebuild pace defaults to 600 a minute, allows 0 to pause, and refuses anything else", async () => {
    const dflt = await load({ EMBEDDINGS_PROVIDER: "stub" });
    expect(dflt.getRebuildVectorsPerMinute()).toBe(600);
    const zero = await load({ EMBEDDINGS_PROVIDER: "stub", EMBEDDINGS_REBUILD_VECTORS_PER_MINUTE: "0" });
    expect(zero.getRebuildVectorsPerMinute()).toBe(0);
    const bad = await load({ EMBEDDINGS_PROVIDER: "stub", EMBEDDINGS_REBUILD_VECTORS_PER_MINUTE: "fast" });
    expect(() => bad.validateEmbeddingConfig()).toThrow(/whole number/);
  });
});

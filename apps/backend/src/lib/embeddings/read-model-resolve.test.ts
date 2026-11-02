import { describe, expect, it } from "vitest";
import { chooseGeminiReadModel } from "./read-model-resolve";

const PREVIEW = "gemini-embedding-2-preview";
const GA = "gemini-embedding-2";

const choose = (vectorModels: string[], target: string | null = null, cachedModels: string[] = []) =>
  chooseGeminiReadModel({ vectorModels, cachedModels, target }).modelId;

describe("the read model when EMBEDDINGS_MODEL is unset", () => {
  it("stays on the one model holding vectors, even where the recommended model differs", () => {
    expect(choose([PREVIEW])).toBe(PREVIEW);
    expect(choose([GA])).toBe(GA);
  });

  it("gives a fresh database the recommended model", () => {
    expect(choose([])).toBe(GA);
  });

  it("with a rebuild running, reads the model that isn't the target", () => {
    expect(choose([PREVIEW], GA)).toBe(PREVIEW);
    expect(choose([PREVIEW, GA], GA)).toBe(PREVIEW);
    expect(choose([PREVIEW, GA], PREVIEW)).toBe(GA);
  });

  it("refuses to guess between two models with no target", () => {
    expect(() => choose([PREVIEW, GA])).toThrow(/Refusing to guess/);
  });

  it("refuses when only the target holds vectors, rather than reading from it", () => {
    expect(() => choose([GA], GA)).toThrow(/only vectors are under the rebuild target/);
  });

  it("refuses when the only Gemini vectors are under a model this code doesn't run", () => {
    expect(() => choose(["gemini-embedding-001"])).toThrow(/doesn't run/);
  });

  it("ignores a retired model's rows beside a model it runs", () => {
    expect(choose(["gemini-embedding-001", PREVIEW])).toBe(PREVIEW);
  });

  it("with no vectors, keeps a reset stack on the model it has cached", () => {
    expect(choose([], null, [PREVIEW])).toBe(PREVIEW);
    expect(choose([], null, [PREVIEW, GA])).toBe(GA);
    expect(choose([PREVIEW], null, [GA])).toBe(PREVIEW);
  });

  it("refuses a fresh database whose target is the recommended model", () => {
    expect(() => choose([], GA)).toThrow(/rebuild target is the recommended/);
    expect(choose([], PREVIEW)).toBe(GA);
  });
});

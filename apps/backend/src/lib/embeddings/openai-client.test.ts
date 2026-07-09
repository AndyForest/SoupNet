import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import { embedQuery, embedMultimodal, batchEmbed } from "./openai-client";
import type { ContentPart } from "../gemini-client";

/**
 * Unit test for the OpenAI-compatible embedding client.
 *
 * The whole suite runs offline (see gemini-client.test.ts for the one
 * intentional real-network exception). This client's only I/O is a single
 * global `fetch`, so we intercept `globalThis.fetch` with a vitest spy — that
 * verifies every externally observable property of the request (URL, method,
 * JSON body, Authorization header) and lets us return a canned response,
 * without adding an HTTP-mock dependency and without touching the network.
 */

const BASE = "http://localhost:8080/v1";

/** Build a real Response so the client's own `.ok`/`.json()`/`.text()` run. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchSpy: MockInstance<typeof fetch>;

function lastRequest(): { url: string; init: RequestInit } {
  const call = fetchSpy.mock.calls[0];
  if (!call) throw new Error("fetch was not called");
  return { url: call[0] as string, init: (call[1] ?? {}) as RequestInit };
}

function parseBody(init: RequestInit): { input: unknown; model: unknown } {
  return JSON.parse(init.body as string) as { input: unknown; model: unknown };
}

function authHeader(init: RequestInit): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.["Authorization"];
}

describe("openai-compatible embedding client", () => {
  beforeEach(() => {
    process.env["EMBEDDINGS_BASE_URL"] = BASE;
    process.env["EMBEDDINGS_MODEL"] = "test-embed-model";
    process.env["EMBEDDINGS_API_KEY"] = "test-key";
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env["EMBEDDINGS_BASE_URL"];
    delete process.env["EMBEDDINGS_MODEL"];
    delete process.env["EMBEDDINGS_API_KEY"];
  });

  it("embedQuery POSTs {input,model} to {base}/embeddings with a bearer token and returns the vector", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ data: [{ embedding: [0.1, 0.2, 0.3] }] }));

    const out = await embedQuery("hello world");

    expect(out).toEqual([0.1, 0.2, 0.3]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const { url, init } = lastRequest();
    expect(url).toBe("http://localhost:8080/v1/embeddings");
    expect(init.method).toBe("POST");
    expect(parseBody(init)).toEqual({ input: "hello world", model: "test-embed-model" });
    expect(authHeader(init)).toBe("Bearer test-key");
  });

  it("does not append a second /v1 when the base URL already carries it (and trims a trailing slash)", async () => {
    process.env["EMBEDDINGS_BASE_URL"] = "http://localhost:1234/v1/";
    fetchSpy.mockResolvedValue(jsonResponse({ data: [{ embedding: [1] }] }));

    await embedQuery("x");

    const { url } = lastRequest();
    expect(url).toBe("http://localhost:1234/v1/embeddings");
    expect(url).not.toContain("/v1/v1/");
  });

  it("omits the Authorization header when EMBEDDINGS_API_KEY is unset", async () => {
    delete process.env["EMBEDDINGS_API_KEY"];
    fetchSpy.mockResolvedValue(jsonResponse({ data: [{ embedding: [1] }] }));

    await embedQuery("x");

    expect(authHeader(lastRequest().init)).toBeUndefined();
  });

  it("batchEmbed sends an array input and returns one vector per input, in order", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        data: [
          { embedding: [1, 1] },
          { embedding: [2, 2] },
          { embedding: [3, 3] },
        ],
      }),
    );

    const out = await batchEmbed(["first", "second", "third"], "SEMANTIC_SIMILARITY");

    expect(out).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    const { init } = lastRequest();
    expect(parseBody(init).input).toEqual(["first", "second", "third"]);
    expect(parseBody(init).model).toBe("test-embed-model");
  });

  it("batchEmbed short-circuits an empty batch without hitting the network", async () => {
    const out = await batchEmbed([], "SEMANTIC_SIMILARITY");
    expect(out).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("embedMultimodal folds text + inline parts into a single text input", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ data: [{ embedding: [0.5] }] }));
    const parts: ContentPart[] = [
      { text: "caption" },
      { inlineData: { mimeType: "image/png", data: "AAAA" } },
    ];

    const out = await embedMultimodal(parts);

    expect(out).toEqual([0.5]);
    expect(parseBody(lastRequest().init).input).toBe("caption\n[inline:image/png:4b]");
  });

  it("embedQuery returns null on a non-OK response (graceful lexical fallback)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchSpy.mockResolvedValue(jsonResponse({ error: "boom" }, 500));

    expect(await embedQuery("x")).toBeNull();
  });

  it("embedQuery returns null when EMBEDDINGS_BASE_URL is unset (never touches fetch)", async () => {
    delete process.env["EMBEDDINGS_BASE_URL"];
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await embedQuery("x")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("batchEmbed throws on a non-OK response so the async pipeline can retry", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: "boom" }, 500));

    await expect(batchEmbed(["a"], "SEMANTIC_SIMILARITY")).rejects.toThrow(/500/);
  });
});

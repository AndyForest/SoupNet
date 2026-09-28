/**
 * The stdio MCP server as a client sees it (drafts-and-triage slice 1).
 *
 * Built with createStdioServer and driven over an in-memory transport, so the
 * served tools/list is measured byte for byte (S1-Z2) and what the proxy
 * forwards to the backend is observed with a stubbed fetch (S1-B1, S1-Z4,
 * S1-Z6). The backend-side behavior of the forwarded params is covered by the
 * backend's /check integration tests.
 *
 * Measured served tools/list (build log §Slice 1 baseline):
 *   before slice 1 (2026-09-27): 13,670 bytes
 *   after slice 1 (2026-09-27):  12,074 bytes, with impact and uncertainty added
 *   after slice 2 (2026-09-27):  13,064 bytes, with draft and verify_draft added (still under the cap)
 *   after slice 3 (2026-09-27):  13,063 bytes (the search query description names the new qualifiers)
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MCP_PARAM_DESCRIPTIONS } from "@soupnet/domain";
import { createStdioServer } from "./server.js";
import { servedToolsList } from "./served-tools-list.js";

/** S1-Z2: the stdio roster may not grow past its pre-slice-1 size. */
const STDIO_TOOLS_LIST_MAX_BYTES = 13_670;

const BACKEND = "http://backend.test";

function newServer() {
  return createStdioServer({ backendUrl: BACKEND, apiKey: "test-key" });
}

/** A backend stub that records every request and answers like /check and
 *  /feedback do. */
function stubBackend() {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchStub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith(`${BACKEND}/feedback`)) {
      return new Response(JSON.stringify({ ok: true, data: { recorded: 1, results: [{ index: 0, ok: true, traceId: "t" }] } }));
    }
    return new Response(JSON.stringify({
      ok: true,
      data: { checked: { recipeId: "11111111-1111-4111-8111-111111111111", impact: "low", uncertainty: null }, results: [], totalResults: 0 },
    }));
  });
  vi.stubGlobal("fetch", fetchStub);
  return calls;
}

async function callTool(name: string, args: Record<string, unknown>) {
  const server = newServer();
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "stdio-test", version: "0" });
  await server.connect(serverSide);
  await client.connect(clientSide);
  try {
    return await client.callTool({ name, arguments: args });
  } finally {
    await client.close();
    await server.close();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stdio MCP tools/list as served", () => {
  it(`S1-Z2: the served payload does not grow past ${STDIO_TOOLS_LIST_MAX_BYTES} bytes, ratings included`, async () => {
    const { bytes } = await servedToolsList(newServer());
    expect(bytes, `served tools/list is ${bytes} bytes`).toBeLessThanOrEqual(STDIO_TOOLS_LIST_MAX_BYTES);
  });

  it("S1-B1: check_recipe lists impact and uncertainty as plain strings", async () => {
    const { tools } = await servedToolsList(newServer());
    const props = tools.find((t) => t.name === "check_recipe")?.inputSchema.properties ?? {};
    for (const name of ["impact", "uncertainty"]) {
      expect(props[name]?.["type"], name).toBe("string");
      expect(String(props[name]?.["description"])).toContain("low | medium | high");
    }
  });

  it("S1-Z6 / DT-TOOL-02: clusters and max_chars stay declared with a one-line pointer to verbosity", async () => {
    const { tools } = await servedToolsList(newServer());
    const props = tools.find((t) => t.name === "check_recipe")?.inputSchema.properties ?? {};
    for (const name of ["clusters", "max_chars"]) {
      expect(props[name]?.["type"], name).toBe("number");
      expect(String(props[name]?.["description"])).toContain("verbosity");
      expect(String(props[name]?.["description"]).length).toBeLessThanOrEqual(60);
    }
  });

  it("S1-Z4 / DT-TOOL-03: check_recipe's feedback points to log_feedback instead of inlining the row schema", async () => {
    const { tools } = await servedToolsList(newServer());
    const feedback = tools.find((t) => t.name === "check_recipe")?.inputSchema.properties?.["feedback"] ?? {};
    const items = feedback["items"] as { properties?: unknown; additionalProperties?: unknown };
    expect(items.properties).toBeUndefined();
    expect(items.additionalProperties).not.toBe(false);
    expect(String(feedback["description"])).toContain("log_feedback");
  });
});

describe("DT-TOOL-04: the stdio server's shared descriptions are the remote server's constants", () => {
  it("check_recipe's shared params carry MCP_PARAM_DESCRIPTIONS verbatim", async () => {
    const { tools } = await servedToolsList(newServer());
    const props = tools.find((t) => t.name === "check_recipe")?.inputSchema.properties ?? {};
    const shared: Record<string, string> = {
      intent: MCP_PARAM_DESCRIPTIONS.intent,
      agent_id: MCP_PARAM_DESCRIPTIONS.agentId,
      known_recipes: MCP_PARAM_DESCRIPTIONS.knownRecipes,
      impact: MCP_PARAM_DESCRIPTIONS.impact,
      uncertainty: MCP_PARAM_DESCRIPTIONS.uncertainty,
      feedback: MCP_PARAM_DESCRIPTIONS.feedbackParam,
      clusters: MCP_PARAM_DESCRIPTIONS.clusters,
      max_chars: MCP_PARAM_DESCRIPTIONS.maxChars,
    };
    for (const [name, text] of Object.entries(shared)) {
      expect(props[name]?.["description"], name).toBe(text);
    }
  });
});

describe("stdio check_recipe proxy forwarding", () => {
  const recipe = "As a tester working on the stdio proxy, I prefer forwarded params so that the backend decides.";
  const evidence = "Interpretation.\n> \"quote\"\n-- source";

  it("S1-B1 / DT-RAT-05: forwards impact and uncertainty to /check", async () => {
    const calls = stubBackend();
    await callTool("check_recipe", { recipe, supporting_evidence: evidence, impact: "low", uncertainty: "high" });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/check");
    expect(url.searchParams.get("impact")).toBe("low");
    expect(url.searchParams.get("uncertainty")).toBe("high");
  });

  it("S1-B3 / DT-RAT-04: forwards an unrecognized rating untouched, so the backend can store not rated with a notice", async () => {
    const calls = stubBackend();
    const result = await callTool("check_recipe", { recipe, supporting_evidence: evidence, impact: "urgent" });
    expect(result.isError).not.toBe(true);
    expect(new URL(calls[0]!.url).searchParams.get("impact")).toBe("urgent");
  });

  it("S1-B3 follow-up: a wrong-type rating is forwarded as its JSON text, never an SDK error", async () => {
    const calls = stubBackend();
    const result = await callTool("check_recipe", { recipe, supporting_evidence: evidence, impact: 3, uncertainty: ["high"] });
    expect(result.isError).not.toBe(true);
    const params = new URL(calls[0]!.url).searchParams;
    expect(params.get("impact")).toBe("3");
    expect(params.get("uncertainty")).toBe('["high"]');
  });

  it("S1-B3 follow-up: a non-object feedback row is forwarded as-is for a per-row marker, and the check still runs", async () => {
    const calls = stubBackend();
    const result = await callTool("check_recipe", { recipe, supporting_evidence: evidence, feedback: [5, null] });
    expect(result.isError).not.toBe(true);
    const fb = calls.find((c) => c.url === `${BACKEND}/feedback`);
    const sent = JSON.parse(String(fb?.init?.body)) as { feedback: unknown[] };
    expect(sent.feedback).toEqual([5, null]);
  });

  it("S1-B2: sends no rating params when none were given", async () => {
    const calls = stubBackend();
    await callTool("check_recipe", { recipe, supporting_evidence: evidence });
    const params = new URL(calls[0]!.url).searchParams;
    expect(params.has("impact")).toBe(false);
    expect(params.has("uncertainty")).toBe(false);
  });

  it("S1-Z6 / DT-TOOL-02: still honors clusters and max_chars by forwarding them", async () => {
    const calls = stubBackend();
    await callTool("check_recipe", { recipe, supporting_evidence: evidence, clusters: 7, max_chars: 4000 });
    const params = new URL(calls[0]!.url).searchParams;
    expect(params.get("clusters")).toBe("7");
    expect(params.get("max_chars")).toBe("4000");
  });

  it("S1-Z4 / DT-TOOL-03, S1-B6 / DT-RAT-10: every log_feedback field on a ride-along row reaches /feedback, and the row's impact stays apart from the check's", async () => {
    const calls = stubBackend();
    const row = {
      trace_id: "22222222-2222-4222-8222-222222222222",
      kind: "check-feedback",
      impact: "new",
      disposition: "proceeded",
      story_fulfilled: "yes",
      story: "As a tester, I wanted every field forwarded.",
      note: "all fields",
      agent_id: "a-row",
      top_similarity: 0.5,
      model: "m",
      harness: "h",
      harness_version: "1",
      related_trace_ids: ["33333333-3333-4333-8333-333333333333"],
      session_id: "sess-row-1234",
      intent_id: "int_abcdefghijklmnopqrstuvwx",
    };
    await callTool("check_recipe", { recipe, supporting_evidence: evidence, impact: "high", feedback: [row] });
    const checkUrl = new URL(calls.find((c) => c.url.includes("/check"))!.url);
    expect(checkUrl.searchParams.get("impact")).toBe("high");
    expect(checkUrl.searchParams.get("feedback_impact")).toBeNull();
    const fb = calls.find((c) => c.url === `${BACKEND}/feedback`);
    const sent = JSON.parse(String(fb?.init?.body)) as { feedback: Array<Record<string, unknown>> };
    expect(sent.feedback[0]).toEqual(row);
  });
});

describe("stdio drafts (slice 2)", () => {
  const recipe = "As a backend maintainer working on drafts, I prefer drafts forwarded so that the proxy stays thin.";
  const evidence = "The test says so.\n> \"forward it\"\n-- server.test.ts";

  it("S2-B1 / DT-VIS-01: forwards draft to /check", async () => {
    const calls = stubBackend();
    await callTool("check_recipe", { recipe, supporting_evidence: evidence, draft: true });
    expect(new URL(calls[0]!.url).searchParams.get("draft")).toBe("true");
  });

  it("sends no draft param when none was given, and forwards a wrong-type value for the backend to judge", async () => {
    const calls = stubBackend();
    await callTool("check_recipe", { recipe, supporting_evidence: evidence });
    expect(new URL(calls[0]!.url).searchParams.has("draft")).toBe(false);
    const result = await callTool("check_recipe", { recipe, supporting_evidence: evidence, draft: "yes" });
    expect(result.isError).not.toBe(true);
    expect(new URL(calls[1]!.url).searchParams.get("draft")).toBe("yes");
  });

  it("S2-B10: verify_draft proxies to POST /recipes/:id/verify with the evidence", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ ok: true, data: { recipeId: "11111111-1111-4111-8111-111111111111", draftState: "verified", evidenceAdded: 1 } }));
    }));
    const result = await callTool("verify_draft", { recipe_id: "11111111", supporting_evidence: evidence });
    expect(calls[0]!.url).toBe(`${BACKEND}/recipes/11111111/verify`);
    expect(calls[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ supporting_evidence: evidence });
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("is verified");
  });

  it("verify_draft relays the backend's refusal verbatim", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "x: not_found_or_unreadable — nope" }), { status: 404 })));
    const result = await callTool("verify_draft", { recipe_id: "x", supporting_evidence: evidence });
    expect((result.content as Array<{ text: string }>)[0]!.text).toBe("x: not_found_or_unreadable — nope");
  });

  it("S3-AG1: search_recipes forwards the slice 3 qualifiers unchanged to the backend's filter path", async () => {
    const calls = stubBackend();
    const query = 'is:draft impact:high -uncertainty:low "cache"';
    const result = await callTool("search_recipes", { query });
    expect(result.isError).not.toBe(true);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/check");
    expect(url.searchParams.get("filter")).toBe(query);
  });

  it("S3-F1: verify_draft relays the honest write-access refusal (403) verbatim, so the agent learns the way forward", async () => {
    const refusal = "abc is a draft in the recipe book \"Shared\" (shared), and verifying it needs write access to this recipe book, which this API key does not have; nothing was stored.";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error: refusal, status: "needs_write_access" }), { status: 403 })));
    const result = await callTool("verify_draft", { recipe_id: "abc", supporting_evidence: evidence });
    expect((result.content as Array<{ text: string }>)[0]!.text).toBe(refusal);
  });
});

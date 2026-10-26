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
 *   zod 3 to 4 (2026-10-26): 14,738 to 14,625 bytes (the same three schema changes as the remote server)
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MCP_PARAM_DESCRIPTIONS, describeResolution, guardUnknownParams, toolParamsFromRegistry } from "@soupnet/domain";
import type { McpTransportLike } from "@soupnet/domain";
import { createStdioServer } from "./server.js";
import { servedToolsList } from "./served-tools-list.js";

/** S1-Z2: the stdio roster may not grow past its pre-slice-1 size. */
/** 13,670 → 14,700 (2026-10-24, drafts-and-triage slices 6 to 9, scaffold PR A0): moves with
 *  the remote roster cap (17,000 → 18,200); reason and re-tightening note in
 *  apps/backend/src/routes/mcp-tools-list-size.test.ts. */
// 14,700 → 14,750 (2026-10-26, OpenAI plugin directory stream T): every
// description in the reviewed shape and explicit annotations, as on the remote
// server. Measured 14,407 on main (with slice 8b's page parameter) → 14,738.
const STDIO_TOOLS_LIST_MAX_BYTES = 14_750;

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

  it("S6c-B4: verify_draft forwards outcome and words the reply with the shared domain function", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ ok: true, data: { recipeId: id, draftState: "rejected", evidenceAdded: 2 } }));
    }));
    const result = await callTool("verify_draft", { recipe_id: "11111111", supporting_evidence: evidence, outcome: "rejected" });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ supporting_evidence: evidence, outcome: "rejected" });
    expect((result.content as Array<{ text: string }>)[0]!.text).toBe(describeResolution(id, "rejected", 2));
  });

  it("S6c-B6: an unknown outcome reaches the backend (no schema enum), whose refusal is relayed verbatim", async () => {
    const refusal = 'outcome "reject" is not one of verified | rejected | not_chosen (verified when omitted); nothing was stored.';
    const calls: Array<{ init: RequestInit | undefined }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      calls.push({ init });
      return new Response(JSON.stringify({ ok: false, error: refusal, status: "refused" }), { status: 400 });
    }));
    const result = await callTool("verify_draft", { recipe_id: "x", supporting_evidence: evidence, outcome: "reject" });
    expect(JSON.parse(String(calls[0]!.init?.body)).outcome).toBe("reject");
    expect((result.content as Array<{ text: string }>)[0]!.text).toBe(refusal);
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

  it("S8b-P1: search_recipes forwards page to /check, sends none when absent, and refuses a page that is not an integer from 1", async () => {
    const calls = stubBackend();
    await callTool("search_recipes", { query: "author:me changed-after:2026-10-01", page: 2 });
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("filter")).toBe("author:me changed-after:2026-10-01");
    await callTool("search_recipes", { query: "author:me" });
    expect(new URL(calls[1]!.url).searchParams.has("page")).toBe(false);
    for (const page of [0, -1, 1.5, "2"]) {
      const before = calls.length;
      const refused = await callTool("search_recipes", { query: "author:me", page }).catch((err: unknown) => ({ isError: true, content: [{ text: String(err) }] }));
      expect(refused.isError, String(page)).toBe(true);
      expect(JSON.stringify(refused.content), String(page)).toMatch(/page/);
      expect(calls.length, String(page)).toBe(before);
    }
  });

  it("S3-F1: verify_draft relays the honest write-access refusal (403) verbatim, so the agent learns the way forward", async () => {
    const refusal = "abc is a draft in the recipe book \"Shared\" (shared), and resolving it needs write access to this recipe book, which this API key does not have; nothing was stored.";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error: refusal, status: "needs_write_access" }), { status: 403 })));
    const result = await callTool("verify_draft", { recipe_id: "abc", supporting_evidence: evidence });
    expect((result.content as Array<{ text: string }>)[0]!.text).toBe(refusal);
  });
});

describe("stdio on behalf of (slice 4)", () => {
  const recipe = "As a backend maintainer working on drafts, I prefer on-behalf drafts forwarded so that the proxy stays thin.";
  const evidence = "Interpretation.\n> \"quote\"\n-- server.test.ts";

  it("S4-W1: forwards on_behalf_of to /check as given, and sends none when absent", async () => {
    const calls = stubBackend();
    await callTool("check_recipe", { recipe, supporting_evidence: evidence, on_behalf_of: " Pat@Example.test " });
    expect(new URL(calls[0]!.url).searchParams.get("on_behalf_of")).toBe(" Pat@Example.test ");
    await callTool("check_recipe", { recipe, supporting_evidence: evidence });
    expect(new URL(calls[1]!.url).searchParams.has("on_behalf_of")).toBe(false);
  });
});

// Drafts-and-triage slice 8a: the stdio twins of the tool-shape fixes.
describe("slice 8a tool shapes (stdio)", () => {
  const ID_A = "11111111-1111-4111-8111-111111111111";
  const ID_B = "22222222-2222-4222-8222-222222222222";

  function recordFetch(body: unknown) {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      urls.push(String(input));
      return new Response(JSON.stringify(body));
    }));
    return urls;
  }

  it("S8a-I1: get_recipes forwards an array as the same ids string the string form sends", async () => {
    const urls = recordFetch({ ok: true, data: { recipes: [] } });
    await callTool("get_recipes", { recipe_ids: [ID_A, ID_B] });
    await callTool("get_recipes", { recipe_ids: `${ID_A},${ID_B}` });
    expect(new URL(urls[0]!).searchParams.get("ids")).toBe(`${ID_A},${ID_B}`);
    expect(urls[0]).toBe(urls[1]);
  });

  it("S8a-I3: get_briefing forwards an array of recipe_ids", async () => {
    const urls = recordFetch({ ok: true, data: { text: "briefing" } });
    await callTool("get_briefing", { recipe_ids: [ID_A, ID_B] });
    expect(new URL(urls[0]!).searchParams.get("recipe_ids")).toBe(`${ID_A},${ID_B}`);
  });

  it("S8a-O4: get_briefing ends with the briefing id the backend returned, and adds nothing without one", async () => {
    recordFetch({ ok: true, data: { text: "briefing body", briefingId: ID_A } });
    const withId = await callTool("get_briefing", {});
    expect((withId.content as Array<{ text: string }>)[0]!.text).toBe(
      `briefing body\n\nBriefing id: ${ID_A} — log_feedback accepts it as briefing_id, for feedback about this briefing.`,
    );
    recordFetch({ ok: true, data: { text: "briefing body" } });
    const without = await callTool("get_briefing", {});
    expect((without.content as Array<{ text: string }>)[0]!.text).toBe("briefing body");
  });

  it("S8a-V3: log_feedback takes any one of trace_id, search_id, briefing_id (none required) and says story is required", async () => {
    const { tools } = await servedToolsList(newServer());
    const logFeedback = tools.find((t) => t.name === "log_feedback")!;
    const props = logFeedback.inputSchema.properties ?? {};
    for (const name of ["trace_id", "search_id", "briefing_id", "intent_id"]) expect(props[name]).toBeDefined();
    const required = (logFeedback.inputSchema as { required?: string[] }).required ?? [];
    expect(required).not.toContain("trace_id");
    expect(required).toContain("story");
    expect(String(props["story"]?.["description"])).toMatch(/^Required on every row\./);
  });

  it("S8a-O1: log_feedback names an intent-only row's target in its confirmation", async () => {
    recordFetch({ ok: true, data: { recorded: 1, results: [{ index: 0, ok: true, traceId: "", intentId: "int_AbCdEfGhIjKlMnOpQrStUvWx", feedbackId: "f1" }] } });
    const r = await callTool("log_feedback", {
      kind: "outcome", impact: "none", disposition: "proceeded", story_fulfilled: "yes",
      story: "As a tester, I wanted the run's outcome on its intent.", intent_id: "int_AbCdEfGhIjKlMnOpQrStUvWx",
    });
    expect((r.content as Array<{ text: string }>)[0]!.text).toBe("Feedback recorded for intent int_AbCdEfGhIjKlMnOpQrStUvWx (feedback id f1).");
  });

  it("S8a-U1/U2: the guard the stdio entry installs refuses an undeclared name on this server's tools", async () => {
    const urls = recordFetch({ ok: true, data: { recipes: [] } });
    const server = newServer();
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "stdio-guard-test", version: "0" });
    await server.connect(serverSide);
    guardUnknownParams(serverSide as unknown as McpTransportLike, toolParamsFromRegistry(server), "refuse");
    await client.connect(clientSide);
    try {
      const r = await client.callTool({ name: "get_recipes", arguments: { recipe_id: ID_A } });
      expect(r.isError).toBe(true);
      expect((r.content as Array<{ text: string }>)[0]!.text).toBe(
        "Error: get_recipes does not take recipe_id (did you mean recipe_ids?). Nothing was run; send it again with the names it takes: recipe_ids.",
      );
      expect(urls).toEqual([]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

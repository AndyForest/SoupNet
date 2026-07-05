import { describe, it, expect, beforeAll } from "vitest";

/**
 * Integration tests for the feedback ingestion surfaces (WT-4 phase 2).
 *
 * Security-adjacent invariant (the reason these are Layer 3, not just unit):
 * key A must NOT be able to attach feedback to a trace key A cannot read —
 * and the rejection marker must be identical for "doesn't exist" and "not
 * readable" (no existence oracle).
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const ACCEPT_BOTH = "application/json, text/event-stream";

interface TestIdentity {
  apiKey: string;
  jwt: string;
  email: string;
}

async function registerIdentity(tag: string): Promise<TestIdentity> {
  const uid = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `fb-${tag}-${uid}@test.local`;
  const password = "fb-test-password-123";
  const reg = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, tosAccepted: true }),
  });
  const regBody = (await reg.json()) as { data?: { verificationToken?: string } };
  const vtok = regBody.data?.verificationToken;
  if (!vtok) throw new Error("register failed");
  await fetch(`${BASE}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: vtok }),
  });
  const login = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = (await login.json()) as { data?: { token?: string } };
  const jwt = loginBody.data?.token ?? "";
  if (!jwt) throw new Error("login failed");
  const keyRes = await fetch(`${BASE}/keys/daily`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
  });
  const keyBody = (await keyRes.json()) as { data?: { key?: string } };
  const apiKey = keyBody.data?.key ?? "";
  if (!apiKey) throw new Error("key mint failed");
  return { apiKey, jwt, email };
}

async function checkRecipe(apiKey: string, recipeText: string): Promise<string> {
  const params = new URLSearchParams();
  params.set("key", apiKey);
  params.set("trace", recipeText);
  params.set("ef", `Interpretation for the test.\n> "quote"\n-- test suite`);
  params.set("format", "json");
  const res = await fetch(`${BASE}/check?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  const json = (await res.json()) as { ok: boolean; data?: { recipeId?: string } };
  const id = json.data?.recipeId;
  if (!id) throw new Error(`check failed: ${JSON.stringify(json)}`);
  return id;
}

function feedbackRow(traceId: string, overrides: Record<string, unknown> = {}) {
  return {
    trace_id: traceId,
    kind: "check-feedback",
    impact: "subtle",
    disposition: "proceeded",
    story_fulfilled: "yes",
    story: "As a developer working on tests, I wanted coverage so that regressions surface.",
    note: "integration test row",
    ...overrides,
  };
}

describe.skipIf(!BASE)("feedback ingestion surfaces", () => {
  let userA: TestIdentity;
  let userB: TestIdentity;
  let traceA: string;
  let traceB: string;

  beforeAll(async () => {
    [userA, userB] = await Promise.all([registerIdentity("a"), registerIdentity("b")]);
    [traceA, traceB] = await Promise.all([
      checkRecipe(userA.apiKey, `As a developer working on feedback tests, I chose per-row markers so that batches degrade gracefully. (owner A ${Date.now()})`),
      checkRecipe(userB.apiKey, `As a developer working on feedback tests, I chose strict enums so that analytics stay queryable. (owner B ${Date.now()})`),
    ]);
  }, 60_000);

  it("REST POST /feedback records a row on a readable trace", async () => {
    const res = await fetch(`${BASE}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userA.apiKey}` },
      body: JSON.stringify({ feedback: [feedbackRow(traceA, { agent_id: "a-int-test", top_similarity: 0.42 })] }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; data: { recorded: number; results: Array<{ ok: boolean; feedbackId?: string }> } };
    expect(json.ok).toBe(true);
    expect(json.data.recorded).toBe(1);
    expect(json.data.results[0]?.ok).toBe(true);
    expect(json.data.results[0]?.feedbackId).toBeTruthy();
  });

  it("REST POST /feedback accepts a bare single-row body", async () => {
    const res = await fetch(`${BASE}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userA.apiKey}` },
      body: JSON.stringify(feedbackRow(traceA, { kind: "outcome", impact: "big", disposition: "corrected", story_fulfilled: "partial" })),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; data: { recorded: number } };
    expect(json.data.recorded).toBe(1);
  });

  it("SECURITY: key A cannot attach feedback to key B's unreadable trace — and the marker matches the nonexistent-trace marker", async () => {
    const ghost = "00000000-0000-0000-0000-000000000001";
    const res = await fetch(`${BASE}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userA.apiKey}` },
      body: JSON.stringify({ feedback: [feedbackRow(traceB), feedbackRow(ghost)] }),
    });
    const json = (await res.json()) as { ok: boolean; data?: { recorded: number; results: Array<{ ok: boolean; error?: string }> } };
    expect(res.status).toBe(400); // nothing recorded
    expect(json.data?.recorded).toBe(0);
    const [unreadable, nonexistent] = json.data!.results;
    expect(unreadable!.ok).toBe(false);
    expect(nonexistent!.ok).toBe(false);
    // Anti-enumeration: identical marker text for both.
    expect(unreadable!.error).toBe(nonexistent!.error);
    expect(unreadable!.error).toContain("not found or not readable");
  });

  it("a bad row gets a marker while good rows in the same batch still land", async () => {
    const res = await fetch(`${BASE}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userB.apiKey}` },
      body: JSON.stringify({ feedback: [
        feedbackRow(traceB),
        feedbackRow(traceB, { impact: "colossal" }),
      ] }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; data: { recorded: number; results: Array<{ ok: boolean; error?: string }> } };
    expect(json.data.recorded).toBe(1);
    expect(json.data.results[0]?.ok).toBe(true);
    expect(json.data.results[1]?.ok).toBe(false);
    // Helpful message lists the vocabulary.
    expect(json.data.results[1]?.error).toContain("none | new | subtle | big | operational");
  });

  it("rejects requests without a Bearer key", async () => {
    const res = await fetch(`${BASE}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: [feedbackRow(traceA)] }),
    });
    expect(res.status).toBe(401);
  });

  it("MCP log_feedback tool records a row (HTTP MCP surface)", async () => {
    const callRes = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: ACCEPT_BOTH,
        Authorization: `Bearer ${userA.apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "log_feedback",
          arguments: feedbackRow(traceA, { agent_id: "a-mcp-int-test" }),
        },
        id: 1,
      }),
    });
    expect(callRes.status).toBe(200);
    const text = await callRes.text();
    expect(text).toContain("Feedback recorded for check");
    expect(text).toContain(traceA);
  });

  it("MCP check_recipe ride-along feedback lands and bad rows get markers in the response", async () => {
    const callRes = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: ACCEPT_BOTH,
        Authorization: `Bearer ${userA.apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "check_recipe",
          arguments: {
            recipe: `As a developer working on the feedback loop, I chose ride-along rows so that mid-flow agents skip separate calls. (${Date.now()})`,
            supporting_evidence: `Test evidence.\n> "quote"\n-- test suite`,
            agent_id: "a-ridealong-test",
            feedback: [
              feedbackRow(traceA),
              feedbackRow(traceB), // unreadable by key A → marker
            ],
          },
        },
        id: 2,
      }),
    });
    expect(callRes.status).toBe(200);
    const text = await callRes.text();
    expect(text).toContain("Feedback: 1/2 row(s) recorded.");
    expect(text).toContain("not found or not readable");
  }, 30_000);
});

import { describe, it, expect, beforeAll } from "vitest";

/**
 * Integration tests for the human-observability layer (WT-4 phase 3):
 * GET /traces/:id/feedback (lineage), PUT/DELETE /traces/:id/reaction
 * (still_true|stale|wrong, one per user, upsert), and
 * PUT/DELETE /traces/feedback/:feedbackId/star ("mattered").
 *
 * All JWT-auth with the existing traces read predicate — a non-member gets
 * the same 404 as a nonexistent trace.
 */

const BASE = process.env["BACKEND_URL"] ?? "";

interface TestIdentity {
  apiKey: string;
  jwt: string;
}

async function registerIdentity(tag: string): Promise<TestIdentity> {
  const uid = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `tfb-${tag}-${uid}@test.local`;
  const password = "tfb-test-password-123";
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
  const keyRes = await fetch(`${BASE}/keys/daily`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
  });
  const keyBody = (await keyRes.json()) as { data?: { key?: string } };
  return { apiKey: keyBody.data?.key ?? "", jwt };
}

describe.skipIf(!BASE)("trace feedback lineage + human reactions", () => {
  let owner: TestIdentity;
  let stranger: TestIdentity;
  let traceId: string;
  let feedbackId: string;

  beforeAll(async () => {
    [owner, stranger] = await Promise.all([registerIdentity("owner"), registerIdentity("stranger")]);

    // Owner checks a recipe, then logs feedback about it.
    const params = new URLSearchParams({
      key: owner.apiKey,
      trace: `As a developer working on observability, I chose feedback lineage on the trace page so that humans see which recipes earned their keep. (${Date.now()})`,
      ef: `Interpretation.\n> "quote"\n-- test suite`,
      format: "json",
    });
    const checkRes = await fetch(`${BASE}/check?${params.toString()}`, { headers: { Accept: "application/json" } });
    const checkJson = (await checkRes.json()) as { data?: { recipeId?: string } };
    traceId = checkJson.data?.recipeId ?? "";
    if (!traceId) throw new Error("check failed");

    const fbRes = await fetch(`${BASE}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.apiKey}` },
      body: JSON.stringify({
        trace_id: traceId,
        kind: "check-feedback",
        impact: "big",
        disposition: "corrected",
        story_fulfilled: "yes",
        story: "As a developer working on tests, I wanted lineage visible so that the page shows it.",
        note: "phase-3 test row",
        agent_id: "a-phase3-test",
        top_similarity: 0.66,
        model: "claude-fable-5",
        harness: "claude-code",
      }),
    });
    const fbJson = (await fbRes.json()) as { data?: { results?: Array<{ feedbackId?: string }> } };
    feedbackId = fbJson.data?.results?.[0]?.feedbackId ?? "";
    if (!feedbackId) throw new Error("feedback seed failed");
  }, 60_000);

  it("GET /traces/:id/feedback returns the lineage for a reader", async () => {
    const res = await fetch(`${BASE}/traces/${traceId}/feedback`, {
      headers: { Authorization: `Bearer ${owner.jwt}` },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { feedback: Array<Record<string, unknown>>; reactions: { mine: string | null; counts: Record<string, number> } };
    };
    expect(json.ok).toBe(true);
    expect(json.data.feedback.length).toBe(1);
    const row = json.data.feedback[0]!;
    expect(row["impact"]).toBe("big");
    expect(row["disposition"]).toBe("corrected");
    expect(row["agentId"]).toBe("a-phase3-test");
    expect(row["starCount"]).toBe(0);
    expect(row["starredByMe"]).toBe(false);
    expect(json.data.reactions.mine).toBeNull();
  });

  it("returns 404 for a non-member (same as nonexistent)", async () => {
    const res = await fetch(`${BASE}/traces/${traceId}/feedback`, {
      headers: { Authorization: `Bearer ${stranger.jwt}` },
    });
    expect(res.status).toBe(404);
    const ghost = await fetch(`${BASE}/traces/00000000-0000-0000-0000-000000000002/feedback`, {
      headers: { Authorization: `Bearer ${stranger.jwt}` },
    });
    expect(ghost.status).toBe(404);
  });

  it("reaction: PUT upserts (one per user, latest wins), DELETE clears", async () => {
    const put1 = await fetch(`${BASE}/traces/${traceId}/reaction`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.jwt}` },
      body: JSON.stringify({ reaction: "stale" }),
    });
    expect(put1.status).toBe(200);

    const put2 = await fetch(`${BASE}/traces/${traceId}/reaction`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.jwt}` },
      body: JSON.stringify({ reaction: "still_true" }),
    });
    expect(put2.status).toBe(200);

    const get = await fetch(`${BASE}/traces/${traceId}/feedback`, {
      headers: { Authorization: `Bearer ${owner.jwt}` },
    });
    const json = (await get.json()) as { data: { reactions: { mine: string | null; counts: Record<string, number> } } };
    expect(json.data.reactions.mine).toBe("still_true");
    // Upsert, not append: the stale reaction was replaced.
    expect(json.data.reactions.counts["still_true"]).toBe(1);
    expect(json.data.reactions.counts["stale"]).toBeUndefined();

    const del = await fetch(`${BASE}/traces/${traceId}/reaction`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${owner.jwt}` },
    });
    expect(del.status).toBe(200);
    const get2 = await fetch(`${BASE}/traces/${traceId}/feedback`, {
      headers: { Authorization: `Bearer ${owner.jwt}` },
    });
    const json2 = (await get2.json()) as { data: { reactions: { mine: string | null } } };
    expect(json2.data.reactions.mine).toBeNull();
  });

  it("reaction: rejects bad values with the vocabulary", async () => {
    const res = await fetch(`${BASE}/traces/${traceId}/reaction`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.jwt}` },
      body: JSON.stringify({ reaction: "meh" }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toContain("still_true | stale | wrong");
  });

  it("reaction: non-member gets 404", async () => {
    const res = await fetch(`${BASE}/traces/${traceId}/reaction`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${stranger.jwt}` },
      body: JSON.stringify({ reaction: "stale" }),
    });
    expect(res.status).toBe(404);
  });

  it("star: PUT stars, DELETE unstars; both idempotent", async () => {
    const put = await fetch(`${BASE}/traces/feedback/${feedbackId}/star`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${owner.jwt}` },
    });
    expect(put.status).toBe(200);
    const putAgain = await fetch(`${BASE}/traces/feedback/${feedbackId}/star`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${owner.jwt}` },
    });
    expect(putAgain.status).toBe(200);

    const get = await fetch(`${BASE}/traces/${traceId}/feedback`, {
      headers: { Authorization: `Bearer ${owner.jwt}` },
    });
    const json = (await get.json()) as { data: { feedback: Array<{ starCount: number; starredByMe: boolean }> } };
    expect(json.data.feedback[0]?.starCount).toBe(1);
    expect(json.data.feedback[0]?.starredByMe).toBe(true);

    const del = await fetch(`${BASE}/traces/feedback/${feedbackId}/star`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${owner.jwt}` },
    });
    expect(del.status).toBe(200);
    const get2 = await fetch(`${BASE}/traces/${traceId}/feedback`, {
      headers: { Authorization: `Bearer ${owner.jwt}` },
    });
    const json2 = (await get2.json()) as { data: { feedback: Array<{ starCount: number; starredByMe: boolean }> } };
    expect(json2.data.feedback[0]?.starCount).toBe(0);
    expect(json2.data.feedback[0]?.starredByMe).toBe(false);
  });

  it("star: non-member cannot star (uniform 404)", async () => {
    const res = await fetch(`${BASE}/traces/feedback/${feedbackId}/star`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${stranger.jwt}` },
    });
    expect(res.status).toBe(404);
  });
});

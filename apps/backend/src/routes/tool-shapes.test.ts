import { describe, it, expect, beforeAll } from "vitest";
import { sql } from "drizzle-orm";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { guardUnknownParams, toolParamsFromRegistry } from "@soupnet/domain";
import type { McpTransportLike, UnknownParamMode } from "@soupnet/domain";
import { seedVerifiedUser } from "../test-users";
import { getDb } from "../db";
import { authenticateKey } from "../authz";
import { createMcpServer } from "./mcp";

/**
 * Layer 3 for drafts-and-triage slice 8a, "tool shapes" (rubric S8a-* in
 * docs/planning/drafts-and-triage-build.md): get_recipes takes an id array,
 * feedback validation names every failing field, an outcome row joins on an
 * intent alone, get_briefing returns an id a feedback row can carry, a
 * zero-result search leads with the author:me form of the same query, and
 * unknown parameter names are refused or warned.
 *
 * Requires a running backend (BACKEND_URL) and its database (the PG* env),
 * the same pattern as drafts.test.ts.
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const ACCEPT_BOTH = "application/json, text/event-stream";
const UNKNOWN_UUID = "00000000-0000-4000-8000-00000000dead";
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

interface Identity { apiKey: string; jwt: string }

async function identity(tag: string): Promise<Identity> {
  const email = `shapes-${tag}-${RUN}@test.local`;
  const login = await seedVerifiedUser(email, "shapes-test-password-123");
  const jwt = ((await login.json()) as { data?: { token?: string } }).data?.token ?? "";
  if (!jwt) throw new Error(`login failed (${tag})`);
  const keyRes = await fetch(`${BASE}/keys/daily`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
  });
  const apiKey = ((await keyRes.json()) as { data?: { key?: string } }).data?.key ?? "";
  if (!apiKey) throw new Error(`key mint failed (${tag})`);
  return { apiKey, jwt };
}

async function mcp(key: string, name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean; structured?: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: ACCEPT_BOTH, Authorization: `Bearer ${key}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const raw = await res.text();
  const line = raw.split(/\r?\n/).find((l) => l.startsWith("data: "));
  const msg = JSON.parse(line ? line.slice(6) : raw) as {
    result?: { content?: Array<{ text?: string }>; isError?: boolean; structuredContent?: Record<string, unknown> };
  };
  return {
    text: msg.result?.content?.map((c) => c.text ?? "").join("\n") ?? "",
    isError: msg.result?.isError === true,
    ...(msg.result?.structuredContent ? { structured: msg.result.structuredContent } : {}),
  };
}

async function deposit(key: string, recipe: string): Promise<string> {
  const qs = new URLSearchParams({
    key,
    trace: recipe,
    ef: `Interpretation for the test.\n> "a quote"\n-- tool-shapes suite`,
    format: "json",
  });
  const res = await fetch(`${BASE}/check?${qs.toString()}`, { headers: { Accept: "application/json" } });
  const id = ((await res.json()) as { data?: { checked?: { recipeId?: string } } }).data?.checked?.recipeId;
  if (!id) throw new Error("deposit failed");
  return id;
}

function row(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: "outcome",
    impact: "subtle",
    disposition: "proceeded",
    story_fulfilled: "yes",
    story: "As a developer testing tool shapes, I wanted the session's outcome recorded so that the run can be scored.",
    ...overrides,
  };
}

async function postFeedback(key: string, body: Record<string, unknown>): Promise<{ ok: boolean; results: Array<{ ok: boolean; error?: string; feedbackId?: string; dup?: boolean; intentId?: string; briefingId?: string }> }> {
  const res = await fetch(`${BASE}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; data?: { results: Array<{ ok: boolean; error?: string; feedbackId?: string; dup?: boolean }> } };
  return { ok: json.ok, results: json.data?.results ?? [] };
}

function intentFrom(text: string): string {
  const m = /int_[A-Za-z0-9]{24}/.exec(text);
  if (!m) throw new Error(`no intent id in: ${text.slice(0, 200)}`);
  return m[0];
}

function briefingIdFrom(text: string): string {
  const m = /Briefing id: ([0-9a-f-]{36})/.exec(text);
  if (!m) throw new Error("no briefing id line");
  return m[1]!;
}

describe.skipIf(!BASE)("slice 8a tool shapes", () => {
  let a: Identity;
  let b: Identity;
  let traceA: string;
  let traceA2: string;
  let traceB: string;

  beforeAll(async () => {
    [a, b] = await Promise.all([identity("a"), identity("b")]);
    [traceA, traceA2, traceB] = await Promise.all([
      deposit(a.apiKey, `As a developer testing id arrays, I chose to accept both forms so that agents land on the first call. (${RUN} one)`),
      deposit(a.apiKey, `As a developer testing id arrays, I chose uniform markers so that ids leak nothing. (${RUN} two)`),
      deposit(b.apiKey, `As a developer testing id arrays, I chose another person's recipe as the unreadable case. (${RUN} b)`),
    ]);
  }, 60_000);

  // ── Item 4: get_recipes takes an array ───────────────────────────────────

  it("S8a-I1: get_recipes answers an array and the string form identically", async () => {
    const asString = await mcp(a.apiKey, "get_recipes", { recipe_ids: `${traceA}, ${traceA2}` });
    const asArray = await mcp(a.apiKey, "get_recipes", { recipe_ids: [traceA, traceA2] });
    expect(asString.isError).toBe(false);
    expect(asArray.text).toBe(asString.text);
    expect(asArray.text).toContain("2 of 2 resolved");
  });

  it("S8a-I2: a string that is itself a JSON array resolves the ids inside it", async () => {
    const r = await mcp(a.apiKey, "get_recipes", { recipe_ids: JSON.stringify([traceA, traceA2]) });
    expect(r.text).toContain("2 of 2 resolved");
  });

  it("S8a-I3: GET /recipes takes a repeated ids parameter and a JSON-array string", async () => {
    for (const qs of [`ids=${traceA}&ids=${traceA2}`, `ids=${encodeURIComponent(JSON.stringify([traceA, traceA2]))}`]) {
      const res = await fetch(`${BASE}/recipes?${qs}`, { headers: { Authorization: `Bearer ${a.apiKey}` } });
      const body = (await res.json()) as { data?: { recipes: Array<{ status: string }> } };
      expect(res.status).toBe(200);
      expect(body.data?.recipes.map((r) => r.status)).toEqual(["ok", "ok"]);
    }
  });

  it("S8a-I3: get_briefing's recipe_ids takes an array", async () => {
    const r = await mcp(a.apiKey, "get_briefing", { recipe_ids: [traceA] });
    expect(r.text).toContain("Requested recipes");
    expect(r.text).toContain(traceA);
  });

  it("S8a-I4: in array form, another person's recipe reads exactly like a random id", async () => {
    const theirs = await mcp(a.apiKey, "get_recipes", { recipe_ids: [traceB] });
    const random = await mcp(a.apiKey, "get_recipes", { recipe_ids: [UNKNOWN_UUID] });
    expect(theirs.text.replaceAll(traceB, "<id>")).toBe(random.text.replaceAll(UNKNOWN_UUID, "<id>"));
    expect(theirs.text).toContain("not_found_or_unreadable");
  });

  it("S8a-I4: the 20-id cap applies after parsing the array", async () => {
    const ids = Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const r = await mcp(a.apiKey, "get_recipes", { recipe_ids: ids });
    expect(r.text).toContain("too many ids (21; max 20");
  });

  // ── Item 5: every failing field at once ──────────────────────────────────

  it("S8a-V2: log_feedback and POST /feedback name every failing field in one answer", async () => {
    const bad = { trace_id: traceA, kind: "bogus", impact: "high", disposition: "proceed", story_fulfilled: "yes", story: "" };
    const viaMcp = await mcp(a.apiKey, "log_feedback", bad);
    expect(viaMcp.text).toContain("Feedback rejected: 4 fields need fixing: kind must be one of");
    for (const f of ["impact must", "disposition must", "story is required"]) expect(viaMcp.text).toContain(f);
    const viaRest = await postFeedback(a.apiKey, bad);
    expect(viaRest.results[0]?.error).toBe(viaMcp.text.replace("Feedback rejected: ", ""));
  });

  // ── Item 6: outcome rows on an intent alone; a briefing id ───────────────

  it("S8a-O1, S8a-O3: an outcome row lands on intent_id alone, and an identical resubmission returns the original", async () => {
    const briefing = await mcp(a.apiKey, "get_briefing", { intent: `As a developer testing outcome rows, I want a session id to report against. (${RUN})` });
    const intentId = intentFrom(briefing.text);

    const first = await mcp(a.apiKey, "log_feedback", row({ intent_id: intentId }));
    expect(first.text).toMatch(new RegExp(`^Feedback recorded for intent ${intentId} \\(feedback id [0-9a-f-]{36}\\)\\.$`));
    const again = await mcp(a.apiKey, "log_feedback", row({ intent_id: intentId }));
    expect(again.text).toContain("already recorded");

    const feedbackId = /feedback id ([0-9a-f-]{36})/.exec(first.text)![1]!;
    const stored = (await getDb().execute(sql`
      SELECT trace_id, search_audit_id, briefing_audit_id, intent_id, kind
      FROM claimnet.check_feedback WHERE id = ${feedbackId}::uuid
    `)) as unknown as Array<Record<string, unknown>>;
    expect(stored[0]).toEqual({ trace_id: null, search_audit_id: null, briefing_audit_id: null, intent_id: intentId, kind: "outcome" });

    const rest = await postFeedback(a.apiKey, row({ intent_id: intentId, note: `rest ${RUN}` }));
    expect(rest.results[0]?.ok).toBe(true);
    expect(rest.results[0]?.intentId).toBe(intentId);
  }, 30_000);

  it("S8a-O1, S8a-O5: GET /feedback (the URL-building form) takes an intent-only outcome row and a briefing id", async () => {
    const briefing = await mcp(a.apiKey, "get_briefing", { intent: `As a developer testing the GET form, I want an intent to close. (${RUN})` });
    const intentId = intentFrom(briefing.text);
    const briefingId = briefingIdFrom(briefing.text);
    for (const target of [{ intent_id: intentId }, { kind: "operational", briefing_id: briefingId }]) {
      const qs = new URLSearchParams({ key: a.apiKey, format: "json", ...(row(target) as Record<string, string>) });
      const res = await fetch(`${BASE}/feedback?${qs.toString()}`, { headers: { Accept: "application/json" } });
      const body = (await res.json()) as { ok: boolean; data?: { results: Array<{ ok: boolean; error?: string }> } };
      expect(res.status, JSON.stringify(body)).toBe(200);
      expect(body.data?.results[0]?.ok).toBe(true);
    }
  }, 30_000);

  it("S8a-O1: intent_id alone on any other kind is refused, naming the rule", async () => {
    const briefing = await mcp(a.apiKey, "get_briefing", { intent: `As a developer testing kinds, I want a second intent. (${RUN})` });
    const r = await mcp(a.apiKey, "log_feedback", row({ kind: "check-feedback", intent_id: intentFrom(briefing.text) }));
    expect(r.text).toContain("an outcome row may instead give intent_id alone");
  });

  it("S8a-O2: another user's intent and an unknown one get the same marker, and no row", async () => {
    const briefing = await mcp(a.apiKey, "get_briefing", { intent: `As a developer testing intent privacy, I want an intent B cannot use. (${RUN})` });
    const aIntent = intentFrom(briefing.text);
    const theirs = await mcp(b.apiKey, "log_feedback", row({ intent_id: aIntent }));
    const unknown = await mcp(b.apiKey, "log_feedback", row({ intent_id: "int_000000000000000000000000" }));
    expect(theirs.text).toBe("Feedback rejected: intent_id not found or not readable with this key");
    expect(unknown.text).toBe(theirs.text);
    const rows = (await getDb().execute(sql`
      SELECT count(*)::int AS n FROM claimnet.check_feedback WHERE intent_id = ${aIntent}
    `)) as unknown as Array<{ n: number }>;
    expect(rows[0]?.n).toBe(0);
  });

  it("S8a-O4: get_briefing ends with its briefing id, the briefing.issued row's id; GET /briefing returns it", async () => {
    const r = await mcp(a.apiKey, "get_briefing", {});
    const lines = r.text.trimEnd().split("\n");
    expect(lines[lines.length - 1]).toMatch(/^Briefing id: [0-9a-f-]{36} — log_feedback accepts it as briefing_id, for feedback about this briefing\.$/);
    const id = briefingIdFrom(r.text);
    const audit = (await getDb().execute(sql`
      SELECT action FROM claimnet.audit_log WHERE id = ${id}::uuid
    `)) as unknown as Array<{ action: string }>;
    expect(audit[0]?.action).toBe("briefing.issued");

    const res = await fetch(`${BASE}/briefing`, { headers: { Authorization: `Bearer ${a.apiKey}` } });
    const body = (await res.json()) as { data?: { text: string; briefingId?: string } };
    expect(body.data?.briefingId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.data?.text).not.toContain("Briefing id:");
  });

  it("S8a-O5: a row attaches to the caller's own briefing; anyone else's, a search id, and a random id get one marker", async () => {
    const own = briefingIdFrom((await mcp(a.apiKey, "get_briefing", {})).text);
    const ok = await mcp(a.apiKey, "log_feedback", row({ kind: "operational", briefing_id: own }));
    expect(ok.text).toMatch(new RegExp(`^Feedback recorded for briefing ${own} `));

    const search = await mcp(a.apiKey, "search_recipes", { query: "anything at all", response_format: "structured" });
    const searchId = String(search.structured?.["searchId"]);
    const answers = await Promise.all([
      mcp(b.apiKey, "log_feedback", row({ kind: "operational", briefing_id: own })),
      mcp(a.apiKey, "log_feedback", row({ kind: "operational", briefing_id: searchId })),
      mcp(a.apiKey, "log_feedback", row({ kind: "operational", briefing_id: UNKNOWN_UUID })),
    ]);
    for (const r of answers) expect(r.text).toBe("Feedback rejected: briefing_id not found or not readable with this key");
  }, 30_000);

  it("S8a-O6: the database refuses a target-less row that is not an outcome row on an intent", async () => {
    const principal = await authenticateKey(getDb(), a.apiKey);
    const insert = (kind: string, intentId: string | null) => getDb().execute(sql`
      INSERT INTO claimnet.check_feedback (api_key_id, kind, impact, disposition, story_fulfilled, story, intent_id)
      VALUES (${principal!.keyId}::uuid, ${kind}, 'none', 'proceeded', 'yes', 'constraint probe', ${intentId})
    `);
    await expect(insert("check-feedback", "int_AbCdEfGhIjKlMnOpQrStUvWx")).rejects.toThrow();
    await expect(insert("outcome", null)).rejects.toThrow();
  });

  // ── Item 7: the exclude-own message ──────────────────────────────────────

  it("S8a-E1: a zero-result search with own recipes hidden leads with the author:me form of the same query", async () => {
    const query = `"${RUN} one"`;
    const md = await mcp(a.apiKey, "search_recipes", { query });
    const lines = md.text.split("\n");
    expect(lines[1]).toMatch(/^Your own recipes were left out by default \(\d+ of the \d+ in scope\)\. The same search including them: author:me "/);
    expect(lines[1]!.endsWith(`author:me ${query}`)).toBe(true);

    const structured = await mcp(a.apiKey, "search_recipes", { query, response_format: "structured" });
    expect(structured.structured?.["ownExcludedQuery"]).toBe(`author:me ${query}`);
    expect(String(structured.structured?.["notice"]).split("\n")[0]).toBe(lines[1]);

    const followed = await mcp(a.apiKey, "search_recipes", { query: `author:me ${query}`, response_format: "structured" });
    expect(followed.structured?.["totalResults"]).toBeGreaterThan(0);
  }, 30_000);

  it("S8a-E2: the web /check filter (no exclude-own default) is unchanged", async () => {
    const qs = new URLSearchParams({ key: a.apiKey, filter: `"zzz-nothing-${RUN}"`, format: "json" });
    const res = await fetch(`${BASE}/check?${qs.toString()}`, { headers: { Accept: "application/json" } });
    const body = (await res.json()) as { data?: Record<string, unknown> };
    expect(body.data?.["ownExcludedQuery"]).toBeUndefined();
    expect(String(body.data?.["notice"])).not.toContain("author:me");
  });

  // ── Unknown parameter names ──────────────────────────────────────────────

  it("S8a-U2: the /mcp route refuses an undeclared name before anything runs", async () => {
    const userId = (await authenticateKey(getDb(), a.apiKey))!.userId;
    const checks = async () => ((await getDb().execute(sql`
      SELECT count(*)::int AS n FROM claimnet.audit_log WHERE action = 'recipe.checked' AND actor_user_id = ${userId}::uuid
    `)) as unknown as Array<{ n: number }>)[0]?.n;
    const before = await checks();
    const r = await mcp(a.apiKey, "check_recipe", {
      recipe: `As a developer testing unknown names, I chose refusal so that a typo never writes. (${RUN})`,
      supporting_evidence: `Why.\n> "quote"\n-- suite`,
      recipe_boook: "soupnet-oss",
    });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/^Error: check_recipe does not take recipe_boook \(did you mean recipe_book\?\)\. Nothing was run;/);
    expect(await checks()).toBe(before);
  });

  /** One tools/call through an in-process server with the guard in the given
   *  mode: the same server the route builds, over an in-memory transport. */
  async function guarded(mode: UnknownParamMode, key: string, name: string, args: Record<string, unknown>) {
    const principal = await authenticateKey(getDb(), key);
    const server = createMcpServer(BASE, principal!);
    const [client, serverSide] = InMemoryTransport.createLinkedPair();
    const replies = new Map<number, JSONRPCMessage>();
    client.onmessage = (m) => {
      const id = (m as { id?: unknown }).id;
      if (typeof id === "number") replies.set(id, m);
    };
    await server.connect(serverSide);
    guardUnknownParams(serverSide as unknown as McpTransportLike, toolParamsFromRegistry(server), mode);
    await client.start();
    await client.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    await client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    await client.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });
    for (let i = 0; i < 400 && !replies.has(2); i++) await new Promise((r) => setTimeout(r, 10));
    await server.close();
    return (replies.get(2) as { result?: { content: Array<{ text: string }>; isError?: boolean } }).result!;
  }

  it("S8a-U2/U3: refuse and warn answer the same call differently (the two responses shown to the operator)", async () => {
    const args = { recipe_ids: traceA, recipe_id: traceA };
    const refused = await guarded("refuse", a.apiKey, "get_recipes", args);
    const warned = await guarded("warn", a.apiKey, "get_recipes", args);
    expect(refused).toEqual({
      content: [{ type: "text", text: "Error: get_recipes does not take recipe_id (did you mean recipe_ids?). Nothing was run; send it again with the names it takes: recipe_ids." }],
      isError: true,
    });
    expect(warned.isError).toBeFalsy();
    expect(warned.content[0]?.text).toBe("Warning: get_recipes ignored recipe_id (did you mean recipe_ids?), which it does not take; the call ran without it. It takes: recipe_ids.");
    expect(warned.content[1]?.text).toContain("1 of 1 resolved");
  }, 30_000);

  it("S8a-U1/U4: declared names pass in both modes, byte-identical to the answer through the route", async () => {
    const args = { recipe_ids: traceA };
    const plain = await mcp(a.apiKey, "get_recipes", args);
    for (const mode of ["refuse", "warn"] as const) {
      const r = await guarded(mode, a.apiKey, "get_recipes", args);
      expect(r.content.map((c) => c.text).join("\n")).toBe(plain.text);
    }
  }, 30_000);

  it("S8a-U1: the deprecated, still-honored names on check_recipe are declared, so the guard passes them", async () => {
    const r = await guarded("refuse", a.apiKey, "check_recipe", {
      recipe: `As a developer testing deprecated levers, I chose to keep honoring them so that old callers still work. (${RUN} deprecated)`,
      supporting_evidence: `Why.\n> "quote"\n-- suite`,
      clusters: 2,
      max_chars: 4000,
    });
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toContain("Recipe checked as #");
  }, 30_000);
});

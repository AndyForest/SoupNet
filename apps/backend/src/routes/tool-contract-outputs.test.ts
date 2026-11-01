import { describe, it, expect, beforeAll } from "vitest";
import { seedVerifiedUser } from "../test-users";

/**
 * Tool output after minimisation, and the profile tool (OpenAI plugin
 * directory stream T, rows T-O2, T-O3, T-P1, T-F1). Layer 3 against a
 * running backend (BACKEND_URL). The field-by-field reasons are in
 * docs/connectors/openai-plugin.md.
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const run = Date.now();
const PASSWORD = "tool-contract-outputs-pw";
type Json = Record<string, unknown>;

describe.skipIf(!BASE)("tool output and the profile tool (stream T)", () => {
  interface Actor { email: string; jwt: string; userId: string; book: string }
  let ann: Actor;
  let bo: Actor;
  let annDaily = ""; // the first of two keys Ann holds
  let annScoped = "";
  let boKey = "";

  function call(jwt: string, method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  }
  async function register(label: string): Promise<Actor> {
    const email = `test-contract-${label}-${run}@test.local`;
    const jwt = ((await (await seedVerifiedUser(email, PASSWORD)).json()) as { data?: { token?: string } }).data?.token ?? "";
    const me = (await (await call(jwt, "GET", "/auth/me")).json()) as { data?: { id?: string; user?: { id: string } } };
    const books = ((await (await call(jwt, "GET", "/recipe-books")).json()) as { data: Array<{ id: string }> }).data;
    return { email, jwt, userId: me.data?.user?.id ?? me.data?.id ?? "", book: books[0]?.id ?? "" };
  }
  async function scopedKey(a: Actor): Promise<string> {
    const res = await call(a.jwt, "POST", "/keys/scoped", { readRecipeBookIds: [a.book], writeRecipeBookIds: [a.book], defaultWriteRecipeBookId: a.book, expiresAt: new Date(Date.now() + 864e5).toISOString() });
    return ((await res.json()) as { data: { key: string } }).data.key;
  }
  async function tool(key: string, name: string, args: Json): Promise<{ text: string; structured?: Json; isError?: boolean }> {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const raw = await res.text();
    const line = raw.split(/\r?\n/).find((l) => l.startsWith("data: "));
    const r = (JSON.parse(line ? line.slice(6) : raw) as { result: { content?: Array<{ text?: string }>; structuredContent?: Json; isError?: boolean } }).result;
    return { text: (r.content ?? []).map((c) => c.text ?? "").join("\n"), ...(r.structuredContent ? { structured: r.structuredContent } : {}), ...(r.isError ? { isError: true } : {}) };
  }
  const evidence = (q: string) => `Why.\n> "${q}"\n-- contract test ${run}`;

  beforeAll(async () => {
    [ann, bo] = await Promise.all([register("ann"), register("bo")]);
    // Two separate keys of one person (named annDaily for the first one minted).
    [annDaily, annScoped, boKey] = await Promise.all([scopedKey(ann), scopedKey(ann), scopedKey(bo)]);
    if (!annDaily || !annScoped || !boKey) throw new Error("key setup failed");
  }, 60_000);

  it("T-F1: get_profile returns the person's stable id with email and display name as separate fields, the same for every key they hold", async () => {
    const viaDaily = await tool(annDaily, "get_profile", {});
    const viaScoped = await tool(annScoped, "get_profile", {});
    const other = await tool(boKey, "get_profile", {});
    expect(viaDaily.structured?.["id"]).toBe(ann.userId);
    expect(viaScoped.structured).toEqual(viaDaily.structured);
    expect(viaDaily.structured?.["email"]).toBe(ann.email);
    expect(Object.keys(viaDaily.structured ?? {}).sort()).toEqual(["displayName", "email", "id"]);
    // A seeded account has no display name: the field is present and null.
    expect(viaDaily.structured?.["displayName"]).toBeNull();
    expect(viaDaily.text).toContain(`Account id: ${ann.userId}`);
    expect(other.structured?.["id"]).toBe(bo.userId);
    expect(other.text).not.toContain(ann.email);
  });

  it("T-F1: get_profile takes no parameters; any argument is refused, so no id can be asked for", async () => {
    const r = await tool(annScoped, "get_profile", { user_id: bo.userId });
    expect(r.isError).toBe(true);
    expect(r.text).not.toContain(bo.email);
  });

  it("T-O3: a structured check and search carry no ranking diagnostics, and keep the product's fields (T-O2)", async () => {
    const check = await tool(annScoped, "check_recipe", { recipe: `As a contract tester working on output audits, I prefer lean structured results so that an agent reads only product fields ${run}.`, supporting_evidence: evidence("lean"), response_format: "structured" });
    const search = await tool(annScoped, "search_recipes", { query: "output audits", response_format: "structured" });
    for (const s of [check.structured, search.structured]) {
      expect(s).toBeDefined();
      expect(s).not.toHaveProperty("ranking");
      expect(s).toHaveProperty("sessionId");
    }
    expect(check.structured?.["checked"]).toHaveProperty("recipeId");
    expect(search.structured).toHaveProperty("searchId");
  });

  it("T-O3: log_feedback and ride-along feedback name their target without the stored row's id", async () => {
    const dep = await tool(annScoped, "check_recipe", { recipe: `As a contract tester working on output audits, I prefer feedback receipts without internal ids so that an agent sees only what it can use ${run}.`, supporting_evidence: evidence("receipt"), response_format: "structured" });
    const id = String((dep.structured?.["checked"] as Json | undefined)?.["recipeId"] ?? "");
    const row = { kind: "check-feedback", trace_id: id, impact: "subtle", disposition: "proceeded", story_fulfilled: "yes", story: "As a tester, I wanted lean receipts.", note: `n ${run}` };
    const logged = await tool(annScoped, "log_feedback", row);
    expect(logged.text).toBe(`Feedback recorded for check ${id}.`);
    const again = await tool(annScoped, "log_feedback", row);
    expect(again.text).toBe(`Feedback already recorded for check ${id} — identical resubmission.`);
    const ride = await tool(annScoped, "check_recipe", { recipe: `As a contract tester working on output audits, I prefer ride-along receipts without internal ids so that an agent sees only what it can use ${run}.`, supporting_evidence: evidence("ride"), response_format: "structured", feedback: [row] });
    const results = ride.structured?.["feedbackResults"] as Json[] | undefined;
    expect(results?.length).toBe(1);
    expect(results?.[0]).not.toHaveProperty("feedbackId");
    expect(results?.[0]?.["traceId"]).toBe(id);
  });

  it("T-P1: asking for synthesis on an account without it says so with no plan wording", async () => {
    const r = await tool(annScoped, "check_recipe", { recipe: `As a contract tester working on output audits, I prefer neutral notices so that no plan is advertised ${run}.`, supporting_evidence: evidence("neutral"), synthesize: true });
    expect(r.text).toContain("Synthesis is off for this account");
    expect(r.text).not.toMatch(/premium|upgrade|plan\b/i);
  });
});

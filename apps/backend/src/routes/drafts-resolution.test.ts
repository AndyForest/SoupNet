import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { seedVerifiedUser } from "../test-users";

/**
 * Layer 3: agent-side resolution of a draft (drafts-and-triage slice 6c).
 *
 * `verify_draft` and POST /recipes/:id/verify take `outcome: verified |
 * rejected | not_chosen` (verified when omitted), with the authority and the
 * structural evidence rule of a verification. Each test names its rubric row
 * (docs/planning/drafts-and-triage-build.md §Slice 6c rubric) and scenario
 * (docs/product-specs/drafts-and-triage.feature, DT-VER-10 to 14).
 *
 * Cast, as in the feature file: Pat, whose agents deposit and resolve; Sam,
 * who owns the shared book; Dana, a member who deposits on Pat's behalf. Pat's
 * keys: K (ordinary, reads and writes both books), H (headless, same books),
 * R (reads the shared book, writes only his personal one).
 *
 * Requires a running backend (BACKEND_URL) and database; skipped otherwise.
 * Direct SQL only reads state back.
 */

type Json = Record<string, unknown>;

const BASE = process.env["BACKEND_URL"] ?? "";
const ACCEPT_BOTH = "application/json, text/event-stream";
const PASSWORD = "drafts-slice6c-test-pw";
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const RANDOM_UUID = "5d2e8a41-3c7b-4f19-8e60-9a1b2c3d4e5f";

function canConnect(): boolean {
  return !!(process.env["DATABASE_URL"] || process.env["PGHOST"]);
}

interface Actor { email: string; jwt: string; userId: string; personalBookId: string; orgId: string }

let n = 0;
function recipe(topic: string): string {
  n += 1;
  return `As a backend maintainer working on draft resolution (${topic} ${run}-${n}), I prefer an agent able to close a draft its person settled so that the review queue holds only open calls.`;
}
const evidence = (quote: string): string => `The test fixture says so.\n> "${quote}"\n-- drafts-resolution.test.ts, ${run}`;
const settling = (tag: string): string => `The person settled it in the session.\n> "settled ${tag} ${run}"\n-- conversation with the person, ${run}`;

describe.skipIf(!BASE || !canConnect())("agent-side resolution of a draft (drafts-and-triage slice 6c)", () => {
  let sql: ReturnType<typeof postgres>;
  let pat: Actor;
  let sam: Actor;
  let dana: Actor;
  let shared = { id: "", slug: "" };
  let K = "";
  let H = "";
  let R = "";
  let samKey = "";
  let danaKey = "";

  // ── helpers ───────────────────────────────────────────────────────────────

  function call(actor: { jwt: string }, method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${actor.jwt}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  async function registerAndVerify(label: string): Promise<Actor> {
    const email = `test-resolve-${label}-${run}@test.local`;
    const login = await seedVerifiedUser(email, PASSWORD);
    const lb = (await login.json()) as { data?: { token?: string; user?: { id: string } } };
    const jwt = lb.data?.token ?? "";
    const userId = lb.data?.user?.id ?? "";
    const books = ((await (await call({ jwt }, "GET", "/recipe-books")).json()) as { data: Array<{ id: string; organization_id: string }> }).data;
    return { email, jwt, userId, personalBookId: books[0]?.id ?? "", orgId: books[0]?.organization_id ?? "" };
  }

  async function mintKey(actor: Actor, read: string[], write: string[], def: string, extra: Json = {}): Promise<string> {
    const res = await call(actor, "POST", "/keys/scoped", {
      readRecipeBookIds: read,
      writeRecipeBookIds: write,
      defaultWriteRecipeBookId: def,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      ...extra,
    });
    const key = ((await res.json()) as { data?: { key?: string } }).data?.key ?? "";
    if (!key) throw new Error(`key mint failed: ${res.status}`);
    return key;
  }

  async function mcp(key: string, name: string, args: Json): Promise<{ text: string; structured: Json | undefined }> {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: ACCEPT_BOTH, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const raw = await res.text();
    const line = raw.split(/\r?\n/).find((l) => l.startsWith("data: "));
    const msg = JSON.parse(line ? line.slice(6) : raw) as { result?: { structuredContent?: Json; content?: Array<{ text?: string }> } };
    return { text: msg.result?.content?.map((c) => c.text ?? "").join("\n") ?? "", structured: msg.result?.structuredContent };
  }

  async function rest(key: string, id: string, body: Json): Promise<{ status: number; text: string; json: Json }> {
    const res = await fetch(`${BASE}/recipes/${id}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, text, json: JSON.parse(text) as Json };
  }

  /** A fresh draft through `key`; returns its id. */
  async function draft(key: string, topic: string, extra: Json = {}): Promise<string> {
    const { structured } = await mcp(key, "check_recipe", {
      recipe: recipe(topic), supporting_evidence: evidence(`draft ${topic}`), response_format: "structured", draft: true, ...extra,
    });
    const id = (structured?.["checked"] as { recipeId?: string } | undefined)?.recipeId ?? "";
    if (!id) throw new Error(`deposit failed for ${topic}`);
    return id;
  }

  async function row(id: string): Promise<Json> {
    const rows = await sql`
      SELECT draft_state, draft_resolved_at, draft_resolved_by_user_id::text AS resolved_by_user,
             draft_resolved_by_key_id::text AS resolved_by_key, user_id::text AS user_id, subject_user_id::text AS subject_user_id
      FROM claimnet.traces WHERE id = ${id}::uuid`;
    return (rows[0] ?? {}) as Json;
  }

  async function counts(id: string): Promise<{ evidence: number; reactions: number; resolutions: number }> {
    const [e] = await sql`SELECT count(*)::int AS n FROM claimnet.trace_evidence WHERE trace_id = ${id}::uuid`;
    const [r] = await sql`SELECT count(*)::int AS n FROM claimnet.trace_reactions WHERE trace_id = ${id}::uuid`;
    const [a] = await sql`SELECT count(*)::int AS n FROM claimnet.audit_log WHERE target_id = ${id} AND action LIKE 'recipe.draft_%'`;
    return { evidence: Number(e?.["n"]), reactions: Number(r?.["n"]), resolutions: Number(a?.["n"]) };
  }

  async function quotesOn(id: string): Promise<string[]> {
    const rows = await sql`
      SELECT r.quote FROM claimnet.trace_references tr JOIN claimnet.references r ON r.id = tr.reference_id
      WHERE tr.trace_id = ${id}::uuid`;
    return rows.map((q) => String(q["quote"]));
  }

  async function queueCount(actor: Actor): Promise<number> {
    return ((await (await call(actor, "GET", "/traces/drafts/count")).json()) as { data: { count: number } }).data.count;
  }

  /** A response with the id (and its 8-character prefix) normalized out. */
  const norm = (text: string, id: string): string => text.split(id).join("<ID>").split(id.slice(0, 8)).join("<ID8>");

  // ── setup ────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    sql = postgres({
      host: process.env["PGHOST"] ?? "localhost",
      port: Number(process.env["PGPORT"] ?? 5633),
      user: process.env["PGUSER"] ?? "claimnet",
      password: process.env["PGPASSWORD"] ?? "claimnet",
      database: process.env["PGDATABASE"] ?? "claimnet",
    });
    [pat, sam, dana] = await Promise.all([registerAndVerify("pat"), registerAndVerify("sam"), registerAndVerify("dana")]);
    const slug = `resolve-${run}`;
    const created = await call(sam, "POST", "/recipe-books", { name: `Resolve ${run}`, slug, organizationId: sam.orgId });
    shared = { id: ((await created.json()) as { data?: { id: string } }).data?.id ?? "", slug };
    if (!shared.id) throw new Error("book create failed");
    for (const m of [pat, dana]) {
      const added = await call(sam, "POST", `/recipe-books/${shared.id}/members`, { email: m.email, role: "member" });
      if (added.status !== 201) throw new Error(`add member failed: ${added.status}`);
    }
    const both = [shared.id, pat.personalBookId];
    K = await mintKey(pat, both, both, shared.id);
    H = await mintKey(pat, both, both, shared.id, { depositLevel: "drafts" });
    R = await mintKey(pat, both, [pat.personalBookId], pat.personalBookId);
    samKey = await mintKey(sam, [shared.id, sam.personalBookId], [shared.id, sam.personalBookId], sam.personalBookId);
    danaKey = await mintKey(dana, [shared.id, dana.personalBookId], [shared.id, dana.personalBookId], shared.id);
  }, 120_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 2 });
  });

  // ── Behaviour ────────────────────────────────────────────────────────────

  it("S6c-B2 / DT-VER-10: Pat's agent rejects a draft: rejected by that key, audited like the queue, no reaction, evidence attached, out of the queue, still hidden from Sam", async () => {
    const id = await draft(K, "reject on mcp");
    const queueBefore = await queueCount(pat);
    const before = await row(id);
    const c0 = await counts(id);

    const r = await mcp(K, "verify_draft", { recipe_id: id, outcome: "rejected", supporting_evidence: settling("reject mcp") });
    expect(r.text).toMatch(new RegExp(`^Draft ${id} is rejected:`));

    const after = await row(id);
    expect(after["draft_state"]).toBe("rejected");
    expect(after["draft_resolved_at"]).not.toBeNull();
    expect(after["resolved_by_user"]).toBe(pat.userId);
    expect(after["resolved_by_key"]).not.toBeNull();
    expect(after["user_id"]).toBe(before["user_id"]);
    expect(after["subject_user_id"]).toBe(before["subject_user_id"]);

    const c1 = await counts(id);
    expect(c1.reactions).toBe(c0.reactions);
    expect(c1.resolutions).toBe(c0.resolutions + 1);
    expect(c1.evidence).toBe(c0.evidence + 1);
    const [audit] = await sql`SELECT action, metadata FROM claimnet.audit_log WHERE target_id = ${id} AND action LIKE 'recipe.draft_%'`;
    expect(audit?.["action"]).toBe("recipe.draft_rejected");
    expect((audit?.["metadata"] as Json)["via"]).toBe("agent");
    expect((audit?.["metadata"] as Json)["evidenceAdded"]).toBe(1);
    expect(await quotesOn(id)).toContain(`settled reject mcp ${run}`);

    expect(await queueCount(pat)).toBe(queueBefore - 1);
    const samReal = await mcp(samKey, "get_recipes", { recipe_ids: id });
    const samRandom = await mcp(samKey, "get_recipes", { recipe_ids: RANDOM_UUID });
    expect(norm(samReal.text, id)).toBe(norm(samRandom.text, RANDOM_UUID));
    expect((await mcp(K, "get_recipes", { recipe_ids: id })).text).toContain("rejected draft");
  });

  it("S6c-B3 / S6c-B5 / DT-VER-11: not_chosen over REST is 200 with the slice 2 shape and draftState not_chosen", async () => {
    const id = await draft(K, "not chosen on rest");
    const res = await rest(K, id, { outcome: "not_chosen", supporting_evidence: settling("not chosen rest") });
    expect(res.status).toBe(200);
    expect(res.json["data"]).toEqual({ recipeId: id, draftState: "not_chosen", evidenceAdded: 1, verifiedByDepositingKey: true });
    expect((await row(id))["draft_state"]).toBe("not_chosen");
    const [audit] = await sql`SELECT action FROM claimnet.audit_log WHERE target_id = ${id} AND action LIKE 'recipe.draft_%'`;
    expect(audit?.["action"]).toBe("recipe.draft_not_chosen");
  });

  it("S6c-B1: outcome verified (explicit) and omitted both publish, as slice 2 did", async () => {
    const a = await draft(K, "explicit verified");
    const b = await draft(K, "omitted outcome");
    expect((await rest(K, a, { outcome: "verified", supporting_evidence: settling("explicit") })).json["data"]).toMatchObject({ draftState: "verified" });
    expect((await mcp(K, "verify_draft", { recipe_id: b, supporting_evidence: settling("omitted") })).text).toContain("is verified");
    expect((await row(a))["draft_state"]).toBe("verified");
    expect((await row(b))["draft_state"]).toBe("verified");
  });

  it("S6c-B6 / DT-VER-14: an unknown outcome is refused before lookup, names the values and any evidence problem, and stores nothing", async () => {
    const id = await draft(K, "unknown outcome");
    const c0 = await counts(id);

    const r = await mcp(K, "verify_draft", { recipe_id: id, outcome: "reject", supporting_evidence: settling("typo") });
    expect(r.text).toContain("verified | rejected | not_chosen");
    expect(r.text).toContain("nothing was stored");
    const both = await mcp(K, "verify_draft", { recipe_id: id, outcome: "reject", supporting_evidence: "" });
    expect(both.text).toContain("verified | rejected | not_chosen");
    expect(both.text).toContain("No evidence was sent");

    const restRes = await rest(K, id, { outcome: "REJECTED", supporting_evidence: settling("typo rest") });
    expect(restRes.status).toBe(400);

    // Decided before the id is looked up: Pat's draft and a random id read alike.
    const random = await mcp(K, "verify_draft", { recipe_id: RANDOM_UUID, outcome: "reject", supporting_evidence: settling("typo") });
    expect(norm(r.text, id)).toBe(norm(random.text, RANDOM_UUID));

    expect((await row(id))["draft_state"]).toBe("unverified");
    expect(await counts(id)).toEqual(c0);
  });

  it("S6c-B7 / DT-VER-03: resolution is one-way across outcomes, and a concurrent verify and reject resolve it once", async () => {
    const done = await draft(K, "already rejected");
    await rest(K, done, { outcome: "rejected", supporting_evidence: settling("first") });
    const again = await rest(K, done, { outcome: "verified", supporting_evidence: settling("second") });
    expect(again.status).toBe(409);
    expect(again.json["status"]).toBe("already_resolved");
    expect((await row(done))["draft_state"]).toBe("rejected");

    const id = await draft(K, "concurrent pair");
    const c0 = await counts(id);
    const results = await Promise.all([
      rest(K, id, { outcome: "verified", supporting_evidence: settling("race verify") }),
      rest(K, id, { outcome: "rejected", supporting_evidence: settling("race reject") }),
    ]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
    const c1 = await counts(id);
    expect(c1.resolutions).toBe(c0.resolutions + 1);
    expect(c1.evidence).toBe(c0.evidence + 1);
    const winner = results.find((x) => x.status === 200)!;
    expect((await row(id))["draft_state"]).toBe((winner.json["data"] as Json)["draftState"]);
  });

  // ── Evidence ─────────────────────────────────────────────────────────────

  it("S6c-E1 / DT-VER-06: a rejection that only re-quotes the draft's own evidence is refused, and the draft stays unverified", async () => {
    const id = await draft(K, "requote");
    const r = await mcp(K, "verify_draft", { recipe_id: id, outcome: "rejected", supporting_evidence: evidence("draft requote") });
    expect(r.text).toMatch(/^Rejecting a draft needs new evidence/);
    expect(r.text).toContain("already");
    expect((await row(id))["draft_state"]).toBe("unverified");
  });

  it("S6c-E2 / DT-VER-12: a rejection citing a covering recipe by id passes, and the cited id is not looked up", async () => {
    const id = await draft(K, "superseded");
    const r = await rest(K, id, {
      outcome: "rejected",
      supporting_evidence: `A later verified recipe covers the same call the other way.\n> "I chose default deny ${run}"\n-- recipe ${RANDOM_UUID}`,
    });
    expect(r.status).toBe(200);
    expect((await row(id))["draft_state"]).toBe("rejected");
  });

  it("S6c-E3: a refusal for missing evidence says how the text was read, worded for the outcome", async () => {
    const id = await draft(K, "explain refusal");
    const r = await mcp(K, "verify_draft", { recipe_id: id, outcome: "not_chosen", supporting_evidence: `Interpretation only.\n> "a quote ${run}"` });
    expect(r.text).toMatch(/^Marking a draft not chosen needs new evidence/);
    expect(r.text).toContain("read as 1 entry: entry 1 has a quote but no citation");
    expect((await row(id))["draft_state"]).toBe("unverified");
  });

  it("S6c-E4 / DT-VER-13: interpretation, quote, and citation separated by blank lines are one entry on verify_draft, REST, and check_recipe", async () => {
    const spaced = (tag: string): string => `The person settled it.\n\n> "spaced ${tag} ${run}"\n\n-- conversation with the person, ${run}`;
    const viaMcp = await draft(K, "spaced mcp");
    expect((await mcp(K, "verify_draft", { recipe_id: viaMcp, outcome: "rejected", supporting_evidence: spaced("mcp") })).text).toContain("is rejected");
    const viaRest = await draft(K, "spaced rest");
    expect((await rest(K, viaRest, { supporting_evidence: spaced("rest") })).status).toBe(200);

    const { structured } = await mcp(K, "check_recipe", { recipe: recipe("spaced check"), supporting_evidence: spaced("check"), response_format: "structured" });
    const checked = (structured?.["checked"] as { recipeId?: string } | undefined)?.recipeId ?? "";
    const entries = await sql`
      SELECT e.content, r.quote, r.source FROM claimnet.trace_evidence te
      JOIN claimnet.evidence e ON e.id = te.evidence_id
      LEFT JOIN claimnet.evidence_references er ON er.evidence_id = e.id
      LEFT JOIN claimnet.references r ON r.id = er.reference_id
      WHERE te.trace_id = ${checked}::uuid`;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.["content"]).toBe("The person settled it.");
    expect(entries[0]?.["quote"]).toBe(`spaced check ${run}`);
    expect(entries[0]?.["source"]).toBe(`conversation with the person, ${run}`);
  });

  // ── Authority and uniform responses ─────────────────────────────────────

  it("S6c-A1: a headless key is refused for every outcome before lookup, with the same bytes for every id, and nothing is stored", async () => {
    const id = await draft(K, "headless target");
    const c0 = await counts(id);
    for (const outcome of ["rejected", "not_chosen", "verified"]) {
      const real = await mcp(H, "verify_draft", { recipe_id: id, outcome, supporting_evidence: settling(`h ${outcome}`) });
      const random = await mcp(H, "verify_draft", { recipe_id: RANDOM_UUID, outcome, supporting_evidence: settling(`h ${outcome}`) });
      expect(real.text).toContain("headless");
      expect(norm(real.text, id)).toBe(norm(random.text, RANDOM_UUID));
      const restRes = await rest(H, id, { outcome, supporting_evidence: settling(`h rest ${outcome}`) });
      expect(restRes.status).toBe(403);
      expect(restRes.json["status"]).toBe("key_cannot_verify");
    }
    expect((await row(id))["draft_state"]).toBe("unverified");
    expect(await counts(id)).toEqual(c0);
  });

  it("S6c-A2: Dana cannot reject or mark not chosen a draft about Pat; Pat's agent can, and it stays Dana's", async () => {
    const id = await draft(danaKey, "on behalf", { on_behalf_of: pat.email });
    for (const outcome of ["rejected", "not_chosen"]) {
      const r = await rest(danaKey, id, { outcome, supporting_evidence: settling(`dana ${outcome}`) });
      expect(r.status).toBe(403);
      expect(r.json["status"]).toBe("only_subject_reviews");
    }
    expect((await row(id))["draft_state"]).toBe("unverified");

    const r = await mcp(K, "verify_draft", { recipe_id: id, outcome: "rejected", supporting_evidence: settling("pat rejects dana's") });
    expect(r.text).toContain("is rejected");
    const after = await row(id);
    expect(after["draft_state"]).toBe("rejected");
    expect(after["user_id"]).toBe(dana.userId);
    expect(after["subject_user_id"]).toBe(pat.userId);
  });

  it("S6c-A3 / DT-VER-07: Sam's key gets a random id's answer for every outcome on Pat's draft, on MCP and REST", async () => {
    const id = await draft(K, "sam probes");
    for (const outcome of ["rejected", "not_chosen"]) {
      const ev = settling(`sam ${outcome}`);
      const real = await mcp(samKey, "verify_draft", { recipe_id: id, outcome, supporting_evidence: ev });
      const random = await mcp(samKey, "verify_draft", { recipe_id: RANDOM_UUID, outcome, supporting_evidence: ev });
      expect(norm(real.text, id)).toBe(norm(random.text, RANDOM_UUID));
      const restReal = await rest(samKey, id, { outcome, supporting_evidence: ev });
      const restRandom = await rest(samKey, RANDOM_UUID, { outcome, supporting_evidence: ev });
      expect(restReal.status).toBe(404);
      expect(restRandom.status).toBe(404);
      expect(norm(restReal.text, id)).toBe(norm(restRandom.text, RANDOM_UUID));
    }
    expect((await row(id))["draft_state"]).toBe("unverified");
  });

  it("S6c-A4 / [F78]: a key that can read but not write the draft's book gets the honest write-access refusal for every outcome", async () => {
    const id = await draft(K, "read only key");
    for (const outcome of ["rejected", "not_chosen"]) {
      const r = await rest(R, id, { outcome, supporting_evidence: settling(`r ${outcome}`) });
      expect(r.status).toBe(403);
      expect(r.json["status"]).toBe("needs_write_access");
    }
    expect((await row(id))["draft_state"]).toBe("unverified");
  });
});

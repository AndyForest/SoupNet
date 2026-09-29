import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

/**
 * Layer 3: headless keys (drafts-and-triage slice 5).
 *
 * Each test names its rubric criterion (docs/planning/drafts-and-triage-build.md
 * §Slice 5 rubric) and scenario (docs/product-specs/drafts-and-triage.feature,
 * DT-HDL-*).
 *
 * Cast: Pat (the keys' owner), Sam (owns the shared book and a second book
 * Pat can read through the keys but not write), Olive (an outsider). Keys: H
 * is Pat's headless scoped key and K an ordinary scoped key of Pat's with the
 * same books; S is Sam's ordinary key.
 *
 * Requires a running backend (BACKEND_URL) and database; skipped otherwise.
 * Direct SQL only reads state back.
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const ACCEPT_BOTH = "application/json, text/event-stream";
const PASSWORD = "headless-test-pw";
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const MARKER = `hdlmarker${run}`;
const RANDOM_UUID = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const HEADLESS_REASON = "because this API key is headless, a setting chosen when the key was made";

function canConnect(): boolean {
  return !!(process.env["DATABASE_URL"] || process.env["PGHOST"]);
}

interface Actor { email: string; jwt: string; userId: string; personalBookId: string; orgId: string }
type Json = Record<string, unknown>;

let n = 0;
function recipe(topic: string): string {
  n += 1;
  return `As a backend maintainer working on headless keys (${topic} ${run}-${n} ${MARKER}), I prefer an unattended agent's calls held as drafts so that I confirm them before anyone relies on them.`;
}
function evidence(quote: string): string {
  return `The person said so in review.\n> "${quote}"\n-- drafts-headless.test.ts, ${run}`;
}

describe.skipIf(!BASE || !canConnect())("headless keys (drafts-and-triage slice 5)", { timeout: 90_000 }, () => {
  let sql: ReturnType<typeof postgres>;
  let pat: Actor;
  let sam: Actor;
  let olive: Actor;
  const shared = { id: "", slug: "" };
  const readOnly = { id: "", slug: "" };
  let H = "";
  let K = "";
  let S = "";

  // ── helpers ───────────────────────────────────────────────────────────────

  function call(actor: { jwt: string }, method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${actor.jwt}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }
  async function login(email: string, password: string): Promise<string> {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }),
    });
    return ((await res.json()) as { data?: { token?: string } }).data?.token ?? "";
  }
  async function register(label: string): Promise<Actor> {
    const email = `test-hdl-${label}-${run}@test.local`;
    const reg = await fetch(`${BASE}/auth/register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, tosAccepted: true }),
    });
    const vtok = ((await reg.json()) as { data?: { verificationToken?: string } }).data?.verificationToken;
    if (!vtok) throw new Error(`register failed for ${email}`);
    await fetch(`${BASE}/auth/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: vtok }) });
    const jwt = await login(email, PASSWORD);
    const me = (await (await call({ jwt }, "GET", "/auth/me")).json()) as { data?: { id?: string; user?: { id: string } } };
    const books = ((await (await call({ jwt }, "GET", "/recipe-books")).json()) as { data?: Array<{ id: string; organization_id: string }> }).data ?? [];
    return { email, jwt, userId: me.data?.user?.id ?? me.data?.id ?? "", personalBookId: books[0]?.id ?? "", orgId: books[0]?.organization_id ?? "" };
  }
  function mintScoped(actor: Actor, read: string[], write: string[], def: string, extra: Json = {}): Promise<Response> {
    return call(actor, "POST", "/keys/scoped", {
      readRecipeBookIds: read, writeRecipeBookIds: write, defaultWriteRecipeBookId: def,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      ...extra,
    });
  }
  async function mintKey(actor: Actor, read: string[], write: string[], def: string, extra: Json = {}): Promise<string> {
    const res = await mintScoped(actor, read, write, def, extra);
    const key = ((await res.json()) as { data?: { key?: string } }).data?.key ?? "";
    if (!key) throw new Error(`key mint failed: ${res.status}`);
    return key;
  }
  async function createBook(owner: Actor, label: string): Promise<{ id: string; slug: string }> {
    const slug = `hdl-${label}-${run}`;
    const created = await call(owner, "POST", "/recipe-books", { name: `Headless ${label} ${run}`, slug, organizationId: owner.orgId });
    const id = ((await created.json()) as { data?: { id: string } }).data?.id ?? "";
    if (!id) throw new Error("book create failed");
    return { id, slug };
  }
  async function addMember(owner: Actor, bookId: string, m: Actor, role = "member"): Promise<void> {
    const r = await call(owner, "POST", `/recipe-books/${bookId}/members`, { email: m.email, role });
    if (r.status !== 201) throw new Error(`add member failed: ${r.status}`);
  }
  async function rpc(key: string, method: string, params: Json): Promise<Json> {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: ACCEPT_BOTH, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const raw = await res.text();
    const line = raw.split(/\r?\n/).find((l) => l.startsWith("data: "));
    return JSON.parse(line ? line.slice(6) : raw) as Json;
  }
  async function mcp(key: string, name: string, args: Json): Promise<{ text: string; structured: Json | undefined }> {
    const msg = (await rpc(key, "tools/call", { name, arguments: args })) as { result?: { structuredContent?: Json; content?: Array<{ text?: string }> } };
    return { text: msg.result?.content?.map((c) => c.text ?? "").join("\n") ?? "", structured: msg.result?.structuredContent };
  }
  async function deposit(key: string, text: string, extra: Json = {}): Promise<Json> {
    const r = await mcp(key, "check_recipe", { recipe: text, supporting_evidence: evidence(`quote ${text.slice(-30)}`), response_format: "structured", ...extra });
    if (!r.structured) throw new Error(`deposit failed: ${r.text}`);
    return r.structured;
  }
  const checkedOf = (s: Json): Json => (s["checked"] as Json | undefined) ?? {};
  const idOf = (s: Json): string => String(checkedOf(s)["recipeId"] ?? "");
  async function row(id: string): Promise<Json | undefined> {
    const rows = await sql`
      SELECT t.user_id::text AS user_id, t.subject_user_id::text AS subject_user_id, t.draft_state, t.group_id::text AS group_id,
             t.decided_at, t.impact, t.api_key_id::text AS api_key_id
      FROM claimnet.traces t WHERE t.id = ${id}::uuid`;
    return rows[0] as Json | undefined;
  }
  async function keyRows(userId: string): Promise<number> {
    const rows = await sql`SELECT count(*)::int AS n FROM claimnet.api_keys WHERE user_id = ${userId}::uuid`;
    return Number(rows[0]?.["n"] ?? 0);
  }
  async function evidenceCount(id: string): Promise<number> {
    const rows = await sql`SELECT count(*)::int AS n FROM claimnet.trace_evidence WHERE trace_id = ${id}::uuid`;
    return Number(rows[0]?.["n"] ?? 0);
  }
  async function auditCount(id: string, action: string): Promise<number> {
    const rows = await sql`SELECT count(*)::int AS n FROM claimnet.audit_log WHERE target_id = ${id}::uuid AND action = ${action}`;
    return Number(rows[0]?.["n"] ?? 0);
  }
  async function reactionRows(id: string): Promise<number> {
    const rows = await sql`SELECT count(*)::int AS n FROM claimnet.trace_reactions WHERE trace_id = ${id}::uuid`;
    return Number(rows[0]?.["n"] ?? 0);
  }
  function verifyRest(key: string, id: string, body: Json = { supporting_evidence: evidence(`fresh ${id}`) }): Promise<Response> {
    return fetch(`${BASE}/recipes/${encodeURIComponent(id)}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
  }
  const norm = (text: string, id: string): string => text.split(id).join("<ID>");
  /** Replace what legitimately differs between two keys' answers: ids,
   *  timestamps, and the key's own identity. */
  const volatile = (text: string): string => text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<UUID>")
    .replace(/int_[A-Za-z0-9]+/g, "<INTENT>")
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, "<TS>")
    .replace(/cn_s_[A-Za-z0-9]+/g, "<KEY>");

  // ── setup ────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    sql = postgres({
      host: process.env["PGHOST"] ?? "localhost",
      port: Number(process.env["PGPORT"] ?? 5633),
      user: process.env["PGUSER"] ?? "claimnet",
      password: process.env["PGPASSWORD"] ?? "claimnet",
      database: process.env["PGDATABASE"] ?? "claimnet",
    });
    [pat, sam, olive] = await Promise.all([register("pat"), register("sam"), register("olive")]);
    Object.assign(shared, await createBook(sam, "shared"));
    Object.assign(readOnly, await createBook(sam, "readonly"));
    await addMember(sam, shared.id, pat);
    await addMember(sam, readOnly.id, pat);
    const read = [shared.id, pat.personalBookId, readOnly.id];
    const write = [shared.id, pat.personalBookId];
    H = await mintKey(pat, read, write, shared.id, { label: `H ${run}`, depositLevel: "drafts" });
    K = await mintKey(pat, read, write, shared.id, { label: `K ${run}` });
    S = await mintKey(sam, [shared.id, sam.personalBookId], [shared.id, sam.personalBookId], sam.personalBookId);
    await deposit(S, recipe("sam published"), { recipe_book: shared.slug });
  }, 180_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 2 });
  });

  // ── Key creation and display ─────────────────────────────────────────────

  it("S5-K1 / DT-HDL-03: depositLevel full and drafts round-trip through the mint response and GET /keys; the default is full", async () => {
    const cases: Array<[Json, string]> = [[{}, "full"], [{ depositLevel: "full" }, "full"], [{ depositLevel: "drafts" }, "drafts"]];
    for (const [extra, expected] of cases) {
      const res = await mintScoped(pat, [pat.personalBookId], [pat.personalBookId], pat.personalBookId, extra);
      expect(res.status, JSON.stringify(extra)).toBe(200);
      const data = ((await res.json()) as { data: { key: string; depositLevel: string } }).data;
      expect(data.depositLevel).toBe(expected);
      const list = ((await (await call(pat, "GET", "/keys")).json()) as { data: Array<{ keyPrefix: string; depositLevel: string }> }).data;
      expect(list.find((k) => k.keyPrefix === data.key.slice(0, 8))?.depositLevel).toBe(expected);
    }
  });

  it("S5-K1: none, true, DRAFTS, and 1 are 400 and mint nothing", async () => {
    const before = await keyRows(pat.userId);
    for (const depositLevel of ["none", true, "DRAFTS", 1, "headless", null]) {
      const res = await mintScoped(pat, [pat.personalBookId], [pat.personalBookId], pat.personalBookId, { depositLevel });
      expect(res.status, JSON.stringify(depositLevel)).toBe(400);
    }
    expect(await keyRows(pat.userId)).toBe(before);
  });

  it("S5-K1 (fix pass): an unknown field such as deposit_level or headless is refused loudly, not ignored into an ordinary key", async () => {
    const before = await keyRows(pat.userId);
    for (const extra of [{ deposit_level: "drafts" }, { headless: true }, { depositlevel: "drafts" }]) {
      const res = await mintScoped(pat, [pat.personalBookId], [pat.personalBookId], pat.personalBookId, extra);
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    expect(await keyRows(pat.userId)).toBe(before);
  });

  it("S5-O1 / DT-HDL-08: a daily key asked for any level but full is refused and mints nothing", async () => {
    const before = await keyRows(pat.userId);
    for (const depositLevel of ["drafts", "none", true, null]) {
      const res = await call(pat, "POST", "/keys/daily", { depositLevel });
      expect(res.status, JSON.stringify(depositLevel)).toBe(400);
      expect(((await res.json()) as { error?: string }).error).toBe("daily_keys_are_full");
    }
    expect(await keyRows(pat.userId)).toBe(before);
    // "full" is not refused for its level (it may still be refused for daily
    // book configuration, which is the ordinary daily rule).
    const full = (await (await call(pat, "POST", "/keys/daily", { depositLevel: "full" })).json()) as { error?: string };
    expect(full.error).not.toBe("daily_keys_are_full");
  });

  it("S5-K2: no route changes an existing key's level (the keys routes are mint, list, revoke, brief)", async () => {
    for (const [method, path] of [["PATCH", "/keys/x"], ["PUT", "/keys/x"], ["POST", "/keys/x"]] as const) {
      const res = await call(pat, method, path, { depositLevel: "full" });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    const rows = await sql`SELECT deposit_level FROM claimnet.api_keys WHERE label = ${`H ${run}`}`;
    expect(rows[0]?.["deposit_level"]).toBe("drafts");
  });

  // ── Forcing drafts on every deposit surface ─────────────────────────────

  let hDraft = "";
  let hDraftText = "";

  it("S5-W1 / S5-W2 / DT-HDL-01: every MCP check through H stores an unverified draft about Pat, whatever draft says, with the headless reason", async () => {
    for (const draft of [undefined, false, "false", "maybe", true]) {
      const text = recipe(`mcp draft ${String(draft)}`);
      const s = await deposit(H, text, draft !== undefined ? { draft } : {});
      const id = idOf(s);
      expect(await row(id), String(draft)).toMatchObject({ user_id: pat.userId, subject_user_id: null, draft_state: "unverified" });
      expect(checkedOf(s)["draftState"]).toBe("unverified");
      const notice = String(s["draftNotice"] ?? "");
      expect(notice, String(draft)).toContain(HEADLESS_REASON);
      expect(notice).toContain(`/app/drafts?ids=${id}`);
      expect(notice).not.toContain("verify_draft");
      // S4-L3's rule: the override clause only when a false flag was sent.
      if (draft === false || draft === "false") expect(notice).toContain("your draft flag was overridden");
      else expect(notice, String(draft)).not.toContain("overridden");
      if (!hDraft) { hDraft = id; hDraftText = text; }
    }
    const md = await mcp(H, "check_recipe", { recipe: recipe("mcp markdown"), supporting_evidence: evidence("md"), draft: false });
    expect(md.text).toContain(HEADLESS_REASON);
  });

  it("S5-W1: the same checks through K store what they store today", async () => {
    const plain = await deposit(K, recipe("K plain"));
    expect(await row(idOf(plain))).toMatchObject({ draft_state: null });
    expect(plain["draftNotice"]).toBeUndefined();
    const off = await deposit(K, recipe("K false"), { draft: false });
    expect(await row(idOf(off))).toMatchObject({ draft_state: null });
    const on = await deposit(K, recipe("K draft"), { draft: true });
    expect(await row(idOf(on))).toMatchObject({ draft_state: "unverified" });
    expect(String(on["draftNotice"])).toContain("verify_draft");
    expect(String(on["draftNotice"])).not.toContain("headless");
  });

  it("S5-W1 / S5-W2: GET /check, POST /check urlencoded and multipart, and the HTML form each store a draft through H", async () => {
    const get = await fetch(`${BASE}/check?${new URLSearchParams({ key: H, recipe: recipe("get"), evidence: evidence("get"), format: "json", draft: "false" }).toString()}`, { headers: { Accept: "application/json" } });
    const getBody = (await get.json()) as { data: { checked: Json; draftNotice: string } };
    expect(await row(String(getBody.data.checked["recipeId"]))).toMatchObject({ user_id: pat.userId, draft_state: "unverified" });
    expect(getBody.data.draftNotice).toContain(HEADLESS_REASON);
    expect(getBody.data.draftNotice).toContain("your draft flag was overridden");

    const post = await fetch(`${BASE}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ key: H, recipe: recipe("post"), evidence: evidence("post"), format: "json" }).toString(),
    });
    const postBody = (await post.json()) as { data: { checked: Json } };
    expect(await row(String(postBody.data.checked["recipeId"]))).toMatchObject({ draft_state: "unverified" });

    const form = new FormData();
    form.set("key", H);
    form.set("recipe", `${recipe("multipart")}\n\n${evidence("multipart")}`);
    const html = await (await fetch(`${BASE}/check`, { method: "POST", body: form })).text();
    const id = /Your recipe was checked as #([0-9a-f-]{36})/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(await row(id!)).toMatchObject({ draft_state: "unverified" });
    expect(html).toContain(HEADLESS_REASON);
    expect(html).not.toContain("verify_draft");

    const page = await (await fetch(`${BASE}/check?${new URLSearchParams({ key: H, recipe: recipe("html get"), evidence: evidence("html get") }).toString()}`)).text();
    const pid = /Your recipe was checked as #([0-9a-f-]{36})/.exec(page)?.[1];
    expect(await row(pid!)).toMatchObject({ draft_state: "unverified" });
  });

  it("S5-W2 (fix pass): the /check HTML form shows a headless key's draft state as forced, and K's as a choice", async () => {
    const draftInput = (html: string): string => /<input type="checkbox" id="draft"[^>]*>/.exec(html)?.[0] ?? "";
    const h = await (await fetch(`${BASE}/check?${new URLSearchParams({ key: H }).toString()}`)).text();
    expect(draftInput(h)).toContain("checked");
    expect(draftInput(h)).toContain("disabled");
    expect(h).toContain("this API key is headless");
    const k = await (await fetch(`${BASE}/check?${new URLSearchParams({ key: K }).toString()}`)).text();
    expect(draftInput(k)).not.toContain("disabled");
    expect(draftInput(k)).not.toContain("checked");
    expect(k).not.toContain("this API key is headless");
  });

  it("S5-W4 / DT-HDL-01: an identical repeat returns the same draft, still a draft; after Pat rejects it the repeat reports that", async () => {
    const again = await deposit(H, hDraftText, { draft: false });
    expect(idOf(again)).toBe(hDraft);
    expect(checkedOf(again)["draftState"]).toBe("unverified");
    const notice = String(again["draftNotice"]);
    expect(notice).toContain("still a draft");
    expect(notice).toContain(`/app/drafts?ids=${hDraft}`);
    expect(notice).not.toContain("verify_draft");

    const text = recipe("to reject");
    const d = idOf(await deposit(H, text));
    expect((await call(pat, "PUT", `/traces/${d}/reaction`, { reaction: "wrong" })).status).toBe(200);
    const repeat = await deposit(H, text);
    expect(idOf(repeat)).toBe(d);
    expect(checkedOf(repeat)["draftState"]).toBe("rejected");
    expect(String(repeat["draftNotice"])).toContain("has since been rejected");
    expect((await row(d))?.["draft_state"]).toBe("rejected");
  });

  it("S5-W3: headless composes with on_behalf_of, decided_at, impact, and a ride-along feedback row", async () => {
    const s = await deposit(H, recipe("combo"), {
      on_behalf_of: sam.email, decided_at: "2024-03-15", impact: "high", recipe_book: shared.slug,
      feedback: [{ trace_id: hDraft, kind: "check-feedback", impact: "none", disposition: "proceeded", story_fulfilled: "yes", story: "combination" }],
    });
    const r = await row(idOf(s));
    expect(r).toMatchObject({ user_id: pat.userId, subject_user_id: sam.userId, draft_state: "unverified", impact: "high" });
    expect(String(r?.["decided_at"])).toContain("2024");
    // The on-behalf reason, since it names who can review the draft.
    const notice = String(s["draftNotice"]);
    expect(notice).toContain(`draft about ${sam.email}`);
    expect(notice).not.toContain("headless");
    const fb = await sql`SELECT count(*)::int AS n FROM claimnet.check_feedback WHERE trace_id = ${hDraft}::uuid AND story = 'combination'`;
    expect(Number(fb[0]?.["n"])).toBe(1);
  });

  // ── Verify refusals ──────────────────────────────────────────────────────

  it("S5-R1 / DT-HDL-04: verify_draft and POST /recipes/:id/verify through H are refused with 403; nothing changes", async () => {
    const d = idOf(await deposit(H, recipe("verify refused")));
    const before = { ev: await evidenceCount(d), audit: await auditCount(d, "recipe.draft_verified"), react: await reactionRows(d) };

    const tool = await mcp(H, "verify_draft", { recipe_id: d, supporting_evidence: evidence(`fresh ${d}`) });
    expect(tool.text).toContain("headless");
    expect(tool.text).toContain("nothing was stored");
    expect(tool.text).toContain(`/app/drafts?ids=${d}`);

    const rest = await verifyRest(H, d);
    expect(rest.status).toBe(403);
    const body = (await rest.json()) as { error: string; status: string };
    expect(body.status).toBe("key_cannot_verify");
    expect(body.error).toBe(tool.text);

    expect((await row(d))?.["draft_state"]).toBe("unverified");
    expect({ ev: await evidenceCount(d), audit: await auditCount(d, "recipe.draft_verified"), react: await reactionRows(d) }).toEqual(before);
  });

  it("S5-U1: H's refusal is the same bytes for its own draft, a published recipe, Sam's draft, a prefix, and a random id", async () => {
    const own = idOf(await deposit(H, recipe("uniform own")));
    const published = idOf(await deposit(K, recipe("uniform published")));
    const samsDraft = idOf(await deposit(S, recipe("uniform sam"), { draft: true }));
    const ids = [own, published, samsDraft, own.slice(0, 8), RANDOM_UUID];
    const tool = await Promise.all(ids.map(async (id) => norm((await mcp(H, "verify_draft", { recipe_id: id, supporting_evidence: evidence("x") })).text, id)));
    const rest = await Promise.all(ids.map(async (id) => {
      const res = await verifyRest(H, id);
      return `${res.status} ${norm(await res.text(), encodeURIComponent(id) === id ? id : encodeURIComponent(id))}`;
    }));
    expect(new Set(tool).size, tool.join("\n")).toBe(1);
    expect(new Set(rest).size, rest.join("\n")).toBe(1);
  });

  it("S5-R2 / DT-HDL-09: Pat reviews H's drafts in the queue, and K verifies one with evidence", async () => {
    const confirm = idOf(await deposit(H, recipe("confirm")));
    const notChosen = idOf(await deposit(H, recipe("not chosen")));
    const byK = idOf(await deposit(H, recipe("verified by K")));

    const queue = (await (await call(pat, "GET", `/traces/drafts?ids=${[confirm, notChosen, byK].join(",")}`)).json()) as { data: { items: Array<{ id: string; canResolve: boolean }> } };
    expect(queue.data.items.map((i) => i.id).sort()).toEqual([confirm, notChosen, byK].sort());
    expect(queue.data.items.every((i) => i.canResolve)).toBe(true);

    expect((await call(pat, "PUT", `/traces/${confirm}/reaction`, { reaction: "still_true" })).status).toBe(200);
    expect((await row(confirm))?.["draft_state"]).toBe("verified");
    expect((await call(pat, "POST", `/traces/${notChosen}/not-chosen`)).status).toBe(200);
    expect((await row(notChosen))?.["draft_state"]).toBe("not_chosen");

    const res = await verifyRest(K, byK);
    expect(res.status).toBe(200);
    const data = ((await res.json()) as { data: { draftState: string; verifiedByDepositingKey: boolean } }).data;
    expect(data).toMatchObject({ draftState: "verified", verifiedByDepositingKey: false });
  });

  it("S5-U2 / DT-HDL-09: H's drafts are ordinary drafts to everyone else: Sam's key gets a random id's answer", async () => {
    const d = idOf(await deposit(H, recipe("hidden from sam"), { recipe_book: shared.slug }));
    const lookup = async (id: string): Promise<string> => norm((await mcp(S, "get_recipes", { recipe_ids: id })).text, id);
    expect(await lookup(d)).toBe(await lookup(RANDOM_UUID));
    const vr = async (id: string): Promise<string> => { const r = await verifyRest(S, id); return `${r.status} ${norm(await r.text(), id)}`; };
    expect(await vr(d)).toBe(await vr(RANDOM_UUID));
    const search = await mcp(S, "search_recipes", { query: `author:anyone "${MARKER}"` });
    expect(search.text).not.toContain(d);
    const olivesKey = await mintKey(olive, [olive.personalBookId], [olive.personalBookId], olive.personalBookId);
    const o = async (id: string): Promise<string> => norm((await mcp(olivesKey, "get_recipes", { recipe_ids: id })).text, id);
    expect(await o(d)).toBe(await o(RANDOM_UUID));
  });

  // ── Every other surface, and descriptions ────────────────────────────────

  it("S5-W5 / DT-HDL-06: H gets K's answers on the read, feedback, upload, and health surfaces", async () => {
    const pairs: Array<[string, (key: string) => Promise<string>]> = [
      ["search_recipes", async (key) => (await mcp(key, "search_recipes", { query: `author:me "${MARKER}"`, verbosity: "high" })).text.replace(/Search id: \S+/, "").replace(/Session: \S+/, "")],
      ["get_recipes", async (key) => (await mcp(key, "get_recipes", { recipe_ids: `${hDraft},${RANDOM_UUID}` })).text],
      ["GET /recipes", async (key) => (await (await fetch(`${BASE}/recipes?ids=${hDraft}`, { headers: { Authorization: `Bearer ${key}` } })).text())],
      ["list_my_recipe_books", async (key) => (await mcp(key, "list_my_recipe_books", {})).text],
      ["/check?filter", async (key) => {
        const b = (await (await fetch(`${BASE}/check?${new URLSearchParams({ key, filter: `is:draft "${MARKER}"`, format: "json" }).toString()}`, { headers: { Accept: "application/json" } })).json()) as { data: { results: Array<{ recipeId: string }> } };
        const ids = b.data.results.map((r) => r.recipeId);
        // Never compare two empty or undefined lists (the fix pass's point).
        expect(ids.length, "is:draft results").toBeGreaterThan(0);
        expect(ids.every((id) => typeof id === "string" && id.length === 36), ids.join(",")).toBe(true);
        return ids.sort().join(",");
      }],
      ["log_feedback", async (key) => (await mcp(key, "log_feedback", { trace_id: hDraft, kind: "operational", impact: "none", disposition: "proceeded", story_fulfilled: "unknown", story: "parity" })).text],
      ["/health/integrity", async (key) => (await (await fetch(`${BASE}/health/integrity`, { headers: { Authorization: `Bearer ${key}` } })).text()).replace(/"checkedAt":"[^"]*"/, "")],
      ["/health/version", async (key) => { const r = await fetch(`${BASE}/health/version`, { headers: { Authorization: `Bearer ${key}` } }); return String(r.status); }],
      ["POST /uploads", async (key) => {
        const form = new FormData();
        form.set("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")], { type: "image/png" }), "p.png");
        const r = await fetch(`${BASE}/uploads`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
        return `${r.status} ${Object.keys((await r.json()) as Json).sort().join(",")}`;
      }],
    ];
    for (const [name, surface] of pairs) {
      const h = volatile(await surface(H));
      const k = volatile(await surface(K));
      expect(h, name).toBe(k);
    }
  });

  it("S5-W6 / DT-HDL-07 (as amended by ruling 42): H updates a book description like any key, with the same answers and audit row", async () => {
    const text = `Pat's personal notes, kept current by an unattended agent (${run}).`;
    const ok = await mcp(H, "update_recipe_book_description", { recipe_book_id_or_slug: pat.personalBookId, description: text });
    expect(ok.text).not.toMatch(/headless|refus/i);
    const desc = await sql`SELECT description FROM claimnet.groups WHERE id = ${pat.personalBookId}::uuid`;
    expect(desc[0]?.["description"]).toBe(text);
    const audit = await sql`SELECT count(*)::int AS n FROM claimnet.audit_log WHERE target_id = ${pat.personalBookId}::uuid AND action = 'group.description_updated'`;
    expect(Number(audit[0]?.["n"])).toBeGreaterThanOrEqual(1);
    for (const target of [readOnly.slug, `no-such-book-${run}`]) {
      const h = await mcp(H, "update_recipe_book_description", { recipe_book_id_or_slug: target, description: "x" });
      const k = await mcp(K, "update_recipe_book_description", { recipe_book_id_or_slug: target, description: "x" });
      expect(h.text, target).toBe(k.text);
    }
  });

  // ── Briefing and budgets ─────────────────────────────────────────────────

  it("S5-B1 / DT-HDL-05: H's briefing is K's plus the one headless section, on get_briefing, GET /briefing, and POST /keys/briefing", async () => {
    const section = "## This key is headless\n";
    const hb = (await mcp(H, "get_briefing", {})).text;
    const kb = (await mcp(K, "get_briefing", {})).text;
    expect(hb).toContain(section);
    expect(kb).not.toContain(section);
    const stripped = hb.replace(/\n\n## This key is headless\n[^\n]*/, "");
    expect(volatile(stripped)).toBe(volatile(kb));

    const stdioH = (await (await fetch(`${BASE}/briefing`, { headers: { Authorization: `Bearer ${H}`, "X-SoupNet-Surface": "mcp-stdio" } })).json()) as { data: { text: string } };
    expect(stdioH.data.text).toContain(section);
    const restK = (await (await fetch(`${BASE}/briefing`, { headers: { Authorization: `Bearer ${K}` } })).json()) as { data: { text: string } };
    expect(restK.data.text).not.toContain(section);

    const copy = async (key: string): Promise<string> => ((await (await call(pat, "POST", "/keys/briefing", { key })).json()) as { data: { text: string } }).data.text;
    expect(await copy(H)).toContain(section);
    expect(await copy(K)).not.toContain(section);
  });

  it("S5-Z1: the served remote tools/list is byte-identical for H and K", async () => {
    const h = JSON.stringify((await rpc(H, "tools/list", {}))["result"]);
    const k = JSON.stringify((await rpc(K, "tools/list", {}))["result"]);
    expect(h).toBe(k);
    expect(h).toContain("\"verify_draft\"");
  });

  // Last: the workspace binds to H's own grant (capability self-binding), so
  // after this H reads one book K does not, and the parity tests above would
  // no longer compare like with like.
  it("S5-W3 / DT-HDL-06: H creates an ephemeral workspace, and a deposit there is a draft", async () => {
    const res = await fetch(`${BASE}/workspaces`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${H}` }, body: "{}" });
    expect(res.status).toBe(201);
    const ws = ((await res.json()) as { data: { recipeBookId: string; slug: string } }).data;
    const s = await deposit(H, recipe("workspace"), { recipe_book: ws.slug });
    expect(await row(idOf(s))).toMatchObject({ group_id: ws.recipeBookId, draft_state: "unverified" });
    // S5-W5: K creates one the same way.
    const kRes = await fetch(`${BASE}/workspaces`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${K}` }, body: "{}" });
    expect(kRes.status).toBe(201);
    expect(Object.keys(((await kRes.json()) as { data: Json }).data).sort()).toEqual(Object.keys(ws).sort());
  });
});

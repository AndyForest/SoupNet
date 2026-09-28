import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedVerifiedUser } from "../test-users";
import postgres from "postgres";

/**
 * Layer 3: drafts on behalf of another person (drafts-and-triage slice 4).
 *
 * Each test names its rubric criterion (docs/planning/drafts-and-triage-build.md
 * §Slice 4 rubric) and scenario (docs/product-specs/drafts-and-triage.feature,
 * DT-OBO-*).
 *
 * Cast: Pat (the subject), Dana (the depositor), Sam (owns the shared book,
 * neither role), Olive (an outsider: her own book only), Uma (a member of the
 * shared book whose account cannot act: email never verified), and the system
 * user. Keys: P and D read and write the shared book; P2 and D2 hold only
 * their owner's personal book. The subject and the depositor are separate
 * people throughout (the slice 3 carry-forward: parity must tell them apart).
 *
 * Requires a running backend (BACKEND_URL) and database; skipped otherwise.
 * Direct SQL only reads state back.
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const ACCEPT_BOTH = "application/json, text/event-stream";
const PASSWORD = "on-behalf-test-pw";
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const MARKER = `obomarker${run}`;
const RANDOM_UUID = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

function canConnect(): boolean {
  return !!(process.env["DATABASE_URL"] || process.env["PGHOST"]);
}

interface Actor { email: string; jwt: string; userId: string; personalBookId: string; orgId: string }
type Json = Record<string, unknown>;

let n = 0;
/** Every recipe carries a token unique to it, so a quoted search finds exactly that one. */
const tokenOf = (text: string): string => / (\S+-\d+) obomarker/.exec(text)?.[1] ?? "";
function recipe(topic: string): string {
  n += 1;
  return `As a backend maintainer working on on-behalf drafts (${topic} ${run}-${n} ${MARKER}), I prefer a colleague's judgment recorded as a draft so that they confirm it before anyone relies on it.`;
}
function evidence(quote: string): string {
  return `The colleague said so in review.\n> "${quote}"\n-- drafts-on-behalf.test.ts, ${run}`;
}

describe.skipIf(!BASE || !canConnect())("drafts on behalf of another person (drafts-and-triage slice 4)", { timeout: 90_000 }, () => {
  let sql: ReturnType<typeof postgres>;
  let pat: Actor;
  let dana: Actor;
  let sam: Actor;
  let olive: Actor;
  let uma: Actor;
  let system: { jwt: string };
  const shared = { id: "", slug: "" };
  let P = "";
  let P2 = "";
  let D = "";
  let D2 = "";
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
  async function register(label: string, verify = true): Promise<Actor> {
    const email = `test-obo-${label}-${run}@test.local`;
    if (verify) {
      await seedVerifiedUser(email, PASSWORD);
    } else {
      // An unverified account goes through the real signup (no verify step).
      const reg = await fetch(`${BASE}/auth/register`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: PASSWORD, tosAccepted: true }),
      });
      if (!reg.ok) throw new Error(`register failed for ${email}`);
    }
    const jwt = await login(email, PASSWORD);
    const me = (await (await call({ jwt }, "GET", "/auth/me")).json()) as { data?: { id?: string; user?: { id: string } } };
    const books = ((await (await call({ jwt }, "GET", "/recipe-books")).json()) as { data?: Array<{ id: string; organization_id: string }> }).data ?? [];
    return { email, jwt, userId: me.data?.user?.id ?? me.data?.id ?? "", personalBookId: books[0]?.id ?? "", orgId: books[0]?.organization_id ?? "" };
  }
  async function mintKey(actor: Actor, books: string[], def: string, label?: string): Promise<string> {
    const res = await call(actor, "POST", "/keys/scoped", {
      readRecipeBookIds: books, writeRecipeBookIds: books, defaultWriteRecipeBookId: def,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      ...(label ? { label } : {}),
    });
    const key = ((await res.json()) as { data?: { key?: string } }).data?.key ?? "";
    if (!key) throw new Error(`key mint failed: ${res.status}`);
    return key;
  }
  async function addMember(owner: Actor, bookId: string, m: Actor): Promise<void> {
    const r = await call(owner, "POST", `/recipe-books/${bookId}/members`, { email: m.email, role: "member" });
    if (r.status !== 201) throw new Error(`add member failed: ${r.status}`);
  }
  async function mcp(key: string, name: string, args: Json): Promise<{ text: string; structured: Json | undefined; raw: string }> {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: ACCEPT_BOTH, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const raw = await res.text();
    const line = raw.split(/\r?\n/).find((l) => l.startsWith("data: "));
    const msg = JSON.parse(line ? line.slice(6) : raw) as { result?: { structuredContent?: Json; content?: Array<{ text?: string }> } };
    return { text: msg.result?.content?.map((c) => c.text ?? "").join("\n") ?? "", structured: msg.result?.structuredContent, raw };
  }
  async function toolsList(key: string): Promise<Array<{ name: string; inputSchema: { properties?: Json } }>> {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: ACCEPT_BOTH, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    const raw = await res.text();
    const line = raw.split(/\r?\n/).find((l) => l.startsWith("data: "));
    return (JSON.parse(line ? line.slice(6) : raw) as { result: { tools: Array<{ name: string; inputSchema: { properties?: Json } }> } }).result.tools;
  }
  /** A structured MCP deposit; throws when the check was refused. */
  async function deposit(key: string, text: string, extra: Json = {}): Promise<Json> {
    const r = await mcp(key, "check_recipe", { recipe: text, supporting_evidence: evidence(`quote ${text.slice(-30)}`), response_format: "structured", ...extra });
    if (!r.structured) throw new Error(`deposit failed: ${r.text}`);
    return r.structured;
  }
  const checkedOf = (s: Json): Json => (s["checked"] as Json | undefined) ?? {};
  const idOf = (s: Json): string => String(checkedOf(s)["recipeId"] ?? "");
  /** A draft Dana's key D deposits about Pat. */
  async function onBehalf(topic: string, extra: Json = {}): Promise<string> {
    return idOf(await deposit(D, recipe(topic), { on_behalf_of: pat.email, ...extra }));
  }
  async function row(id: string): Promise<Json | undefined> {
    const rows = await sql`
      SELECT t.user_id::text AS user_id, t.subject_user_id::text AS subject_user_id, t.draft_state, t.group_id::text AS group_id,
             t.draft_resolved_by_user_id::text AS resolved_by, t.draft_resolved_at, t.decided_at, t.impact,
             ak.user_id::text AS key_owner
      FROM claimnet.traces t LEFT JOIN claimnet.api_keys ak ON ak.id = t.api_key_id
      WHERE t.id = ${id}::uuid`;
    return rows[0] as Json | undefined;
  }
  async function tracesWithText(text: string): Promise<number> {
    const rows = await sql`SELECT count(*)::int AS n FROM claimnet.traces WHERE claim_text = ${text}`;
    return Number(rows[0]?.["n"] ?? 0);
  }
  async function checkedAuditRows(userId: string): Promise<number> {
    const rows = await sql`SELECT count(*)::int AS n FROM claimnet.audit_log WHERE actor_user_id = ${userId}::uuid AND action = 'recipe.checked'`;
    return Number(rows[0]?.["n"] ?? 0);
  }
  async function auditFor(traceId: string, action: string): Promise<Json[]> {
    const rows = await sql`SELECT actor_user_id::text AS actor, metadata FROM claimnet.audit_log WHERE target_id = ${traceId}::uuid AND action = ${action} ORDER BY occurred_at`;
    return rows as unknown as Json[];
  }
  async function reactionRows(id: string, userId: string): Promise<number> {
    const rows = await sql`SELECT count(*)::int AS n FROM claimnet.trace_reactions WHERE trace_id = ${id}::uuid AND user_id = ${userId}::uuid`;
    return Number(rows[0]?.["n"] ?? 0);
  }
  async function detail(actor: { jwt: string }, id: string): Promise<{ status: number; body: Json }> {
    const res = await call(actor, "GET", `/traces/${id}`);
    return { status: res.status, body: (await res.json()) as Json };
  }
  const dataOf = (b: Json): Json => (b["data"] as Json | undefined) ?? {};
  interface QueueItem { id: string; state: string; canResolve: boolean; blockedReason?: string; depositedBy: string | null; about: string | null; keyLabel: string | null }
  async function queue(actor: { jwt: string }, q?: string): Promise<{ items: QueueItem[]; total: number }> {
    const out: QueueItem[] = [];
    let total = 0;
    for (let page = 1; page < 30; page++) {
      const qs = new URLSearchParams({ page: String(page), ...(q ? { q } : {}) });
      const body = (await (await call(actor, "GET", `/traces/drafts?${qs.toString()}`)).json()) as { data: { items: QueueItem[]; total: number; totalPages: number } };
      out.push(...body.data.items);
      total = body.data.total;
      if (page >= body.data.totalPages) break;
    }
    return { items: out, total };
  }
  async function queueCount(actor: { jwt: string }): Promise<number> {
    const body = (await (await call(actor, "GET", "/traces/drafts/count")).json()) as { data: { count: number } };
    return body.data.count;
  }
  async function link(actor: { jwt: string }, ids: string): Promise<{ status: number; text: string; data: { items: QueueItem[]; notShown: number } }> {
    const res = await call(actor, "GET", `/traces/drafts?ids=${encodeURIComponent(ids)}`);
    const text = await res.text();
    return { status: res.status, text, data: (JSON.parse(text) as { data: { items: QueueItem[]; notShown: number } }).data };
  }
  const norm = (text: string, id: string): string => text.split(id).join("<ID>").split(id.slice(0, 8)).join("<ID8>");
  /** Two responses equal once each one's own id is replaced (the uniform-answer comparison). */
  async function sameAsRandom(send: (id: string) => Promise<Response>, id: string): Promise<void> {
    const a = await send(id);
    const b = await send(RANDOM_UUID);
    expect(a.status, "status").toBe(b.status);
    expect(norm(await a.text(), id)).toBe(norm(await b.text(), RANDOM_UUID));
  }

  // ── setup ────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    sql = postgres({
      host: process.env["PGHOST"] ?? "localhost",
      port: Number(process.env["PGPORT"] ?? 5633),
      user: process.env["PGUSER"] ?? "claimnet",
      password: process.env["PGPASSWORD"] ?? "claimnet",
      database: process.env["PGDATABASE"] ?? "claimnet",
    });
    [pat, dana, sam, olive, uma] = await Promise.all([
      register("pat"), register("dana"), register("sam"), register("olive"), register("uma", false),
    ]);
    system = { jwt: await login(process.env["DEV_USERNAME"] ?? "", process.env["DEV_PASSWORD"] ?? "") };
    const slug = `obo-${run}`;
    const created = await call(sam, "POST", "/recipe-books", { name: `On behalf ${run}`, slug, organizationId: sam.orgId });
    Object.assign(shared, { id: ((await created.json()) as { data?: { id: string } }).data?.id ?? "", slug });
    if (!shared.id) throw new Error("book create failed");
    for (const m of [pat, dana, uma]) await addMember(sam, shared.id, m);

    P = await mintKey(pat, [shared.id, pat.personalBookId], shared.id, `Pat key ${run}`);
    P2 = await mintKey(pat, [pat.personalBookId], pat.personalBookId);
    D = await mintKey(dana, [shared.id, dana.personalBookId], shared.id, `Dana key ${run}`);
    D2 = await mintKey(dana, [dana.personalBookId], dana.personalBookId);
    S = await mintKey(sam, [shared.id, sam.personalBookId], sam.personalBookId);
    // A published corpus in the shared book.
    await deposit(S, recipe("sam published"), { recipe_book: shared.slug });
  }, 180_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 2 });
  });

  // ── The wire parameter ───────────────────────────────────────────────────

  let mainDraft = "";
  let mainToken = "";

  it("S4-W2 / DT-OBO-01: naming Pat stores an unverified draft about him, authored by Dana through key D, whatever draft says", async () => {
    for (const draft of [undefined, false, "false", "maybe"]) {
      const text = recipe(`draft ${String(draft)}`);
      const s = await deposit(D, text, { on_behalf_of: pat.email, ...(draft !== undefined ? { draft } : {}) });
      const id = idOf(s);
      const r = await row(id);
      expect(r, String(draft)).toMatchObject({ user_id: dana.userId, subject_user_id: pat.userId, draft_state: "unverified", key_owner: dana.userId });
      expect(checkedOf(s)["draftState"]).toBe("unverified");
      expect(checkedOf(s)["draftAbout"]).toBe(pat.email);
      const notice = String(s["draftNotice"] ?? "");
      expect(notice).toContain(`draft about ${pat.email}`);
      expect(notice).toContain("on their behalf");
      // S4-L3: the override clause only when a false flag was actually sent.
      if (draft === false || draft === "false") expect(notice).toContain("your draft flag was overridden");
      else expect(notice, String(draft)).not.toContain("overridden");
      if (!mainDraft) { mainDraft = id; mainToken = tokenOf(text); }
    }
  });

  it("S4-L3: the deposit notice says who can see it and who confirms it, hands over the subject's link, and never says verify_draft", async () => {
    const s = await deposit(D, recipe("notice"), { on_behalf_of: pat.email, draft: true });
    const notice = String(s["draftNotice"] ?? "");
    expect(notice).toContain("only they can confirm or reject it");
    expect(notice).toContain(`/app/drafts?ids=${idOf(s)}`);
    expect(notice).not.toContain("verify_draft");
    expect(notice).not.toContain("overridden");
    const md = await mcp(D, "check_recipe", { recipe: recipe("notice md"), supporting_evidence: evidence("md"), on_behalf_of: pat.email });
    expect(md.text).toContain(`draft about ${pat.email}`);
  });

  it("S4-W1 / DT-OBO-09: GET /check, POST /check urlencoded and multipart each store a draft about Pat, trimmed and matched case-insensitively", async () => {
    const odd = `  ${pat.email.toUpperCase()}  `;
    const get = await fetch(`${BASE}/check?${new URLSearchParams({ key: D, recipe: recipe("get"), evidence: evidence("get"), format: "json", on_behalf_of: odd }).toString()}`, { headers: { Accept: "application/json" } });
    const getBody = (await get.json()) as { data: { checked: Json; draftNotice: string } };
    expect(await row(String(getBody.data.checked["recipeId"]))).toMatchObject({ subject_user_id: pat.userId, draft_state: "unverified" });
    expect(getBody.data.checked["draftAbout"]).toBe(pat.email);

    const post = await fetch(`${BASE}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ key: D, recipe: recipe("post"), evidence: evidence("post"), format: "json", on_behalf_of: odd }).toString(),
    });
    const postBody = (await post.json()) as { data: { checked: Json } };
    expect(await row(String(postBody.data.checked["recipeId"]))).toMatchObject({ subject_user_id: pat.userId, draft_state: "unverified" });

    const form = new FormData();
    form.set("key", D);
    form.set("recipe", `${recipe("multipart")}\n\n${evidence("multipart")}`);
    form.set("on_behalf_of", odd);
    const html = await (await fetch(`${BASE}/check`, { method: "POST", body: form })).text();
    const id = /Your recipe was checked as #([0-9a-f-]{36})/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(await row(id!)).toMatchObject({ subject_user_id: pat.userId, draft_state: "unverified" });
    expect(html).toContain(`draft about ${pat.email}`);
  });

  it("S4-W1: the /check HTML form offers on_behalf_of and carries it on the re-check form", async () => {
    const page = await (await fetch(`${BASE}/check?${new URLSearchParams({ key: D, on_behalf_of: pat.email }).toString()}`)).text();
    expect(page).toContain('name="on_behalf_of"');
    expect(page).toContain(`value="${pat.email}"`);
  });

  it("S4-W3 / DT-OBO-05: naming the key's own user, in any case and padding, is an ordinary check with draft applying as usual", async () => {
    const plain = await deposit(D, recipe("self plain"), { on_behalf_of: `  ${dana.email.toUpperCase()} ` });
    expect(await row(idOf(plain))).toMatchObject({ user_id: dana.userId, subject_user_id: null, draft_state: null });
    expect(plain["draftNotice"]).toBeUndefined();
    expect(checkedOf(plain)["draftAbout"]).toBeUndefined();
    const drafted = await deposit(D, recipe("self draft"), { on_behalf_of: dana.email, draft: true });
    expect(await row(idOf(drafted))).toMatchObject({ user_id: dana.userId, subject_user_id: null, draft_state: "unverified" });
    const without = await deposit(D, recipe("self draft baseline"), { draft: true });
    // Same notice as a self draft without the parameter, apart from the id.
    expect(norm(String(drafted["draftNotice"]), idOf(drafted))).toBe(norm(String(without["draftNotice"]), idOf(without)));
  });

  it("S4-W4: an empty on_behalf_of is the same as absent", async () => {
    const s = await deposit(D, recipe("empty"), { on_behalf_of: "   " });
    expect(await row(idOf(s))).toMatchObject({ subject_user_id: null, draft_state: null });
  });

  it("S4-W4 / S4-U1 / DT-OBO-02: every unnameable value refuses the check with one answer on every surface; nothing is stored or audited", async () => {
    const cases: Array<[string, unknown]> = [
      ["unknown", `nobody-${run}@test.local`],
      ["member of another book only", olive.email],
      ["a member who cannot act", uma.email],
      ["malformed", "not an email"],
      ["the book owner's own key naming an outsider", olive.email.toUpperCase()],
    ];
    const text = recipe("refused");
    const auditBefore = await checkedAuditRows(dana.userId);
    const answers: Record<string, string[]> = { mcpText: [], mcpStructured: [], json: [], html: [] };
    for (const [, value] of cases) {
      const md = await mcp(D, "check_recipe", { recipe: text, supporting_evidence: evidence("x"), on_behalf_of: value });
      answers["mcpText"]!.push(md.raw);
      const st = await mcp(D, "check_recipe", { recipe: text, supporting_evidence: evidence("x"), on_behalf_of: value, response_format: "structured" });
      answers["mcpStructured"]!.push(st.raw);
      const js = await fetch(`${BASE}/check?${new URLSearchParams({ key: D, recipe: text, evidence: evidence("x"), format: "json", on_behalf_of: String(value) }).toString()}`, { headers: { Accept: "application/json" } });
      answers["json"]!.push(`${js.status} ${await js.text()}`);
      const ht = await fetch(`${BASE}/check?${new URLSearchParams({ key: D, recipe: text, evidence: evidence("x"), on_behalf_of: String(value) }).toString()}`);
      // The form and its copy links echo what was typed; replace every
      // encoding of it before comparing ("after replacing the email").
      let page = await ht.text();
      for (const form of [
        String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"),
        new URLSearchParams({ v: String(value) }).toString().slice(2),
        encodeURIComponent(String(value)),
      ]) page = page.split(form).join("<EMAIL>");
      answers["html"]!.push(`${ht.status} ${page}`);
    }
    // A non-string on MCP is refused the same way.
    answers["mcpText"]!.push((await mcp(D, "check_recipe", { recipe: text, supporting_evidence: evidence("x"), on_behalf_of: 42 })).raw);
    for (const [surface, list] of Object.entries(answers)) {
      expect(new Set(list).size, `${surface}: ${list[0]?.slice(0, 300)}`).toBe(1);
    }
    expect(answers["mcpText"]![0]).toContain("nothing was stored");
    expect(answers["mcpText"]![0]).toContain("check without on_behalf_of");
    expect(answers["json"]![0]).toMatch(/^400 /);
    expect(await tracesWithText(text)).toBe(0);
    expect(await checkedAuditRows(dana.userId)).toBe(auditBefore);
  });

  it("S4-W5 / S4-S4: on_behalf_of composes with decided_at, ratings, and a ride-along feedback row; the audit row carries the subject and is completed by the search", async () => {
    const earlier = await deposit(D, recipe("earlier"));
    const s = await deposit(D, recipe("combined"), {
      on_behalf_of: pat.email, decided_at: "2024-03-15", impact: "high", uncertainty: "low",
      feedback: [{ trace_id: idOf(earlier), kind: "check-feedback", impact: "subtle", disposition: "proceeded", story_fulfilled: "yes", story: "combined", note: "combined" }],
    });
    const id = idOf(s);
    const r = await row(id);
    expect(r).toMatchObject({ subject_user_id: pat.userId, user_id: dana.userId, draft_state: "unverified", impact: "high" });
    expect(new Date(String(r?.["decided_at"])).toISOString().slice(0, 10)).toBe("2024-03-15");
    const fb = await sql`SELECT count(*)::int AS n FROM claimnet.check_feedback WHERE trace_id = ${idOf(earlier)}::uuid`;
    expect(Number(fb[0]?.["n"])).toBe(1);
    const audit = await auditFor(id, "recipe.checked");
    expect(audit.length).toBe(1);
    const meta = audit[0]!["metadata"] as Json;
    expect(audit[0]!["actor"]).toBe(dana.userId);
    expect(meta["subjectUserId"]).toBe(pat.userId);
    expect(meta["draft"]).toBe(true);
    expect(Array.isArray(meta["resultTraceIds"])).toBe(true);
    expect(JSON.stringify(meta)).not.toContain(pat.email);
  });

  it("S4-W6: search ignores on_behalf_of, and search_recipes declares no new parameter; check_recipe declares exactly one", async () => {
    const res = await fetch(`${BASE}/check?${new URLSearchParams({ key: D, filter: `"${MARKER}"`, format: "json", on_behalf_of: `nobody-${run}@test.local` }).toString()}`, { headers: { Accept: "application/json" } });
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    const tools = await toolsList(D);
    expect(Object.keys(tools.find((t) => t.name === "search_recipes")?.inputSchema.properties ?? {})).not.toContain("on_behalf_of");
    expect(Object.keys(tools.find((t) => t.name === "check_recipe")?.inputSchema.properties ?? {})).toContain("on_behalf_of");
  });

  // ── Visibility ───────────────────────────────────────────────────────────

  it("S4-V1 / S4-L1 / DT-OBO-03: Pat's agents find the draft labelled as deposited by Dana, in both formats and by id", async () => {
    const md = await mcp(P, "search_recipes", { query: `"${mainToken}"` });
    const line = md.text.split("\n").find((l) => l.includes(mainDraft));
    expect(line).toContain(`[unverified draft, deposited by ${dana.email}:`);
    const st = await mcp(P, "search_recipes", { query: `"${mainToken}"`, response_format: "structured" });
    const hit = ((st.structured?.["results"] ?? []) as Json[]).find((r) => r["recipeId"] === mainDraft);
    expect(hit).toMatchObject({ draftState: "unverified", draftDepositedBy: dana.email });
    expect(hit?.["draftAbout"]).toBeUndefined();
    const byId = await mcp(P, "get_recipes", { recipe_ids: mainDraft });
    expect(byId.text).toContain(`Draft: [unverified draft, deposited by ${dana.email}:`);
    const rest = (await (await fetch(`${BASE}/recipes?ids=${mainDraft}`, { headers: { Authorization: `Bearer ${P}` } })).json()) as { data: { recipes: Json[] } };
    expect(rest.data.recipes[0]).toMatchObject({ status: "ok", draftState: "unverified", draftDepositedBy: dana.email });
    const page = await (await fetch(`${BASE}/check?${new URLSearchParams({ key: P, filter: `"${mainToken}"` }).toString()}`)).text();
    expect(page).toContain(`deposited by ${dana.email}`);
  });

  it("S4-V1 / S4-Q4: Dana's agents find it labelled as about Pat only under author:me or author:anyone, never under is:draft", async () => {
    const byDefault = await mcp(D, "search_recipes", { query: `"${mainToken}"` });
    expect(byDefault.raw).not.toContain(mainDraft);
    for (const query of [`author:me "${mainToken}"`, `author:anyone "${mainToken}"`]) {
      const st = await mcp(D, "search_recipes", { query, response_format: "structured" });
      const hit = ((st.structured?.["results"] ?? []) as Json[]).find((r) => r["recipeId"] === mainDraft);
      expect(hit, query).toMatchObject({ draftState: "unverified", draftAbout: pat.email });
    }
    const md = await mcp(D, "search_recipes", { query: `author:me "${mainToken}"` });
    expect(md.text.split("\n").find((l) => l.includes(mainDraft))).toContain(`[unverified draft about ${pat.email}:`);
    const isDraft = await mcp(D, "search_recipes", { query: `is:draft "${mainToken}"` });
    expect(isDraft.raw).not.toContain(mainDraft);
    const filter = (await (await fetch(`${BASE}/check?${new URLSearchParams({ key: D, filter: `is:draft "${mainToken}"`, format: "json" }).toString()}`, { headers: { Accept: "application/json" } })).json()) as { data: { results: Json[] } };
    expect(JSON.stringify(filter.data.results)).not.toContain(mainDraft);
    const byId = await mcp(D, "get_recipes", { recipe_ids: mainDraft });
    expect(byId.text).toContain(`Draft: [unverified draft about ${pat.email}:`);
  });

  it("S4-V1: out-of-scope keys (P2, D2) and Sam find it uniformly absent; by id it is the random-id marker", async () => {
    for (const [who, key] of [["P2", P2], ["D2", D2], ["Sam", S]] as const) {
      const st = await mcp(key, "search_recipes", { query: `author:anyone "${MARKER}"`, response_format: "structured" });
      expect(st.raw, who).not.toContain(mainDraft);
      const a = await mcp(key, "get_recipes", { recipe_ids: mainDraft });
      const b = await mcp(key, "get_recipes", { recipe_ids: RANDOM_UUID });
      expect(norm(a.text, mainDraft), who).toBe(norm(b.text, RANDOM_UUID));
      const prefix = await mcp(key, "get_recipes", { recipe_ids: mainDraft.slice(0, 8) });
      expect(prefix.text, who).toContain("not_found_or_unreadable");
    }
  });

  it("S4-M3 / S4-L1: on the detail page the depositor sees the state and whom it is about; the subject sees who deposited it and may act", async () => {
    const d = dataOf((await detail(dana, mainDraft)).body);
    expect(d).toMatchObject({ draftState: "unverified", draftAbout: pat.email, draftDepositedBy: null, canDelete: true, canMove: false, canResolveDraft: false });
    const p = dataOf((await detail(pat, mainDraft)).body);
    expect(p).toMatchObject({ draftState: "unverified", draftDepositedBy: dana.email, draftAbout: null, canDelete: true, canMove: true, canResolveDraft: true });
    // The depositing key is Dana's, and Dana is the author while unpublished.
    expect(p["apiKeyLabel"]).toBe(`Dana key ${run}`);
  });

  it("S4-U2 / DT-OBO-03: Sam, Olive, and the system user get the random-id answer on every by-id route", async () => {
    for (const actor of [sam, olive, system]) {
      await sameAsRandom((id) => call(actor, "GET", `/traces/${id}`), mainDraft);
      await sameAsRandom((id) => call(actor, "PUT", `/traces/${id}/reaction`, { reaction: "still_true" }), mainDraft);
      await sameAsRandom((id) => call(actor, "POST", `/traces/${id}/not-chosen`), mainDraft);
      await sameAsRandom((id) => call(actor, "PATCH", `/traces/${id}`, { groupId: shared.id }), mainDraft);
      await sameAsRandom((id) => call(actor, "DELETE", `/traces/${id}`), mainDraft);
      const l = await link(actor, mainDraft);
      const r = await link(actor, RANDOM_UUID);
      expect(l.data.items).toEqual([]);
      expect(norm(l.text, mainDraft)).toBe(norm(r.text, RANDOM_UUID));
    }
    for (const key of [S, P2, D2]) {
      const a = await mcp(key, "verify_draft", { recipe_id: mainDraft, supporting_evidence: evidence("sam tries") });
      const b = await mcp(key, "verify_draft", { recipe_id: RANDOM_UUID, supporting_evidence: evidence("sam tries") });
      expect(norm(a.text, mainDraft)).toBe(norm(b.text, RANDOM_UUID));
    }
    expect((await row(mainDraft))?.["draft_state"]).toBe("unverified");
  });

  // ── The queue ────────────────────────────────────────────────────────────

  it("S4-Q1 / S4-Q2 / DT-OBO-06: Pat's queue lists it with who deposited it, and his figures agree", async () => {
    const q = await queue(pat);
    const item = q.items.find((i) => i.id === mainDraft);
    expect(item).toMatchObject({ state: "unverified", canResolve: true, depositedBy: dana.email, about: null, keyLabel: `Dana key ${run}` });
    expect(await queueCount(pat)).toBe(q.total);
    const briefing = await mcp(P, "get_briefing", {});
    const m = /Drafts: (\d+) unverified drafts? about your user/.exec(briefing.text);
    expect(Number(m?.[1])).toBe(q.total);
  });

  it("S4-Q3 / DT-OBO-07: Pat narrows his queue to one depositor with author:", async () => {
    const own = idOf(await deposit(P, recipe("pat own draft"), { draft: true }));
    const byDana = await queue(pat, `author:${dana.email}`);
    expect(byDana.items.map((i) => i.id)).toContain(mainDraft);
    expect(byDana.items.map((i) => i.id)).not.toContain(own);
    expect(byDana.items.every((i) => i.depositedBy === dana.email)).toBe(true);
  });

  it("S4-Q4 / DT-OBO-06: Dana's queue and count never include drafts she deposited about someone else", async () => {
    const q = await queue(dana);
    expect(q.items.map((i) => i.id)).not.toContain(mainDraft);
    expect(q.items.every((i) => i.about === null)).toBe(true);
    expect(await queueCount(dana)).toBe(q.total);
  });

  it("S4-Q5 / DT-OBO-11: Dana's link shows the draft with no actions and the reason naming who reviews it; Pat's shows the actions", async () => {
    const d = await link(dana, mainDraft);
    expect(d.data.items[0]).toMatchObject({ id: mainDraft, state: "unverified", canResolve: false, about: pat.email });
    expect(d.data.items[0]?.blockedReason).toContain(`Only ${pat.email} can review this draft`);
    expect(d.data.items[0]?.blockedReason).toContain(`/app/drafts?ids=${mainDraft}`);
    const p = await link(pat, mainDraft);
    expect(p.data.items[0]).toMatchObject({ canResolve: true, depositedBy: dana.email });
  });

  // ── The depositor's refusals ─────────────────────────────────────────────

  it("S4-R2 / DT-OBO-04: Dana's verify_draft, REST verify, resolving reactions, and not chosen are refused honestly; nothing changes", async () => {
    const tool = await mcp(D, "verify_draft", { recipe_id: mainDraft, supporting_evidence: evidence("dana verifies") });
    expect(tool.text).toContain(`Only ${pat.email} can review this draft`);
    expect(tool.text).toContain(`/app/drafts?ids=${mainDraft}`);
    const rest = await fetch(`${BASE}/recipes/${mainDraft}/verify`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${D}` },
      body: JSON.stringify({ supporting_evidence: evidence("dana verifies rest") }),
    });
    expect(rest.status).toBe(403);
    expect(((await rest.json()) as Json)["status"]).toBe("only_subject_reviews");
    for (const reaction of ["still_true", "wrong"]) {
      const r = await call(dana, "PUT", `/traces/${mainDraft}/reaction`, { reaction });
      expect(r.status, reaction).toBe(403);
      expect(((await r.json()) as Json)["error"]).toContain(`Only ${pat.email}`);
    }
    const nc = await call(dana, "POST", `/traces/${mainDraft}/not-chosen`);
    expect(nc.status).toBe(403);
    expect(await reactionRows(mainDraft, dana.userId)).toBe(0);
    expect(await row(mainDraft)).toMatchObject({ draft_state: "unverified", user_id: dana.userId, subject_user_id: pat.userId });
  });

  it("S4-L4: an identical repeat returns the existing draft, worded for its subject, whoever this repeat names", async () => {
    const text = recipe("repeat");
    const first = await deposit(D, text, { on_behalf_of: pat.email });
    for (const extra of [{}, { on_behalf_of: sam.email }, { on_behalf_of: pat.email }]) {
      const again = await deposit(D, text, extra);
      expect(idOf(again)).toBe(idOf(first));
      expect(again["existingRecipe"]).toBe(true);
      expect(String(again["draftNotice"])).toContain(`as a draft about ${pat.email}, and it is still a draft`);
      expect(String(again["draftNotice"])).not.toContain("verify_draft");
    }
    expect(await tracesWithText(text)).toBe(1);
  });

  // ── Delete and move ──────────────────────────────────────────────────────

  it("S4-D1 / DT-OBO-08: Dana deletes her unverified draft through the human route; it leaves Pat's queue and count at once", async () => {
    const id = await onBehalf("to withdraw");
    const before = await queueCount(pat);
    const del = await call(dana, "DELETE", `/traces/${id}`, { reason: "wrong person" });
    expect(del.status).toBe(200);
    expect(await row(id)).toBeUndefined();
    expect(await queueCount(pat)).toBe(before - 1);
    expect((await queue(pat)).items.map((i) => i.id)).not.toContain(id);
  });

  it("S4-D2: Dana may not move it (the random-id 404); Pat may, and it stays a draft about him that Dana still reads by id", async () => {
    const id = await onBehalf("to move");
    await sameAsRandom((x) => call(dana, "PATCH", `/traces/${x}`, { groupId: dana.personalBookId }), id);
    const moved = await call(pat, "PATCH", `/traces/${id}`, { groupId: pat.personalBookId });
    expect(moved.status).toBe(200);
    expect(await row(id)).toMatchObject({ group_id: pat.personalBookId, draft_state: "unverified", subject_user_id: pat.userId, user_id: dana.userId });
    expect(dataOf((await detail(dana, id)).body)).toMatchObject({ draftState: "unverified", draftAbout: pat.email });
  });

  // ── Verification and resolution ──────────────────────────────────────────

  let verifiedId = "";

  it("S4-R1 / S4-R3 / S4-R4 / DT-OBO-16: Pat's confirm makes him the author and clears the subject, in one audited statement naming Dana", async () => {
    verifiedId = await onBehalf("to verify by reaction");
    const r = await call(pat, "PUT", `/traces/${verifiedId}/reaction`, { reaction: "still_true" });
    expect(r.status).toBe(200);
    expect(await row(verifiedId)).toMatchObject({ user_id: pat.userId, subject_user_id: null, draft_state: "verified", resolved_by: pat.userId });
    const audit = await auditFor(verifiedId, "recipe.draft_verified");
    expect(audit.length).toBe(1);
    expect(audit[0]!["actor"]).toBe(pat.userId);
    expect(audit[0]!["metadata"]).toMatchObject({ via: "reaction", previousAuthorId: dana.userId });
    // The depositor stays recoverable from the audit trail alone (S4-S4).
    const deposited = await auditFor(verifiedId, "recipe.checked");
    expect(deposited[0]!["actor"]).toBe(dana.userId);
  });

  it("S4-R1 / S4-R4: Pat's agent verifies with verify_draft; the audit row names the previous author, and the depositing agent did not verify it", async () => {
    const id = await onBehalf("to verify by agent");
    const r = await mcp(P, "verify_draft", { recipe_id: id, supporting_evidence: evidence(`pat confirms ${id}`) });
    expect(r.text).toContain("is verified");
    expect(await row(id)).toMatchObject({ user_id: pat.userId, subject_user_id: null, draft_state: "verified" });
    const audit = await auditFor(id, "recipe.draft_verified");
    expect(audit[0]!["metadata"]).toMatchObject({ via: "agent", previousAuthorId: dana.userId, verifiedByDepositingKey: false });
  });

  it("S4-V2 / S4-L2 / DT-OBO-15: once verified it is Pat's ordinary recipe for everyone: author:, lists, no on-behalf label, no Dana key label", async () => {
    const samSees = await mcp(S, "search_recipes", { query: `author:${pat.email} "${MARKER}"`, response_format: "structured" });
    const hit = ((samSees.structured?.["results"] ?? []) as Json[]).find((r) => r["recipeId"] === verifiedId);
    expect(hit).toBeDefined();
    expect(hit?.["draftState"]).toBeUndefined();
    expect(hit?.["draftDepositedBy"]).toBeUndefined();
    const byDana = await mcp(S, "search_recipes", { query: `author:${dana.email} "${MARKER}"` });
    expect(byDana.raw).not.toContain(verifiedId);
    for (const actor of [sam, dana, pat]) {
      const d = dataOf((await detail(actor, verifiedId)).body);
      expect(d["userEmail"]).toBe(pat.email);
      expect(d["draftDepositedBy"]).toBeNull();
      expect(d["draftAbout"]).toBeNull();
      expect(d["apiKeyLabel"]).toBeNull();
      if (actor !== pat) expect(d["draftState"]).toBeNull();
    }
    const danaMine = await mcp(D, "search_recipes", { query: `author:me "${MARKER}"` });
    expect(danaMine.raw).not.toContain(verifiedId);
    const patList = (await (await call(pat, "GET", `/traces?limit=100`)).json()) as Json;
    expect(JSON.stringify(patList)).toContain(verifiedId);
  });

  it("[F93] / S4-L2: once verified, no list or detail surface shows Dana's key as the agent of Pat's recipe", async () => {
    type Row = { id: string; apiKeyLabel: string | null };
    const bookList = (await (await call(sam, "GET", `/traces?groupId=${shared.id}&limit=100`)).json()) as { data: Row[] };
    expect(bookList.data.find((r) => r.id === verifiedId)).toMatchObject({ apiKeyLabel: null });
    const patList = (await (await call(pat, "GET", "/traces?limit=100")).json()) as { data: Row[] };
    expect(patList.data.find((r) => r.id === verifiedId)).toMatchObject({ apiKeyLabel: null });
    for (const actor of [sam, dana, pat]) {
      expect(dataOf((await detail(actor, verifiedId)).body)["apiKeyIsAuthors"]).toBe(false);
    }
    // A recipe deposited by its own author's key keeps its label and badge.
    const danaOwn = bookList.data.find((r) => r.apiKeyLabel === `Dana key ${run}`);
    expect(danaOwn).toBeDefined();
    expect(dataOf((await detail(sam, danaOwn!.id)).body)).toMatchObject({ apiKeyIsAuthors: true, apiKeyLabel: `Dana key ${run}` });
  });

  it("S4-D4: after verification Dana gets what any member gets (403 on delete); Pat deletes it as its author", async () => {
    const id = await onBehalf("verify then delete");
    expect((await call(pat, "PUT", `/traces/${id}/reaction`, { reaction: "still_true" })).status).toBe(200);
    expect((await call(dana, "DELETE", `/traces/${id}`)).status).toBe(403);
    expect(dataOf((await detail(dana, id)).body)["canDelete"]).toBe(false);
    expect((await call(pat, "DELETE", `/traces/${id}`)).status).toBe(200);
  });

  it("S4-R3 / S4-V3 / S4-D4: a rejected or not-chosen draft stays Dana's; it leaves both result sets, stays readable by id to both, and either may delete it", async () => {
    const rejected = await onBehalf("to reject");
    const notChosen = await onBehalf("not chosen");
    expect((await call(pat, "PUT", `/traces/${rejected}/reaction`, { reaction: "wrong" })).status).toBe(200);
    expect((await call(pat, "POST", `/traces/${notChosen}/not-chosen`)).status).toBe(200);
    expect(await row(rejected)).toMatchObject({ user_id: dana.userId, subject_user_id: pat.userId, draft_state: "rejected", resolved_by: pat.userId });
    expect(await row(notChosen)).toMatchObject({ user_id: dana.userId, subject_user_id: pat.userId, draft_state: "not_chosen" });
    expect((await auditFor(rejected, "recipe.draft_rejected"))[0]!["metadata"]).not.toHaveProperty("previousAuthorId");
    for (const key of [P, D]) {
      const st = await mcp(key, "search_recipes", { query: `author:anyone "${MARKER}"` });
      expect(st.raw).not.toContain(rejected);
      expect(st.raw).not.toContain(notChosen);
    }
    expect((await mcp(D, "get_recipes", { recipe_ids: rejected })).text).toContain(`[rejected draft about ${pat.email}:`);
    expect((await mcp(P, "get_recipes", { recipe_ids: rejected })).text).toContain(`[rejected draft, deposited by ${dana.email}:`);
    const d = dataOf((await detail(dana, rejected)).body);
    expect(d).toMatchObject({ draftState: "rejected", draftResolvedAt: null, draftResolvedByEmail: null });
    await sameAsRandom((x) => call(sam, "GET", `/traces/${x}`), rejected);
    expect((await call(dana, "DELETE", `/traces/${rejected}`)).status).toBe(200);
    expect((await call(pat, "DELETE", `/traces/${notChosen}`)).status).toBe(200);
  });

  // ── Admin counts ─────────────────────────────────────────────────────────

  it("S4-C1: admin per-user counts follow the author: the depositor's until verification, the subject's after", async () => {
    async function counts(): Promise<{ pat: number; dana: number }> {
      const body = (await (await call(system, "GET", `/admin/users?q=${encodeURIComponent(run)}&limit=100`)).json()) as { data: { users: Array<{ email: string; recipeCount: number }> } };
      const of = (e: string): number => Number(body.data.users.find((u) => u.email === e)?.recipeCount ?? -1);
      return { pat: of(pat.email), dana: of(dana.email) };
    }
    const before = await counts();
    const id = await onBehalf("counted");
    const deposited = await counts();
    expect(deposited).toEqual({ pat: before.pat, dana: before.dana + 1 });
    expect((await call(pat, "PUT", `/traces/${id}/reaction`, { reaction: "still_true" })).status).toBe(200);
    expect(await counts()).toEqual({ pat: before.pat + 1, dana: before.dana });
  });

  // ── Export and import ────────────────────────────────────────────────────

  it("S4-E1 / DT-OBO-14: export follows the author: Dana's carries her unresolved drafts with the subject's email, Pat's the ones he verified", async () => {
    type ExportTrace = { id: string; draftState: string | null; onBehalfOf?: string | null };
    const exp = async (a: Actor): Promise<ExportTrace[]> => ((await (await call(a, "GET", "/auth/me/export")).json()) as { traces: ExportTrace[] }).traces;
    const danaTraces = await exp(dana);
    expect(danaTraces.find((t) => t.id === mainDraft)).toMatchObject({ draftState: "unverified", onBehalfOf: pat.email });
    expect(danaTraces.map((t) => t.id)).not.toContain(verifiedId);
    const patTraces = await exp(pat);
    expect(patTraces.find((t) => t.id === verifiedId)).toMatchObject({ draftState: "verified", onBehalfOf: null });
    expect(patTraces.map((t) => t.id)).not.toContain(mainDraft);
    const samTraces = await exp(sam);
    expect(samTraces.map((t) => t.id)).not.toContain(mainDraft);
    expect(samTraces.map((t) => t.id)).not.toContain(verifiedId);
  });

  it("S4-E2 / S4-E3 / DT-OBO-14: an imported row naming Pat becomes an unverified draft about him by the importer; unnameable rows are refused alike", async () => {
    const now = new Date().toISOString();
    const file = (id: string, text: string, onBehalfOf: string, draftState: string | null): Json => ({
      schemaVersion: 1,
      traces: [{ id, claimText: text, createdAt: now, draftState, onBehalfOf }],
      evidence: [], references: [], traceEvidence: [], traceReferences: [], evidenceReferences: [],
    });
    const importAs = (a: Actor, body: Json): Promise<Response> => fetch(`${BASE}/import?book=${shared.slug}`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.jwt}` }, body: JSON.stringify(body),
    });
    const okId = crypto.randomUUID();
    const ok = await importAs(dana, file(okId, recipe("imported"), pat.email, "verified"));
    expect(ok.status, await ok.clone().text()).toBe(200);
    // [F96] an on-behalf row lands under a fresh id, reported in idMap.
    const okMap = ((await ok.json()) as { data: { idMap: Array<{ entity: string; from: string; to: string }> } }).data.idMap;
    const newId = okMap.find((m) => m.entity === "trace" && m.from === okId)?.to ?? "";
    expect(await row(okId)).toBeUndefined();
    expect(await row(newId)).toMatchObject({ user_id: dana.userId, subject_user_id: pat.userId, draft_state: "unverified", resolved_by: null, key_owner: null });

    const answers: string[] = [];
    for (const who of [`nobody-${run}@test.local`, olive.email]) {
      const id = crypto.randomUUID();
      const text = recipe(`import refused ${who}`);
      const res = await importAs(dana, file(id, text, who, null));
      answers.push(`${res.status} ${await res.text()}`);
      expect(await row(id)).toBeUndefined();
    }
    expect(answers[0]).toMatch(/^400 /);
    expect(answers[0]).toBe(answers[1]);
  });

  it("[F92] import never changes a draft the importer deposited about someone else, even with the retired overwrite option; the subject confirms the text he reviewed", async () => {
    const id = await onBehalf("bait");
    const original = String((await sql`SELECT claim_text FROM claimnet.traces WHERE id = ${id}::uuid`)[0]?.["claim_text"]);
    const swapped = recipe("switched text the subject never saw");
    const res = await fetch(`${BASE}/import?book=${shared.slug}&overwrite=true`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${dana.jwt}` },
      body: JSON.stringify({
        schemaVersion: 1,
        traces: [{ id, claimText: swapped, createdAt: new Date().toISOString(), decidedAt: "2020-01-01" }],
        evidence: [], references: [], traceEvidence: [], traceReferences: [], evidenceReferences: [],
      }),
    });
    expect(res.status).toBe(200);
    // Import only creates rows: the draft is not the importer's to keep, so
    // the file's row lands under a fresh id as her own recipe.
    const body = (await res.json()) as { data: { counts: { traces: Record<string, number> }; idMap: Array<{ from: string; to: string }> } };
    expect(body.data.counts.traces).toMatchObject({ inserted: 1, conflicted: 0 });
    const fresh = body.data.idMap.find((m) => m.from === id)?.to;
    expect(fresh).toBeDefined();
    expect(fresh).not.toBe(id);
    expect(await row(fresh!)).toMatchObject({ user_id: dana.userId, subject_user_id: null });
    const after = await sql`SELECT claim_text, decided_at FROM claimnet.traces WHERE id = ${id}::uuid`;
    expect(after[0]?.["claim_text"]).toBe(original);
    expect(after[0]?.["decided_at"]).toBeNull();
    expect((await call(pat, "PUT", `/traces/${id}/reaction`, { reaction: "still_true" })).status).toBe(200);
    expect(String((await sql`SELECT claim_text FROM claimnet.traces WHERE id = ${id}::uuid`)[0]?.["claim_text"])).toBe(original);
  });

  async function importFile(a: Actor, body: Json, query = ""): Promise<{ status: number; body: Json }> {
    const res = await fetch(`${BASE}/import?book=${shared.slug}${query}`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.jwt}` },
      body: JSON.stringify({ schemaVersion: 1, evidence: [], references: [], traceEvidence: [], traceReferences: [], evidenceReferences: [], ...body }),
    });
    return { status: res.status, body: (await res.json()) as Json };
  }

  it("[F96] delete and re-import under the reviewed id: the on-behalf row gets a fresh id, so the subject's open review finds nothing to confirm", async () => {
    const id = await onBehalf("reviewed original");
    expect((await link(pat, id)).data.items[0]?.id).toBe(id);
    expect((await call(dana, "DELETE", `/traces/${id}`)).status).toBe(200);
    const swapped = recipe("swapped behind the reviewed id");
    const res = await importFile(dana, { traces: [{ id, claimText: swapped, createdAt: new Date().toISOString(), onBehalfOf: pat.email }] });
    expect(res.status).toBe(200);
    // Nothing lives under the id Pat reviewed; his confirm and his agent's verify find nothing.
    expect(await row(id)).toBeUndefined();
    expect((await call(pat, "PUT", `/traces/${id}/reaction`, { reaction: "still_true" })).status).toBe(404);
    const verify = await mcp(P, "verify_draft", { recipe_id: id, supporting_evidence: evidence(`pat confirms ${id}`) });
    expect(verify.text).toContain("not_found_or_unreadable");
    // The imported row is a new draft about Pat under a new id, reported in idMap.
    const idMap = (dataOf(res.body)["idMap"] as Array<{ entity: string; from: string; to: string }>) ?? [];
    const moved = idMap.find((m) => m.entity === "trace" && m.from === id);
    expect(moved?.to).toBeDefined();
    expect(moved?.to).not.toBe(id);
    expect(await row(moved!.to)).toMatchObject({ user_id: dana.userId, subject_user_id: pat.userId, draft_state: "unverified" });
  });

  it("[F97] import links never attach evidence or references to a draft the importer deposited about someone else", async () => {
    const id = await onBehalf("links target");
    const current = (await sql`SELECT claim_text, created_at FROM claimnet.traces WHERE id = ${id}::uuid`)[0]!;
    const counts = async (): Promise<[number, number]> => {
      const e = await sql`SELECT count(*)::int AS n FROM claimnet.trace_evidence WHERE trace_id = ${id}::uuid`;
      const r = await sql`SELECT count(*)::int AS n FROM claimnet.trace_references WHERE trace_id = ${id}::uuid`;
      return [Number(e[0]?.["n"]), Number(r[0]?.["n"])];
    };
    const before = await counts();
    const now = new Date().toISOString();
    const evidenceId = crypto.randomUUID();
    const referenceId = crypto.randomUUID();
    const res = await importFile(dana, {
      // The draft's own row, unchanged and without onBehalfOf: the importer's own existing row.
      traces: [{ id, claimText: String(current["claim_text"]), createdAt: new Date(String(current["created_at"])).toISOString() }],
      evidence: [{ id: evidenceId, content: "Pat said to delete the audit log", createdAt: now }],
      references: [{ id: referenceId, quote: "delete the audit log weekly", source: "fabricated", createdAt: now }],
      traceEvidence: [{ id: crypto.randomUUID(), traceId: id, evidenceId, stance: "for", createdAt: now }],
      traceReferences: [{ id: crypto.randomUUID(), traceId: id, referenceId, createdAt: now }],
    });
    expect(res.status).toBe(200);
    expect(await counts()).toEqual(before);

    // [F99] (the audit's probes 9e and 7g): a new quote onto the draft's
    // ORIGINAL evidence through evidence_references, link-only and with the
    // evidence listed unchanged in the file. It would publish under Pat's name.
    const ev = (await sql`SELECT e.id, e.content, e.created_at FROM claimnet.trace_evidence te JOIN claimnet.evidence e ON e.id = te.evidence_id WHERE te.trace_id = ${id}::uuid LIMIT 1`)[0]!;
    const evId = String(ev["id"]);
    const quotesOnDraftEvidence = async (): Promise<number> =>
      Number((await sql`SELECT count(*)::int AS n FROM claimnet.evidence_references WHERE evidence_id = ${evId}::uuid`)[0]?.["n"]);
    const quotesBefore = await quotesOnDraftEvidence();
    for (const listed of [false, true]) {
      const refId = crypto.randomUUID();
      const r = await importFile(dana, {
        traces: [],
        evidence: listed ? [{ id: evId, content: String(ev["content"]), createdAt: new Date(String(ev["created_at"])).toISOString() }] : [],
        references: [{ id: refId, quote: "Pat said delete the audit log", source: "fabricated", createdAt: now }],
        evidenceReferences: [{ id: crypto.randomUUID(), evidenceId: evId, referenceId: refId, createdAt: now }],
      });
      expect(r.status, `listed=${listed}`).toBe(200);
      expect(await quotesOnDraftEvidence(), `listed=${listed}`).toBe(quotesBefore);
    }
  });

  // ── Leaving the book (S4-A1, S4-A2) ──────────────────────────────────────

  it("S4-A1 / DT-OBO-12: Pat removed from the book: the draft stays; his queue drops it; his link shows it with the book as the reason; rejoining restores it", async () => {
    const id = await onBehalf("pat leaves");
    expect((await call(sam, "DELETE", `/recipe-books/${shared.id}/members/${pat.userId}`)).status).toBe(200);
    expect((await queue(pat)).items.map((i) => i.id)).not.toContain(id);
    const l = await link(pat, id);
    expect(l.data.items[0]).toMatchObject({ id, state: "unverified", canResolve: false });
    expect(l.data.items[0]?.blockedReason).toContain("write access");
    const r = await call(pat, "PUT", `/traces/${id}/reaction`, { reaction: "still_true" });
    expect(r.status).toBe(403);
    expect(dataOf((await detail(dana, id)).body)).toMatchObject({ draftState: "unverified", draftAbout: pat.email });
    await addMember(sam, shared.id, pat);
    expect((await queue(pat)).items.map((i) => i.id)).toContain(id);
    expect((await row(id))?.["draft_state"]).toBe("unverified");
  });

  it("S4-A2 / DT-OBO-12: Dana removed from the book: her agents lose it, she still reads and deletes it by hand, and Pat can still verify", async () => {
    const toVerify = await onBehalf("dana leaves verify");
    const toDelete = await onBehalf("dana leaves delete");
    expect((await call(sam, "DELETE", `/recipe-books/${shared.id}/members/${dana.userId}`)).status).toBe(200);
    const st = await mcp(D, "search_recipes", { query: `author:me "${MARKER}"` });
    expect(st.raw).not.toContain(toVerify);
    expect(dataOf((await detail(dana, toVerify)).body)).toMatchObject({ draftState: "unverified", draftAbout: pat.email });
    expect((await call(dana, "DELETE", `/traces/${toDelete}`)).status).toBe(200);
    expect((await call(pat, "PUT", `/traces/${toVerify}/reaction`, { reaction: "still_true" })).status).toBe(200);
    expect(await row(toVerify)).toMatchObject({ user_id: pat.userId, subject_user_id: null, draft_state: "verified" });
    await addMember(sam, shared.id, dana);
  });

  // ── Account deletion (S4-A3 to S4-A5; the cascade of recipe 23657e4e) ─────

  describe("account deletion", () => {
    let quinn: Actor; // subject
    let dex: Actor; // depositor
    let owen: Actor; // owns a book in his own organization
    let Q = "";
    let X = "";
    const own = { id: "", slug: "" };

    async function deleteAccount(a: Actor): Promise<void> {
      const res = await call(a, "DELETE", "/auth/me", { password: PASSWORD });
      if (res.status !== 200) throw new Error(`delete failed: ${res.status} ${await res.text()}`);
    }

    beforeAll(async () => {
      [quinn, dex, owen] = await Promise.all([register("quinn"), register("dex"), register("owen")]);
      for (const m of [quinn, dex]) await addMember(sam, shared.id, m);
      Q = await mintKey(quinn, [shared.id], shared.id);
      X = await mintKey(dex, [shared.id], shared.id);
      const created = await call(owen, "POST", "/recipe-books", { name: `Owen ${run}`, slug: `owen-${run}`, organizationId: owen.orgId });
      Object.assign(own, { id: ((await created.json()) as { data?: { id: string } }).data?.id ?? "", slug: `owen-${run}` });
      for (const m of [quinn, dex]) await addMember(owen, own.id, m);
    }, 120_000);

    it("[F94] the subject deletes their account: their own book, holding only drafts about them, is deleted with them, not re-homed", async () => {
      const [vic, wes] = await Promise.all([register("vic"), register("wes")]);
      const slug = `vic-${run}`;
      const created = await call(vic, "POST", "/recipe-books", { name: `Vic private ${run}`, slug, organizationId: vic.orgId });
      const bookId = ((await created.json()) as { data?: { id: string } }).data?.id ?? "";
      await addMember(vic, bookId, wes);
      const W = await mintKey(wes, [bookId], bookId);
      const draft = idOf(await deposit(W, recipe("about vic"), { on_behalf_of: vic.email }));
      expect((await call(vic, "DELETE", `/recipe-books/${bookId}/members/${wes.userId}`)).status).toBe(200);
      await deleteAccount(vic);
      expect(await row(draft)).toBeUndefined();
      const book = await sql`SELECT count(*)::int AS n FROM claimnet.groups WHERE id = ${bookId}::uuid`;
      expect(Number(book[0]?.["n"])).toBe(0);
      const rehomed = await sql`SELECT count(*)::int AS n FROM claimnet.audit_log WHERE action = 'recipe_book.left_without_members' AND target_id = ${bookId}::uuid`;
      expect(Number(rehomed[0]?.["n"])).toBe(0);
    });

    it("S4-A5 / DT-OBO-17: the owner deletes their account; a book holding only another person's on-behalf drafts stays, memberless, in the depositor's organization; nobody is added", async () => {
      const XO = await mintKey(dex, [own.id], own.id);
      const d1 = idOf(await deposit(XO, recipe("owen book draft"), { on_behalf_of: quinn.email }));
      for (const m of [quinn, dex]) expect((await call(owen, "DELETE", `/recipe-books/${own.id}/members/${m.userId}`)).status).toBe(200);
      const membersBefore = await sql`SELECT count(*)::int AS n FROM claimnet.group_members WHERE group_id = ${own.id}::uuid`;
      expect(Number(membersBefore[0]?.["n"])).toBe(1);
      await deleteAccount(owen);
      const book = await sql`SELECT g.organization_id::text AS org FROM claimnet.groups g WHERE g.id = ${own.id}::uuid`;
      expect(book[0]?.["org"]).toBe(dex.orgId);
      const members = await sql`SELECT count(*)::int AS n FROM claimnet.group_members WHERE group_id = ${own.id}::uuid`;
      expect(Number(members[0]?.["n"])).toBe(0);
      const audit = await sql`SELECT count(*)::int AS n FROM claimnet.audit_log WHERE action = 'recipe_book.left_without_members' AND target_id = ${own.id}::uuid`;
      expect(Number(audit[0]?.["n"])).toBe(1);
      expect(await row(d1)).toMatchObject({ user_id: dex.userId, subject_user_id: quinn.userId, draft_state: "unverified" });
      expect(dataOf((await detail(dex, d1)).body)).toMatchObject({ draftState: "unverified", draftAbout: quinn.email, canDelete: true });
      expect(dataOf((await detail(quinn, d1)).body)).toMatchObject({ draftState: "unverified", canResolveDraft: false });
    });

    it("S4-A3 / DT-OBO-13: the subject deletes their account: what they authored and the unverified drafts about them go; rejected ones stay the depositor's; a new account with the email inherits nothing", async () => {
      const verified = idOf(await deposit(X, recipe("quinn verifies"), { on_behalf_of: quinn.email }));
      const unverified = idOf(await deposit(X, recipe("quinn never sees"), { on_behalf_of: quinn.email }));
      const rejected = idOf(await deposit(X, recipe("quinn rejects"), { on_behalf_of: quinn.email }));
      expect((await call(quinn, "PUT", `/traces/${verified}/reaction`, { reaction: "still_true" })).status).toBe(200);
      expect((await call(quinn, "PUT", `/traces/${rejected}/reaction`, { reaction: "wrong" })).status).toBe(200);
      void Q;
      await deleteAccount(quinn);
      expect(await row(verified)).toBeUndefined();
      expect(await row(unverified)).toBeUndefined();
      const es = await sql`SELECT count(*)::int AS n FROM claimnet.embedding_sources WHERE source_id = ${unverified}::uuid`;
      expect(Number(es[0]?.["n"])).toBe(0);
      expect(await row(rejected)).toMatchObject({ user_id: dex.userId, draft_state: "rejected" });
      expect(dataOf((await detail(dex, rejected)).body)).toMatchObject({ draftState: "rejected" });

      // A new account with Quinn's email sees nothing of the old one's.
      const reg = await fetch(`${BASE}/auth/register`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: quinn.email, password: PASSWORD, tosAccepted: true }),
      });
      const vtok = ((await reg.json()) as { data?: { verificationToken?: string } }).data?.verificationToken;
      await fetch(`${BASE}/auth/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: vtok }) });
      const again = { jwt: await login(quinn.email, PASSWORD) };
      expect((await queue(again)).items).toEqual([]);
      expect((await detail(again, rejected)).status).toBe(404);
    });

    it("S4-A4 / DT-OBO-13: the depositor deletes their account: their unresolved deposits go, the subject's verified ones stay, and the audit rows keep the depositor", async () => {
      const pVerified = idOf(await deposit(X, recipe("pat verifies dex"), { on_behalf_of: pat.email }));
      const pUnverified = idOf(await deposit(X, recipe("dex unverified"), { on_behalf_of: pat.email }));
      const pRejected = idOf(await deposit(X, recipe("dex rejected"), { on_behalf_of: pat.email }));
      expect((await call(pat, "PUT", `/traces/${pVerified}/reaction`, { reaction: "still_true" })).status).toBe(200);
      expect((await call(pat, "PUT", `/traces/${pRejected}/reaction`, { reaction: "wrong" })).status).toBe(200);
      const countBefore = await queueCount(pat);
      await deleteAccount(dex);
      expect(await row(pUnverified)).toBeUndefined();
      expect(await row(pRejected)).toBeUndefined();
      expect(await row(pVerified)).toMatchObject({ user_id: pat.userId, draft_state: "verified" });
      expect(await queueCount(pat)).toBe(countBefore - 1);
      const deposited = await auditFor(pVerified, "recipe.checked");
      expect(deposited[0]!["actor"]).toBe(dex.userId);
      expect((await auditFor(pVerified, "recipe.draft_verified"))[0]!["metadata"]).toMatchObject({ previousAuthorId: dex.userId });
    });
  });
});

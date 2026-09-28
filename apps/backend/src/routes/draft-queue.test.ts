import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import postgres from "postgres";
import { compareForTriage } from "@soupnet/domain";
import { getDb } from "../db";
import { authenticateKey } from "../authz";
import { searchWithoutLogging } from "../services/trace.service";
import { seedVerifiedUser } from "../test-users";

/**
 * Layer 3: the review queue (drafts-and-triage slice 3).
 *
 * Each test names its rubric criterion (docs/planning/drafts-and-triage-build.md
 * §Slice 3 rubric) and scenario (docs/product-specs/drafts-and-triage.feature).
 *
 * Cast: Pat (the person), Sam (owns the shared book), Mo (a member of the
 * shared book with no drafts, the AG3 control), Olive (an outsider), and the
 * system user. Pat belongs to the shared book (daily reads on), a quiet book
 * (daily reads off), and his personal book, and deposits with two keys.
 *
 * Requires a running backend (BACKEND_URL) and database; skipped otherwise.
 * Direct SQL only reads state back.
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const FRONTEND = process.env["FRONTEND_URL"] ?? "http://localhost:5273";
const ACCEPT_BOTH = "application/json, text/event-stream";
const PASSWORD = "draft-queue-test-pw";
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const MARKER = `queuemarker${run}`;
const RANDOM_UUID = "5d6c1e0a-8b7f-4c2d-9e3a-1f0b2c4d6e8a";

function canConnect(): boolean {
  return !!(process.env["DATABASE_URL"] || process.env["PGHOST"]);
}

interface Actor { email: string; jwt: string; userId: string; personalBookId: string; orgId: string }

interface QueueItem {
  id: string;
  recipe: string;
  recipeBook: { id: string; name: string; slug: string };
  impact: string | null;
  uncertainty: string | null;
  depositedAt: string;
  keyLabel: string | null;
  firstInterpretation: string | null;
  state: string;
  canResolve: boolean;
  blockedReason?: string;
}
interface QueueData { mode: string; items: QueueItem[]; total: number; page: number; perPage: number; totalPages: number; order: string }
interface LinkData { mode: string; items: QueueItem[]; notShown: number; truncated: boolean }

let n = 0;
function recipe(topic: string, extra = ""): string {
  n += 1;
  return `As a backend maintainer working on the review queue (${topic} ${run}-${n}${extra}), I prefer drafts reviewed in one place so that nothing waits unseen.`;
}
function evidence(interpretation: string, quote: string): string {
  return `${interpretation}\n> "${quote}"\n-- draft-queue.test.ts, ${run}`;
}

describe.skipIf(!BASE || !canConnect())("the review queue (drafts-and-triage slice 3)", () => {
  let sql: ReturnType<typeof postgres>;
  let pat: Actor;
  let sam: Actor;
  let mo: Actor;
  let olive: Actor;
  let system: { jwt: string };
  const shared = { id: "", slug: "" };
  const quiet = { id: "", slug: "" };
  let patKeyA = ""; // [shared, quiet, personal]
  let patKeyB = ""; // [shared, quiet]
  let samKey = ""; // [shared, personal], default personal
  let samSharedKey = ""; // [shared] only (AG3)
  let moSharedKey = ""; // [shared] only (AG3)

  // Pat's drafts for the listing tests.
  const listed: Record<string, string> = {};
  let samDraft = "";
  let patPublished = "";

  // ── helpers ───────────────────────────────────────────────────────────────

  function call(actor: { jwt: string }, method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${actor.jwt}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  async function registerAndVerify(label: string): Promise<Actor> {
    const email = `test-queue-${label}-${run}@test.local`;
    const jwt = ((await (await seedVerifiedUser(email, PASSWORD)).json()) as { data?: { token?: string } }).data?.token ?? "";
    const me = (await (await call({ jwt }, "GET", "/auth/me")).json()) as { data?: { id?: string; user?: { id: string } } };
    const books = ((await (await call({ jwt }, "GET", "/recipe-books")).json()) as { data: Array<{ id: string; organization_id: string }> }).data;
    return { email, jwt, userId: me.data?.user?.id ?? me.data?.id ?? "", personalBookId: books[0]?.id ?? "", orgId: books[0]?.organization_id ?? "" };
  }

  async function login(email: string, password: string): Promise<string> {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    return ((await res.json()) as { data?: { token?: string } }).data?.token ?? "";
  }

  async function mintKey(actor: Actor, read: string[], write: string[], def: string, label?: string): Promise<string> {
    const res = await call(actor, "POST", "/keys/scoped", {
      readRecipeBookIds: read,
      writeRecipeBookIds: write,
      defaultWriteRecipeBookId: def,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      ...(label ? { label } : {}),
    });
    const key = ((await res.json()) as { data?: { key?: string } }).data?.key ?? "";
    if (!key) throw new Error(`key mint failed: ${res.status}`);
    return key;
  }

  async function newBook(owner: Actor, name: string, members: Actor[]): Promise<{ id: string; slug: string }> {
    const slug = `${name}-${run}`;
    const created = await call(owner, "POST", "/recipe-books", { name: `${name} ${run}`, slug, organizationId: owner.orgId });
    const id = ((await created.json()) as { data?: { id: string } }).data?.id ?? "";
    if (!id) throw new Error("book create failed");
    for (const m of members) {
      const added = await call(owner, "POST", `/recipe-books/${id}/members`, { email: m.email, role: "member" });
      if (added.status !== 201) throw new Error(`add member failed: ${added.status}`);
    }
    return { id, slug };
  }

  async function mcp(key: string, name: string, args: Record<string, unknown>): Promise<{ text: string; structured: Record<string, unknown> | undefined }> {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: ACCEPT_BOTH, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const raw = await res.text();
    const line = raw.split(/\r?\n/).find((l) => l.startsWith("data: "));
    const msg = JSON.parse(line ? line.slice(6) : raw) as { result?: { structuredContent?: Record<string, unknown>; content?: Array<{ text?: string }> } };
    return { text: msg.result?.content?.map((c) => c.text ?? "").join("\n") ?? "", structured: msg.result?.structuredContent };
  }

  async function deposit(key: string, text: string, extra: Record<string, unknown> = {}, why = "Could not ask: the person is away."): Promise<Record<string, unknown>> {
    const { structured } = await mcp(key, "check_recipe", {
      recipe: text, supporting_evidence: evidence(why, `quote ${text.slice(-24)}`), response_format: "structured", ...extra,
    });
    if (!structured) throw new Error("deposit failed");
    return structured;
  }
  const checkedId = (s: Record<string, unknown>): string => ((s["checked"] as { recipeId?: string } | undefined)?.recipeId ?? "");
  async function draft(key: string, topic: string, extra: Record<string, unknown> = {}, why?: string): Promise<string> {
    return checkedId(await deposit(key, recipe(topic, ` ${MARKER}`), { draft: true, ...extra }, why));
  }

  async function queue(actor: { jwt: string }, params: Record<string, string> = {}): Promise<{ status: number; body: { ok: boolean; data?: QueueData; error?: string } }> {
    const qs = new URLSearchParams(params).toString();
    const res = await call(actor, "GET", `/traces/drafts${qs ? `?${qs}` : ""}`);
    return { status: res.status, body: (await res.json()) as { ok: boolean; data?: QueueData; error?: string } };
  }
  async function allQueue(actor: { jwt: string }, q?: string): Promise<QueueItem[]> {
    const out: QueueItem[] = [];
    for (let page = 1; page < 50; page++) {
      const r = await queue(actor, { ...(q ? { q } : {}), page: String(page) });
      out.push(...(r.body.data?.items ?? []));
      if (page >= (r.body.data?.totalPages ?? 0)) break;
    }
    return out;
  }
  async function link(actor: { jwt: string }, ids: string): Promise<{ status: number; text: string; data: LinkData }> {
    const res = await call(actor, "GET", `/traces/drafts?ids=${encodeURIComponent(ids)}`);
    const text = await res.text();
    return { status: res.status, text, data: (JSON.parse(text) as { data: LinkData }).data };
  }

  /** /check?filter= as a flat list: an explicit cluster count above the page size
   *  leaves every recipe in its own cluster (JSON mode ignores expand). */
  async function flatSearch(key: string, filter: string, page = 1): Promise<Array<{ recipeId: string; similarity?: number; impact?: unknown; uncertainty?: unknown }>> {
    const qs = new URLSearchParams({ key, format: "json", filter, clusters: "100", page: String(page) });
    const body = (await (await fetch(`${BASE}/check?${qs.toString()}`, { headers: { Accept: "application/json" } })).json()) as { ok: boolean; data?: { results?: Array<{ recipeId: string; similarity?: number }> }; error?: string };
    if (!body.ok) throw new Error(`search failed: ${body.error}`);
    return body.data?.results ?? [];
  }

  async function state(id: string): Promise<string | null> {
    const rows = await sql`SELECT draft_state FROM claimnet.traces WHERE id = ${id}::uuid`;
    return (rows[0]?.["draft_state"] as string | null) ?? null;
  }
  async function reactionRows(id: string): Promise<number> {
    const rows = await sql`SELECT count(*)::int AS n FROM claimnet.trace_reactions WHERE trace_id = ${id}::uuid`;
    return Number(rows[0]?.["n"] ?? 0);
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
    [pat, sam, mo, olive] = await Promise.all([
      registerAndVerify("pat"), registerAndVerify("sam"), registerAndVerify("mo"), registerAndVerify("olive"),
    ]);
    system = { jwt: await login(process.env["DEV_USERNAME"] ?? "", process.env["DEV_PASSWORD"] ?? "") };
    Object.assign(shared, await newBook(sam, "queue-shared", [pat, mo]));
    Object.assign(quiet, await newBook(sam, "queue-quiet", [pat]));
    // The quiet book is outside Pat's daily reads (S3-Q1: the queue ignores that).
    expect((await call(pat, "PUT", `/recipe-books/${quiet.id}/daily-prefs`, { dailyRead: false, dailyWrite: false })).status).toBe(200);

    patKeyA = await mintKey(pat, [shared.id, quiet.id, pat.personalBookId], [shared.id, quiet.id, pat.personalBookId], shared.id, `queue key A ${run}`);
    patKeyB = await mintKey(pat, [shared.id, quiet.id], [shared.id, quiet.id], quiet.id, `queue key B ${run}`);
    samKey = await mintKey(sam, [shared.id, sam.personalBookId], [shared.id, sam.personalBookId], sam.personalBookId);
    samSharedKey = await mintKey(sam, [shared.id], [shared.id], shared.id);
    moSharedKey = await mintKey(mo, [shared.id], [shared.id], shared.id);

    listed["shared"] = await draft(patKeyA, "shared book draft", { impact: "high", uncertainty: "low" },
      "Could not ask: Pat is offline until Monday. Settled by: which cache strategy he prefers.");
    listed["quiet"] = await draft(patKeyB, "quiet book draft", { recipe_book: quiet.slug });
    listed["personal"] = await draft(patKeyA, "personal book draft", { recipe_book: pat.personalBookId });
    samDraft = await draft(samKey, "sam's own draft", { recipe_book: shared.slug });
    patPublished = checkedId(await deposit(patKeyA, recipe("pat published")));
  }, 180_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 2 });
  });

  // ── What the queue shows, and to whom ────────────────────────────────────

  it("S3-Q1 / DT-QUE-01: every unresolved draft about Pat, from both keys and all three books (daily reads off included)", async () => {
    const items = await allQueue(pat);
    const ids = items.map((i) => i.id);
    for (const key of ["shared", "quiet", "personal"]) expect(ids, key).toContain(listed[key]);
    expect(ids).not.toContain(samDraft);
    expect(ids).not.toContain(patPublished);
  });

  it("S3-Q4 / DT-QUE-05: each item carries the text, book, ratings, deposit time, key label, and first interpretation", async () => {
    const item = (await allQueue(pat)).find((i) => i.id === listed["shared"])!;
    expect(item.recipe).toContain("shared book draft");
    expect(item.recipeBook).toEqual({ id: shared.id, name: `queue-shared ${run}`, slug: shared.slug });
    expect([item.impact, item.uncertainty]).toEqual(["high", "low"]);
    expect(Number.isNaN(Date.parse(item.depositedAt))).toBe(false);
    expect(item.keyLabel).toBe(`queue key A ${run}`);
    expect(item.firstInterpretation).toContain("Could not ask: Pat is offline until Monday.");
    expect(item.state).toBe("unverified");
    expect(item.canResolve).toBe(true);
    const unrated = (await allQueue(pat)).find((i) => i.id === listed["quiet"])!;
    expect([unrated.impact, unrated.uncertainty]).toEqual([null, null]);
    expect(unrated.keyLabel).toBe(`queue key B ${run}`);
  });

  it("S3-Q2 / DT-QUE-01: nothing else: Sam's queue has only Sam's draft; resolved drafts and a left book's draft are gone", async () => {
    const samIds = (await allQueue(sam)).map((i) => i.id);
    expect(samIds).toContain(samDraft);
    for (const id of Object.values(listed)) expect(samIds).not.toContain(id);

    const verified = await draft(patKeyA, "to verify");
    const rejected = await draft(patKeyA, "to reject");
    const notChosen = await draft(patKeyA, "to not choose");
    await call(pat, "PUT", `/traces/${verified}/reaction`, { reaction: "still_true" });
    await call(pat, "PUT", `/traces/${rejected}/reaction`, { reaction: "wrong" });
    await call(pat, "POST", `/traces/${notChosen}/not-chosen`);
    const left = await newBook(sam, "queue-left", [pat]);
    const leftKey = await mintKey(pat, [left.id], [left.id], left.id);
    const leftDraft = await draft(leftKey, "draft in a book Pat leaves");
    expect((await allQueue(pat)).map((i) => i.id)).toContain(leftDraft);
    expect((await call(sam, "DELETE", `/recipe-books/${left.id}/members/${pat.userId}`)).status).toBe(200);

    const ids = (await allQueue(pat)).map((i) => i.id);
    for (const id of [verified, rejected, notChosen, leftDraft, samDraft, patPublished]) expect(ids).not.toContain(id);
  });

  it("S3-Q3: one figure: the queue's total, the dashboard count, and the briefing's Drafts line for a key over the same books", async () => {
    const total = (await queue(pat)).body.data!.total;
    const count = ((await (await call(pat, "GET", "/traces/drafts/count")).json()) as { data: { count: number } }).data.count;
    expect(count).toBe(total);
    const books = ((await (await call(pat, "GET", "/recipe-books")).json()) as { data: Array<{ id: string }> }).data.map((b) => b.id);
    const allKey = await mintKey(pat, books, books, books[0]!);
    const briefing = await mcp(allKey, "list_my_recipe_books", {});
    const figures = [...briefing.text.matchAll(/Drafts: (\d+) unverified draft/g)].map((m) => Number(m[1]));
    expect(figures.reduce((a, b) => a + b, 0)).toBe(total);
  });

  it("S3-Q5: a full list: 45 near-identical drafts page with an honest total, each exactly once", async () => {
    const quinn = await registerAndVerify("quinn");
    const key = await mintKey(quinn, [quinn.personalBookId], [quinn.personalBookId], quinn.personalBookId);
    const made: string[] = [];
    for (let i = 0; i < 45; i++) {
      made.push(checkedId(await deposit(key, `As a backend maintainer working on paging ${run}, I prefer page ${i} of the same thought so that folding would hide it.`, { draft: true })));
    }
    const first = await queue(quinn);
    expect(first.body.data!.total).toBe(45);
    expect(first.body.data!.perPage).toBe(20);
    expect(first.body.data!.totalPages).toBe(3);
    const all = await allQueue(quinn);
    expect(all).toHaveLength(45);
    expect(new Set(all.map((i) => i.id))).toEqual(new Set(made));
  }, 180_000);

  it("S3-Q7: a person with no drafts gets an empty list and a zero count", async () => {
    const r = await queue(olive);
    expect(r.body.data!.items).toEqual([]);
    expect(r.body.data!.total).toBe(0);
    expect(((await (await call(olive, "GET", "/traces/drafts/count")).json()) as { data: { count: number } }).data.count).toBe(0);
  });

  // ── Ordering ───────────────────────────────────────────────────────────────

  it("S3-O1 / DT-QUE-02: the listed order is the domain comparator's over all 16 rating combinations, and the feature file's cast", async () => {
    const ola = await registerAndVerify("ola");
    const key = await mintKey(ola, [ola.personalBookId], [ola.personalBookId], ola.personalBookId);
    const values = [undefined, "low", "medium", "high"] as const;
    for (const impact of values) {
      for (const uncertainty of values) {
        await deposit(key, recipe(`order ${impact ?? "unrated"} ${uncertainty ?? "unrated"}`), {
          draft: true, ...(impact ? { impact } : {}), ...(uncertainty ? { uncertainty } : {}),
        });
      }
    }
    const listedIds = (await allQueue(ola)).map((i) => i.id);
    const rows = await sql`SELECT id::text AS id, impact, uncertainty, created_at FROM claimnet.traces WHERE user_id = ${ola.userId}::uuid AND draft_state = 'unverified'`;
    const expected = (rows as unknown as Array<{ id: string; impact: string | null; uncertainty: string | null; created_at: Date }>)
      .map((r) => ({ id: r.id, impact: r.impact, uncertainty: r.uncertainty, createdAt: r.created_at }))
      .sort(compareForTriage)
      .map((r) => r.id);
    expect(listedIds).toEqual(expected);

    // The feature file's cast, deposited in the browser run's order.
    const cast = await registerAndVerify("cast");
    const ck = await mintKey(cast, [cast.personalBookId], [cast.personalBookId], cast.personalBookId);
    const lowHigh = checkedId(await deposit(ck, recipe("cast low high"), { draft: true, impact: "low", uncertainty: "high" }));
    const highLow = checkedId(await deposit(ck, recipe("cast high low"), { draft: true, impact: "high", uncertainty: "low" }));
    const unrated = checkedId(await deposit(ck, recipe("cast unrated"), { draft: true }));
    const highHigh = checkedId(await deposit(ck, recipe("cast high high"), { draft: true, impact: "high", uncertainty: "high" }));
    const r = await queue(cast);
    expect(r.body.data!.order).toBe("triage");
    expect(r.body.data!.items.map((i) => i.id)).toEqual([highHigh, unrated, highLow, lowHigh]);
  }, 120_000);

  // ── The page's search box ─────────────────────────────────────────────────

  it("S3-Q6 / DT-QUE-03: the box takes the grammar with is:draft always applied; errors are the parser's", async () => {
    const high = (await allQueue(pat, "impact:high")).map((i) => i.id);
    expect(high).toContain(listed["shared"]);
    expect(high).not.toContain(listed["quiet"]); // unrated never matches a positive rating
    const lowU = (await allQueue(pat, "uncertainty:low")).map((i) => i.id);
    expect(lowU).toContain(listed["shared"]);
    // author:me alone still lists drafts, never Pat's published recipes.
    const me = (await allQueue(pat, "author:me")).map((i) => i.id);
    expect(me).toContain(listed["quiet"]);
    expect(me).not.toContain(patPublished);

    const bad = await queue(pat, { q: "impact:urgent" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/low, medium, or high/);
    const neg = await queue(pat, { q: "-is:draft" });
    expect(neg.status).toBe(400);
    expect(neg.body.error).toMatch(/is:draft/);
  });

  it("S3-O2: with semantic text the order is the search pipeline's, over drafts only", async () => {
    const r = await queue(pat, { q: `review queue ${MARKER}` });
    expect(r.status).toBe(200);
    expect(r.body.data!.order).toBe("similarity");
    const ids = r.body.data!.items.map((i) => i.id);
    for (const id of ids) expect(await state(id)).toBe("unverified");
    expect(ids).not.toContain(patPublished);
    // The same query through Pat's agent (a key over the same books) ranks them identically.
    const books = ((await (await call(pat, "GET", "/recipe-books")).json()) as { data: Array<{ id: string }> }).data.map((b) => b.id);
    const allKey = await mintKey(pat, books, books, books[0]!);
    const agent = await mcp(allKey, "search_recipes", { query: `is:draft review queue ${MARKER}`, response_format: "structured", verbosity: "high" });
    const agentIds = ((agent.structured?.["results"] ?? []) as Array<{ recipeId: string }>).map((x) => x.recipeId);
    expect(new Set(ids)).toEqual(new Set(agentIds.slice(0, ids.length)));
  });

  // ── Actions ────────────────────────────────────────────────────────────────

  it("S3-A1 / DT-QUE-06: confirm verifies (reaction row), reject rejects (reaction row), not chosen writes no reaction and an audit row", async () => {
    const a = await draft(patKeyA, "action confirm");
    const b = await draft(patKeyA, "action reject");
    const c = await draft(patKeyA, "action not chosen");
    expect((await call(pat, "PUT", `/traces/${a}/reaction`, { reaction: "still_true" })).status).toBe(200);
    expect((await call(pat, "PUT", `/traces/${b}/reaction`, { reaction: "wrong" })).status).toBe(200);
    const nc = await call(pat, "POST", `/traces/${c}/not-chosen`);
    expect(nc.status).toBe(200);
    expect(((await nc.json()) as { data: { draftState: string } }).data.draftState).toBe("not_chosen");
    expect([await state(a), await state(b), await state(c)]).toEqual(["verified", "rejected", "not_chosen"]);
    expect([await reactionRows(a), await reactionRows(b), await reactionRows(c)]).toEqual([1, 1, 0]);
    const resolver = await sql`SELECT draft_resolved_by_user_id::text AS u, draft_resolved_by_key_id AS k, draft_resolved_at FROM claimnet.traces WHERE id = ${c}::uuid`;
    expect(resolver[0]?.["u"]).toBe(pat.userId);
    expect(resolver[0]?.["k"]).toBeNull();
    expect(resolver[0]?.["draft_resolved_at"]).not.toBeNull();
    const audit = await sql`SELECT action, metadata FROM claimnet.audit_log WHERE target_id = ${c} ORDER BY occurred_at DESC LIMIT 1`;
    expect(audit[0]?.["action"]).toBe("recipe.draft_not_chosen");
    expect((audit[0]?.["metadata"] as { via?: string }).via).toBe("queue");
    // The items leave the queue.
    const ids = (await allQueue(pat)).map((i) => i.id);
    for (const id of [a, b, c]) expect(ids).not.toContain(id);
  });

  it("S3-A2: repeating an action is a no-op reported as already resolved", async () => {
    const d = await draft(patKeyA, "repeat");
    await call(pat, "PUT", `/traces/${d}/reaction`, { reaction: "wrong" });
    const again = await call(pat, "PUT", `/traces/${d}/reaction`, { reaction: "still_true" });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { data: { alreadyResolved?: boolean; draftState?: string } }).data).toMatchObject({ alreadyResolved: true, draftState: "rejected" });
    const nc = await call(pat, "POST", `/traces/${d}/not-chosen`);
    expect(nc.status).toBe(409);
    expect(((await nc.json()) as { status: string }).status).toBe("already_resolved");
    expect(await state(d)).toBe("rejected");
  });

  it("S3-A2 / S3-A4: a role change between listing and acting: Pat is removed, and each action is refused honestly, naming the book; nothing changes", async () => {
    const book = await newBook(sam, "queue-removal", [pat]);
    const key = await mintKey(pat, [book.id], [book.id], book.id);
    const d = await draft(key, "removed between listing and acting");
    expect((await allQueue(pat)).map((i) => i.id)).toContain(d);
    expect((await call(sam, "DELETE", `/recipe-books/${book.id}/members/${pat.userId}`)).status).toBe(200);

    for (const [method, path, body] of [
      ["PUT", `/traces/${d}/reaction`, { reaction: "still_true" }],
      ["PUT", `/traces/${d}/reaction`, { reaction: "wrong" }],
      ["POST", `/traces/${d}/not-chosen`, undefined],
    ] as const) {
      const res = await call(pat, method, path, body);
      expect(res.status, path).toBe(403);
      const j = (await res.json()) as { status: string; error: string };
      expect(j.status).toBe("needs_write_access");
      expect(j.error).toContain("needs write access to this recipe book");
      expect(j.error).toContain(`queue-removal ${run}`);
    }
    expect(await state(d)).toBe("unverified");
    expect(await reactionRows(d)).toBe(0);

    // Through the link Pat still sees it, with the actions unavailable and the reason.
    const l = await link(pat, d);
    expect(l.data.items).toHaveLength(1);
    expect(l.data.items[0]!.canResolve).toBe(false);
    expect(l.data.items[0]!.blockedReason).toContain(`queue-removal ${run}`);
  });

  it("S3-A3 / DT-VER-07: not chosen answers everyone but the subject exactly as a random UUID, and writes nothing", async () => {
    const d = await draft(patKeyA, "uniform not chosen");
    const norm = (t: string, id: string) => t.split(id).join("<ID>");
    for (const actor of [sam, mo, olive, system]) {
      const real = await call(actor, "POST", `/traces/${d}/not-chosen`);
      const random = await call(actor, "POST", `/traces/${RANDOM_UUID}/not-chosen`);
      expect(real.status).toBe(404);
      expect(random.status).toBe(404);
      expect(norm(await real.text(), d)).toBe(norm(await random.text(), RANDOM_UUID));
    }
    const malformed = await call(sam, "POST", "/traces/not-a-uuid/not-chosen");
    expect(malformed.status).toBe(404);
    expect(await state(d)).toBe("unverified");
    // The existing reaction route stays uniform for them too (slice 2, unchanged).
    for (const actor of [sam, olive, system]) {
      const real = await call(actor, "PUT", `/traces/${d}/reaction`, { reaction: "still_true" });
      const random = await call(actor, "PUT", `/traces/${RANDOM_UUID}/reaction`, { reaction: "still_true" });
      expect(real.status).toBe(404);
      expect(await real.text()).toBe(await random.text());
    }
    expect(await state(d)).toBe("unverified");
  });

  it("not chosen on a published recipe the viewer can read is \"not a draft\" (409)", async () => {
    const res = await call(sam, "POST", `/traces/${patPublished}/not-chosen`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { status: string }).status).toBe("not_a_draft");
  });

  it("S3-A5 / DT-VER-01: a confirmed draft then appears in Sam's agent's search results", async () => {
    const text = recipe("confirmed then shared", ` ${MARKER}`);
    const d = checkedId(await deposit(patKeyA, text, { draft: true }));
    const unique = `confirmed then shared ${run}`;
    const before = await mcp(samKey, "search_recipes", { query: `"${unique}" author:anyone`, response_format: "structured" });
    expect(JSON.stringify(before.structured)).not.toContain(d);
    await call(pat, "PUT", `/traces/${d}/reaction`, { reaction: "still_true" });
    const after = await mcp(samKey, "search_recipes", { query: `"${unique}" author:anyone`, response_format: "structured" });
    expect(JSON.stringify(after.structured)).toContain(d);
  });

  it("S3-A6: a not-chosen draft stays hidden from Sam, leaves Pat's own results, and is readable by id with its label", async () => {
    const text = recipe("not chosen visibility", ` ${MARKER}`);
    const d = checkedId(await deposit(patKeyA, text, { draft: true }));
    await call(pat, "POST", `/traces/${d}/not-chosen`);
    expect((await mcp(samKey, "get_recipes", { recipe_ids: d })).text).toContain("not_found_or_unreadable");
    const own = await mcp(patKeyA, "search_recipes", { query: `"not chosen visibility ${run}" author:me`, response_format: "structured" });
    expect(JSON.stringify(own.structured)).not.toContain(d);
    expect((await mcp(patKeyA, "get_recipes", { recipe_ids: d })).text).toContain("[draft not chosen]");
    expect((await call(sam, "GET", `/traces/${d}`)).status).toBe(404);
  });

  it("S3-A7: no agent gains a new tool or parameter", async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: ACCEPT_BOTH, Authorization: `Bearer ${patKeyA}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    const raw = await res.text();
    const line = raw.split(/\r?\n/).find((l) => l.startsWith("data: "));
    const tools = (JSON.parse(line ? line.slice(6) : raw) as { result: { tools: Array<{ name: string; inputSchema: { properties: Record<string, unknown> } }> } }).result.tools;
    expect(tools.map((t) => t.name).sort()).toEqual([
      "check_recipe", "get_briefing", "get_recipes", "list_my_recipe_books", "log_feedback", "search_recipes",
      "update_recipe_book_description", "verify_draft",
    ]);
    expect(Object.keys(tools.find((t) => t.name === "search_recipes")!.inputSchema.properties).sort()).toEqual(
      ["agent_id", "feedback", "intent", "known_recipes", "query", "read_recipe_books", "response_format", "session_id", "verbosity"],
    );
  });

  // ── The id-list link ───────────────────────────────────────────────────────

  it("S3-L1 / DT-QUE-04: the named recipes Pat may read, in the given order, deduplicated; prefixes resolve", async () => {
    const [a, b] = [listed["shared"]!, listed["quiet"]!];
    const l = await link(pat, `${b},${a},${a},${b.toUpperCase()}`);
    expect(l.data.items.map((i) => i.id)).toEqual([b, a]);
    expect(l.data.notShown).toBe(0);
    const p = await link(pat, a.slice(0, 8));
    expect(p.data.items.map((i) => i.id)).toEqual([a]);
    // A prefix and its full id name one recipe: shown once, and nothing counted as not shown (fix pass, S3-L1).
    const both = await link(pat, `${a},${a.slice(0, 10)}`);
    expect(both.data.items.map((i) => i.id)).toEqual([a]);
    expect(both.data.notShown).toBe(0);
  });

  it("S3-L2 / DT-QUE-04: Sam's draft id and a random UUID produce the same response; malformed ids are omitted with the same note", async () => {
    const [a, b] = [listed["shared"]!, listed["quiet"]!];
    const withSam = await link(pat, `${b},${a},${samDraft}`);
    const withRandom = await link(pat, `${b},${a},${RANDOM_UUID}`);
    expect(withSam.status).toBe(200);
    expect(withSam.text.split(samDraft).join("<ID>")).toBe(withRandom.text.split(RANDOM_UUID).join("<ID>"));
    expect(withSam.text).not.toContain(samDraft);
    expect(withSam.data.items.map((i) => i.id)).toEqual([b, a]);
    expect(withSam.data.notShown).toBe(1);
    const withPrefix = await link(pat, `${b},${a},${samDraft.slice(0, 8)}`);
    const withRandomPrefix = await link(pat, `${b},${a},${RANDOM_UUID.slice(0, 8)}`);
    expect(withPrefix.text.split(samDraft.slice(0, 8)).join("<P>")).toBe(withRandomPrefix.text.split(RANDOM_UUID.slice(0, 8)).join("<P>"));
    const malformed = await link(pat, `${b},${a},not-an-id`);
    expect(malformed.data.notShown).toBe(1);
    expect(malformed.data.items.map((i) => i.id)).toEqual([b, a]);
    // Olive (outsider) sees none of Pat's ids.
    const outsider = await link(olive, `${a},${b}`);
    expect(outsider.data.items).toEqual([]);
    expect(outsider.data.notShown).toBe(2);
  });

  it("S3-L3: a named recipe that is not an unresolved draft is shown with its state and no actions", async () => {
    const v = await draft(patKeyA, "link verified");
    const r = await draft(patKeyA, "link rejected");
    const c = await draft(patKeyA, "link not chosen");
    await call(pat, "PUT", `/traces/${v}/reaction`, { reaction: "still_true" });
    await call(pat, "PUT", `/traces/${r}/reaction`, { reaction: "wrong" });
    await call(pat, "POST", `/traces/${c}/not-chosen`);
    const l = await link(pat, `${v},${r},${c},${patPublished}`);
    expect(l.data.items.map((i) => [i.id, i.state, i.canResolve])).toEqual([
      [v, "verified", false], [r, "rejected", false], [c, "not_chosen", false], [patPublished, "published", false],
    ]);
    // The subject sees that it was verified (E10); a collaborator's link shows an ordinary recipe ([F83]).
    const samView = await link(sam, v);
    expect(samView.data.items.map((i) => [i.id, i.state])).toEqual([[v, "published"]]);
  });

  it("S3-L4: more than 20 ids: the first 20 are resolved and the response says the link was cut", async () => {
    const ids: string[] = Array.from({ length: 25 }, () => crypto.randomUUID());
    ids[0] = listed["shared"]!;
    ids[22] = listed["quiet"]!;
    const l = await link(pat, ids.join(","));
    expect(l.data.truncated).toBe(true);
    expect(l.data.items.map((i) => i.id)).toEqual([listed["shared"]]);
    expect(l.data.notShown).toBe(19);
  });

  /** Import rows at chosen ids (import keeps an unused id as given, accepted F81). */
  async function plant(actor: Actor, bookId: string, ids: string[], label: string): Promise<void> {
    const file = {
      schemaVersion: 1,
      traces: ids.map((id, i) => ({ id, claimText: recipe(`${label} ${i}`), createdAt: new Date().toISOString() })),
      evidence: [], references: [], traceEvidence: [], traceReferences: [], evidenceReferences: [],
    };
    const res = await fetch(`${BASE}/import?book=${bookId}`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${actor.jwt}` }, body: JSON.stringify(file),
    });
    if (res.status !== 200) throw new Error(`import failed: ${res.status} ${await res.text()}`);
  }
  const inRange = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;

  it("[F85] a crowded prefix range: unreadable rows never decide the answer, and the person's own prefix still resolves", async () => {
    const mal = await registerAndVerify("mal");
    // Pat's own draft, crowded from below by 60 rows he cannot read.
    const d = await draft(patKeyA, "crowded own prefix");
    const p = d.slice(0, 8);
    await plant(mal, mal.personalBookId, Array.from({ length: 60 }, (_, i) => inRange(p, i + 1)), "crowd own");
    const own = await link(pat, p);
    expect(own.data.items.map((i) => i.id)).toEqual([d]);
    expect(own.data.notShown).toBe(0);

    // Sam's answer for a range must not depend on a hidden draft of Pat's in it.
    const hidden = await draft(patKeyA, "hidden draft in a probed range", { recipe_book: shared.slug });
    const q = hidden.slice(0, 8);
    const samRow = `${q}-ffff-4fff-bfff-ffffffffffff`;
    await plant(mal, mal.personalBookId, Array.from({ length: 49 }, (_, i) => inRange(q, i + 1)), "crowd probe");
    await plant(sam, sam.personalBookId, [samRow], "sam probe row");
    const withDraft = await link(sam, q);
    expect(withDraft.data.items.map((i) => i.id)).toEqual([samRow]);
    expect((await call(pat, "DELETE", `/traces/${hidden}`)).status).toBe(200);
    const withoutDraft = await link(sam, q);
    expect(withoutDraft.text).toBe(withDraft.text);
  }, 120_000);

  it("the queue's page number is clamped: out-of-range pages answer an empty page, never a server error", async () => {
    for (const page of ["1e308", "99999999999999999999", "9007199254740993"]) {
      const r = await queue(pat, { page });
      expect(r.status, page).toBe(200);
      expect(r.body.data!.items, page).toEqual([]);
      expect(r.body.data!.total, page).toBeGreaterThan(0);
      const sem = await queue(pat, { page, q: "review queue" });
      expect(sem.status, `${page} semantic`).toBe(200);
    }
  });

  it("S3-L6: the draft deposit notice gives the queue link, on MCP and /check, for a new draft and an identical repeat", async () => {
    const text = recipe("notice link", ` ${MARKER}`);
    const first = await deposit(patKeyA, text, { draft: true });
    const id = checkedId(first);
    const url = `${FRONTEND}/app/drafts?ids=${id}`;
    expect(String(first["draftNotice"])).toContain(url);
    const qs = new URLSearchParams({ key: patKeyA, format: "json", trace: text, evidence: evidence("Repeat.", "again"), draft: "true" });
    const again = (await (await fetch(`${BASE}/check?${qs.toString()}`, { headers: { Accept: "application/json" } })).json()) as { data: { draftNotice?: string; existingRecipe?: boolean } };
    expect(again.data.existingRecipe).toBe(true);
    expect(again.data.draftNotice).toContain(url);
    const md = await mcp(patKeyA, "check_recipe", { recipe: text, supporting_evidence: evidence("Repeat.", "again md") });
    expect(md.text).toContain(url);
  });

  // ── Agent side ─────────────────────────────────────────────────────────────

  it("S3-G1 / S3-G3 / S3-AG1: Pat's is:draft on search_recipes returns exactly his unresolved drafts in the key's scope, lifting exclude-own", async () => {
    const r = await mcp(patKeyB, "search_recipes", { query: "is:draft", response_format: "structured", verbosity: "high" });
    const results = (r.structured?.["results"] ?? []) as Array<{ recipeId: string; draftState?: string }>;
    const ids = results.map((x) => x.recipeId);
    const rows = await sql`SELECT id::text AS id FROM claimnet.traces WHERE user_id = ${pat.userId}::uuid AND draft_state = 'unverified' AND group_id IN (${shared.id}::uuid, ${quiet.id}::uuid)`;
    expect(new Set(ids)).toEqual(new Set((rows as unknown as Array<{ id: string }>).map((x) => x.id)));
    for (const x of results) expect(x.draftState).toBe("unverified");
    expect(ids).not.toContain(listed["personal"]); // outside this key's scope
    // Without is:draft or author:, search keeps excluding Pat's own recipes.
    const plain = await mcp(patKeyB, "search_recipes", { query: `"${MARKER}"`, response_format: "structured" });
    for (const x of (plain.structured?.["results"] ?? []) as Array<{ recipeId: string }>) {
      expect(Object.values(listed)).not.toContain(x.recipeId);
    }
  });

  it("S3-G1 / S3-AG1: /check?filter=is:draft (JSON and HTML) lists them too", async () => {
    const ids = (await flatSearch(patKeyB, "is:draft")).map((x) => x.recipeId);
    expect(ids).toContain(listed["shared"]);
    expect(ids).toContain(listed["quiet"]);
    expect(ids).not.toContain(samDraft);
    const html = await (await fetch(`${BASE}/check?${new URLSearchParams({ key: patKeyB, filter: "is:draft", expand: "true" }).toString()}`)).text();
    // The HTML page shows recipe text, not ids.
    expect(html).toContain("shared book draft");
    expect(html).toContain("quiet book draft");
    expect(html).not.toContain("sam&#39;s own draft");
    expect(html).toContain("impact high, uncertainty low");
  });

  it("S3-G3 / S3-AG1: the stdio surface (its exclude-own default on /check) also lists Pat's drafts under is:draft", async () => {
    const qs = new URLSearchParams({ key: patKeyB, format: "json", filter: "is:draft", clusters: "100" });
    const stdio = (await (await fetch(`${BASE}/check?${qs.toString()}`, { headers: { Accept: "application/json", "X-SoupNet-Surface": "mcp-stdio" } })).json()) as { data: { results: Array<{ recipeId: string }> } };
    const ids = stdio.data.results.map((x) => x.recipeId);
    expect(ids).toContain(listed["shared"]);
    expect(ids).toContain(listed["quiet"]);
    // Without is:draft the same surface still excludes Pat's own recipes.
    const plain = new URLSearchParams({ key: patKeyB, format: "json", filter: `"${MARKER}"`, clusters: "100" });
    const noDraft = (await (await fetch(`${BASE}/check?${plain.toString()}`, { headers: { Accept: "application/json", "X-SoupNet-Surface": "mcp-stdio" } })).json()) as { data: { results: Array<{ recipeId: string }> } };
    for (const x of noDraft.data.results) expect(Object.values(listed)).not.toContain(x.recipeId);
  });

  it("S3-G2: -is:draft leaves out Pat's unresolved drafts; for a viewer with none it changes nothing", async () => {
    const withMe = await mcp(patKeyB, "search_recipes", { query: `"${MARKER}" author:me`, response_format: "structured", verbosity: "high" });
    const without = await mcp(patKeyB, "search_recipes", { query: `"${MARKER}" author:me -is:draft`, response_format: "structured", verbosity: "high" });
    const a = ((withMe.structured?.["results"] ?? []) as Array<{ recipeId: string }>).map((x) => x.recipeId);
    const b = ((without.structured?.["results"] ?? []) as Array<{ recipeId: string }>).map((x) => x.recipeId);
    expect(a).toContain(listed["shared"]);
    expect(b).not.toContain(listed["shared"]);
    const moPlain = await mcp(moSharedKey, "search_recipes", { query: `"${MARKER}" author:anyone`, response_format: "structured" });
    const moNeg = await mcp(moSharedKey, "search_recipes", { query: `"${MARKER}" author:anyone -is:draft`, response_format: "structured" });
    expect(moNeg.structured?.["results"]).toEqual(moPlain.structured?.["results"]);
  });

  it("S3-G4: impact:/uncertainty: match stored ratings on any readable recipe; unrated never matches; negation keeps unrated", async () => {
    const tag = `ratingfixture${run}`;
    const values = [undefined, "low", "medium", "high"] as const;
    const made: Array<{ id: string; impact?: string; uncertainty?: string }> = [];
    for (const impact of values) {
      for (const uncertainty of values) {
        const s = await deposit(samKey, recipe(`rating ${impact ?? "u"} ${uncertainty ?? "u"}`, ` ${tag}`), {
          recipe_book: shared.slug, ...(impact ? { impact } : {}), ...(uncertainty ? { uncertainty } : {}),
        });
        made.push({ id: checkedId(s), ...(impact ? { impact } : {}), ...(uncertainty ? { uncertainty } : {}) });
      }
    }
    const find = async (q: string) => (await flatSearch(moSharedKey, `"${tag}" ${q}`)).map((x) => x.recipeId);
    const expectSet = (pred: (m: (typeof made)[number]) => boolean) => new Set(made.filter(pred).map((m) => m.id));
    expect(new Set(await find("impact:high"))).toEqual(expectSet((m) => m.impact === "high"));
    expect(new Set(await find("uncertainty:low"))).toEqual(expectSet((m) => m.uncertainty === "low"));
    expect(new Set(await find("impact:medium uncertainty:medium"))).toEqual(expectSet((m) => m.impact === "medium" && m.uncertainty === "medium"));
    expect(new Set(await find("-impact:low"))).toEqual(expectSet((m) => m.impact !== "low"));
    expect(new Set(await find("-impact:low -impact:medium -uncertainty:high"))).toEqual(expectSet((m) => m.impact !== "low" && m.impact !== "medium" && m.uncertainty !== "high"));
    // The same selections on MCP search_recipes.
    const viaMcp = await mcp(moSharedKey, "search_recipes", { query: `"${tag}" author:anyone impact:high`, response_format: "structured", verbosity: "high" });
    expect(((viaMcp.structured?.["results"] ?? []) as Array<{ recipeId: string }>).length).toBeGreaterThan(0);
    // Published rows never carry ratings on the wire (S3-AG2).
    for (const x of [...(viaMcp.structured?.["results"] as Array<Record<string, unknown>>), ...(await flatSearch(moSharedKey, `"${tag}" impact:high`))]) {
      expect(x).not.toHaveProperty("impact");
      expect(x).not.toHaveProperty("uncertainty");
    }
    // An unknown value is an error naming the vocabulary.
    expect((await mcp(moSharedKey, "search_recipes", { query: "impact:urgent" })).text).toMatch(/low, medium, or high/);
  }, 120_000);

  it("S3-G6: is:draft impact:high after:… \"…\" applies all four", async () => {
    const r = await mcp(patKeyA, "search_recipes", { query: `is:draft impact:high after:2026-01-01 "${MARKER}"`, response_format: "structured", verbosity: "high" });
    const ids = ((r.structured?.["results"] ?? []) as Array<{ recipeId: string }>).map((x) => x.recipeId);
    expect(ids).toContain(listed["shared"]);
    expect(ids).not.toContain(listed["personal"]); // unrated
    const future = await mcp(patKeyA, "search_recipes", { query: `is:draft impact:high after:2999-01-01 "${MARKER}"`, response_format: "structured" });
    expect((future.structured?.["results"] as unknown[]).length).toBe(0);
  });

  it("S3-G7: with semantic text a rating qualifier only removes rows: the matching subsequence, same order and similarities", async () => {
    // The pipeline's own order, before any display collapse: the search
    // service called directly with no size lever (the flat list every
    // surface starts from), on Mo's key over the shared book.
    const principal = await authenticateKey(getDb(), moSharedKey);
    if (!principal) throw new Error("key did not authenticate");
    const q = `review queue drafts reviewed in one place ratingfixture${run}`;
    const flat = async (filter: string) => {
      const out: Array<{ id: string; sim: number | undefined }> = [];
      for (let page = 1; page <= 20; page++) {
        const r = await searchWithoutLogging({ principal, filter, page, perPage: 50 });
        out.push(...r.results.map((x) => ({ id: x.id, sim: x.semanticScore })));
        if (page >= r.totalPages) break;
      }
      return out;
    };
    const all = await flat(q);
    const high = await flat(`${q} impact:high`);
    expect(high.length).toBeGreaterThan(0);
    const highIds = new Set(high.map((x) => x.id));
    expect(high).toEqual(all.filter((x) => highIds.has(x.id)));
    const rows = await sql`SELECT id::text AS id FROM claimnet.traces WHERE id = ANY(${high.map((x) => x.id)}::uuid[]) AND impact IS DISTINCT FROM 'high'`;
    expect(rows).toHaveLength(0);
  });

  it("S3-AG2: an own-draft row carries impact and uncertainty (null when unrated) in JSON and structured; the markdown label names them only when set", async () => {
    const r = await mcp(patKeyB, "search_recipes", { query: "is:draft", response_format: "structured", verbosity: "high" });
    const rows = r.structured?.["results"] as Array<{ recipeId: string; impact?: string | null; uncertainty?: string | null }>;
    const rated = rows.find((x) => x.recipeId === listed["shared"])!;
    const unrated = rows.find((x) => x.recipeId === listed["quiet"])!;
    expect([rated.impact, rated.uncertainty]).toEqual(["high", "low"]);
    expect(unrated).toHaveProperty("impact", null);
    expect(unrated).toHaveProperty("uncertainty", null);
    const md = (await mcp(patKeyB, "search_recipes", { query: "is:draft", verbosity: "high" })).text;
    const ratedLine = md.split("\n").find((l) => l.includes(listed["shared"]!))!;
    const unratedLine = md.split("\n").find((l) => l.includes(listed["quiet"]!))!;
    expect(ratedLine).toContain("; impact high, uncertainty low]");
    expect(unratedLine).toContain("visible only to them and their agents]");
    expect(unratedLine).not.toContain("impact");
  });

  it("S3-AG3: a collaborator's is:draft search is identical to that of a member with no drafts (MCP both formats, /check JSON and HTML)", async () => {
    // Mo plays the rubric's collaborator here (the fixture's Sam owns a draft
    // of his own, which his is:draft rightly lists): Mo and Sid share Pat's
    // book, neither has a draft, and Pat has several there.
    const sid = await registerAndVerify("sid");
    expect((await call(sam, "POST", `/recipe-books/${shared.id}/members`, { email: sid.email, role: "member" })).status).toBe(201);
    const sidKey = await mintKey(sid, [shared.id], [shared.id], shared.id);
    const volatile = (t: string) => t
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<UUID>")
      .replace(/"serverTiming":"[^"]*"/g, "")
      .replace(/int_[A-Za-z0-9]+/g, "<INT>");
    const one = async (key: string) => {
      const raw = {
        md: (await mcp(key, "search_recipes", { query: "is:draft" })).text,
        st: JSON.stringify((await mcp(key, "search_recipes", { query: "is:draft", response_format: "structured" })).structured),
        json: await (await fetch(`${BASE}/check?${new URLSearchParams({ key, format: "json", filter: "is:draft" }).toString()}`, { headers: { Accept: "application/json" } })).text(),
        html: (await (await fetch(`${BASE}/check?${new URLSearchParams({ key, filter: "is:draft" }).toString()}`)).text()).split(key).join("<KEY>"),
      };
      return { raw, md: volatile(raw.md), st: volatile(raw.st), json: volatile(raw.json), html: volatile(raw.html) };
    };
    const moView = await one(moSharedKey);
    const sidView = await one(sidKey);
    expect(moView.md).toBe(sidView.md);
    expect(moView.st).toBe(sidView.st);
    expect(moView.json).toBe(sidView.json);
    expect(moView.html).toBe(sidView.html);
    expect(moView.raw.json).toContain("\"totalResults\":0");
    for (const view of [moView, await one(samSharedKey)]) {
      const all = Object.values(view.raw).join(" ");
      for (const id of Object.values(listed)) {
        expect(all).not.toContain(id);
        expect(all).not.toContain(id.slice(0, 8));
      }
    }
  });

  it("S3-AG3 (as amended): a member with no drafts sees the same is:draft answer before and after Pat's drafts land in the book", async () => {
    const book = await newBook(sam, "queue-ag3", [pat, mo]);
    const moKey = await mintKey(mo, [book.id], [book.id], book.id);
    const patKey = await mintKey(pat, [book.id], [book.id], book.id);
    await deposit(patKey, recipe("ag3 published"));
    const volatile = (t: string) => t
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<UUID>")
      .replace(/"serverTiming":"[^"]*"/g, "")
      .replace(/int_[A-Za-z0-9]+/g, "<INT>");
    const view = async () => [
      (await mcp(moKey, "search_recipes", { query: "is:draft" })).text,
      JSON.stringify((await mcp(moKey, "search_recipes", { query: "is:draft", response_format: "structured" })).structured),
      await (await fetch(`${BASE}/check?${new URLSearchParams({ key: moKey, format: "json", filter: "is:draft" }).toString()}`, { headers: { Accept: "application/json" } })).text(),
      (await (await fetch(`${BASE}/check?${new URLSearchParams({ key: moKey, filter: "is:draft" }).toString()}`)).text()).split(moKey).join("<KEY>"),
    ].map(volatile);
    const before = await view();
    const drafts = [await draft(patKey, "ag3 draft one"), await draft(patKey, "ag3 draft two", { impact: "high" })];
    const after = await view();
    expect(after).toEqual(before);
    for (const id of drafts) expect(after.join(" ")).not.toContain(id.slice(0, 8));
  });
});

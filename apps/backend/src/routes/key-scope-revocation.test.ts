import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import postgres from "postgres";

/**
 * A key's scope follows its owner's CURRENT memberships and account state, on
 * every agent surface — requires running backend + postgres.
 *
 * The rule (docs/engineering-principles.md §7): what a key may touch is what
 * it was granted, intersected with the books its owner belongs to now. So
 * removing a member takes their existing keys and OAuth connections out of the
 * book on the next request, re-adding them puts it back, and nothing sweeps
 * keys. The same one authentication path refuses a credential whose owner
 * fails the user-state predicate, including at the OAuth token endpoint.
 *
 * Regression tests for F67 / F50 (membership) and F66 (OAuth issuance).
 * The module-level behavior is in authz/key-auth.test.ts; these go through the
 * real surfaces.
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const uid = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const PASSWORD = "key-scope-revocation-pw";
const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
const ACCEPT_BOTH = "application/json, text/event-stream";
const MARKER = `revocationmarker${uid.replace(/-/g, "")}`;
/** Appears only in the text of the owner's recipe in the shared book. */
const OWNER_WORD = `ownersrecipe${uid.replace(/-/g, "")}`;

function canConnect(): boolean {
  return !!(process.env["DATABASE_URL"] || process.env["PGHOST"]);
}

function sha256hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface Actor {
  email: string;
  jwt: string;
  userId: string;
  personalBookId: string;
  orgId: string;
}

interface OAuthClient {
  client_id: string;
  client_secret: string;
}

interface TokenBody {
  access_token?: string;
  refresh_token?: string;
  error?: string;
}

describe.skipIf(!canConnect() || !BASE)("key scope follows live membership and account state", () => {
  let sql: ReturnType<typeof postgres>;
  let owner: Actor;
  let member: Actor;
  let shared: { id: string; slug: string };
  let client: OAuthClient;
  let ownerRecipeId = ""; // the owner's recipe in the shared book
  let memberKey = ""; // member's scoped key: [shared, personal], default = shared

  function call(actor: { jwt: string }, method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${actor.jwt}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  async function registerAndVerify(label: string): Promise<Actor> {
    const email = `test-revoke-${label}-${uid}@test.local`;
    const reg = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, tosAccepted: true }),
    });
    const vtok = ((await reg.json()) as { data?: { verificationToken?: string } }).data?.verificationToken;
    if (!vtok) throw new Error(`Setup failed for ${email}`);
    await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: vtok }),
    });
    const login = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    const loginBody = (await login.json()) as { data?: { token?: string; user?: { id: string } } };
    const jwt = loginBody.data?.token ?? "";
    const userId = loginBody.data?.user?.id ?? "";
    if (!jwt || !userId) throw new Error(`Login failed for ${email}`);
    const books = ((await (await call({ jwt }, "GET", "/recipe-books")).json()) as {
      data: Array<{ id: string; organization_id: string }>;
    }).data;
    const personalBookId = books[0]?.id ?? "";
    const orgId = books[0]?.organization_id ?? "";
    if (!personalBookId || !orgId) throw new Error(`Missing personal book for ${email}`);
    return { email, jwt, userId, personalBookId, orgId };
  }

  async function mintScopedKey(actor: Actor, bookIds: string[], defaultBookId: string): Promise<string> {
    const res = await call(actor, "POST", "/keys/scoped", {
      readRecipeBookIds: bookIds,
      writeRecipeBookIds: bookIds,
      defaultWriteRecipeBookId: defaultBookId,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const key = ((await res.json()) as { data?: { key?: string } }).data?.key ?? "";
    if (!key) throw new Error(`Failed to mint scoped key for ${actor.email}: ${res.status}`);
    return key;
  }

  async function addMember(): Promise<void> {
    const res = await call(owner, "POST", `/recipe-books/${shared.id}/members`, { email: member.email, role: "member" });
    if (res.status !== 201) throw new Error(`Failed to add member: ${res.status}`);
  }

  async function removeMember(): Promise<void> {
    const res = await call(owner, "DELETE", `/recipe-books/${shared.id}/members/${member.userId}`);
    if (res.status !== 200) throw new Error(`Failed to remove member: ${res.status}`);
  }

  async function setVerified(userId: string, verified: boolean): Promise<void> {
    if (verified) await sql`UPDATE claimnet.users SET email_verified_at = NOW() WHERE id = ${userId}::uuid`;
    else await sql`UPDATE claimnet.users SET email_verified_at = NULL WHERE id = ${userId}::uuid`;
  }

  async function check(key: string, extra: Record<string, string>): Promise<{ status: number; text: string; error?: string | undefined }> {
    const res = await fetch(`${BASE}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ key, format: "json", ...extra }).toString(),
    });
    const text = await res.text();
    let error: string | undefined;
    try {
      error = (JSON.parse(text) as { error?: string }).error;
    } catch { /* not JSON */ }
    return { status: res.status, text, error };
  }

  const recipe = (tag: string) => ({
    trace: `As a membership test author working on ${MARKER} ${tag}, I prefer key scope that follows live membership so that removing someone takes effect on their existing keys.`,
    ef: `Seed evidence.\n> "${MARKER}"\n-- this test`,
  });

  async function mcpTool(key: string, name: string, args: Record<string, unknown>): Promise<{ status: number; text: string }> {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: ACCEPT_BOTH, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    return { status: res.status, text: await res.text() };
  }

  /**
   * Whether the owner's recipe (or, for the book list, the shared book) shows
   * up on each read surface, REST and MCP. Each surface is probed for a string
   * it does NOT echo back from the request: searches echo their query, so they
   * are probed for the recipe id; by-id lookups echo the id, so they are
   * probed for a word that appears only in the recipe's text.
   */
  async function visibleOn(key: string): Promise<Record<string, boolean>> {
    const bearer = { Authorization: `Bearer ${key}` };
    const query = `"${OWNER_WORD}" author:anyone`;
    const has = (text: string, needle: string) => text.includes(needle);
    return {
      "read-only search": has(
        await (await fetch(`${BASE}/check?key=${encodeURIComponent(key)}&f=${encodeURIComponent(query)}&format=json`)).text(),
        ownerRecipeId,
      ),
      "GET /recipes": has(await (await fetch(`${BASE}/recipes?ids=${ownerRecipeId}`, { headers: bearer })).text(), OWNER_WORD),
      "GET /briefing (requested recipe)": has(
        await (await fetch(`${BASE}/briefing?recipe_ids=${ownerRecipeId}`, { headers: bearer })).text(),
        OWNER_WORD,
      ),
      "GET /briefing (book list)": has(await (await fetch(`${BASE}/briefing`, { headers: bearer })).text(), shared.slug),
      "MCP search_recipes": has((await mcpTool(key, "search_recipes", { query })).text, ownerRecipeId),
      "MCP get_recipes": has((await mcpTool(key, "get_recipes", { recipe_ids: ownerRecipeId })).text, OWNER_WORD),
      "MCP get_briefing (requested recipe)": has(
        (await mcpTool(key, "get_briefing", { recipe_ids: ownerRecipeId })).text,
        OWNER_WORD,
      ),
      "MCP list_my_recipe_books": has((await mcpTool(key, "list_my_recipe_books", {})).text, shared.slug),
    };
  }

  function allSurfaces(value: boolean, seen: Record<string, boolean>): Record<string, boolean> {
    return Object.fromEntries(Object.keys(seen).map((k) => [k, value]));
  }

  // ── OAuth plumbing ────────────────────────────────────────────────────────

  const tokenForm = (body: Record<string, string>) =>
    fetch(`${BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });

  async function grantCode(actor: Actor, bookIds: string[]): Promise<{ code: string; verifier: string }> {
    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
    const res = await call(actor, "POST", "/oauth/authorize/grant", {
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: REDIRECT_URI,
      state: "s",
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope_read_group_ids: bookIds,
      scope_write_group_ids: bookIds,
      scope_default_write_group_id: bookIds[0],
    });
    const redirectUrl = ((await res.json()) as { redirect_url?: string }).redirect_url ?? "";
    const code = redirectUrl ? new URL(redirectUrl).searchParams.get("code") ?? "" : "";
    if (!code) throw new Error(`OAuth grant failed: ${res.status}`);
    return { code, verifier };
  }

  function redeem(code: string, verifier: string): Promise<Response> {
    return tokenForm({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: client.client_id,
      client_secret: client.client_secret,
      redirect_uri: REDIRECT_URI,
    });
  }

  function refresh(refreshToken: string): Promise<Response> {
    return tokenForm({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: client.client_id,
      client_secret: client.client_secret,
    });
  }

  async function mintBundle(actor: Actor, bookIds: string[]): Promise<{ access: string; refresh: string }> {
    const { code, verifier } = await grantCode(actor, bookIds);
    const body = (await (await redeem(code, verifier)).json()) as TokenBody;
    if (!body.access_token || !body.refresh_token) throw new Error("OAuth token exchange failed");
    return { access: body.access_token, refresh: body.refresh_token };
  }

  async function keyCountFor(userId: string): Promise<number> {
    const rows = await sql`SELECT count(*)::int AS n FROM claimnet.api_keys WHERE user_id = ${userId}::uuid`;
    return (rows[0] as { n: number }).n;
  }

  async function grantedBooks(accessToken: string): Promise<{ read: string[]; write: string[] }> {
    const rows = await sql`
      SELECT read_group_ids, write_group_ids FROM claimnet.api_keys WHERE key = ${sha256hex(accessToken)}
    `;
    const row = rows[0] as { read_group_ids: string[]; write_group_ids: string[] };
    return { read: row.read_group_ids, write: row.write_group_ids };
  }

  // ── Setup ─────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    sql = postgres({
      host: process.env["PGHOST"] ?? "localhost",
      port: Number(process.env["PGPORT"] ?? 5633),
      user: process.env["PGUSER"] ?? "claimnet",
      password: process.env["PGPASSWORD"] ?? "claimnet",
      database: process.env["PGDATABASE"] ?? "claimnet",
    });
    [owner, member] = await Promise.all([registerAndVerify("owner"), registerAndVerify("member")]);

    const slug = `revocation-${uid}`;
    const created = await call(owner, "POST", "/recipe-books", { name: `Revocation ${uid}`, slug, organizationId: owner.orgId });
    const id = ((await created.json()) as { data?: { id: string } }).data?.id ?? "";
    if (!id) throw new Error("Failed to create shared book");
    shared = { id, slug };
    await addMember();

    const ownerKey = await mintScopedKey(owner, [shared.id], shared.id);
    const seeded = await check(ownerKey, recipe(OWNER_WORD));
    ownerRecipeId = (JSON.parse(seeded.text) as { data?: { checked?: { recipeId?: string } } }).data?.checked?.recipeId ?? "";
    if (!ownerRecipeId) throw new Error(`Failed to seed the shared book: ${seeded.text.slice(0, 300)}`);

    memberKey = await mintScopedKey(member, [shared.id, member.personalBookId], shared.id);

    const dcr = await fetch(`${BASE}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: [REDIRECT_URI], client_name: `revocation-${uid}` }),
    });
    client = (await dcr.json()) as OAuthClient;
    if (!client.client_id) throw new Error("DCR failed");
  }, 120_000);

  afterAll(async () => {
    if (!sql) return;
    await setVerified(member.userId, true);
    await sql.end({ timeout: 2 });
  });

  // ── Membership (F67 / F50) ────────────────────────────────────────────────

  describe("removing a member", () => {
    it("while a member, their key reads the book on every surface", { timeout: 60_000 }, async () => {
      const seen = await visibleOn(memberKey);
      expect(seen).toEqual(allSurfaces(true, seen));
    });

    it("takes the book away from their existing key on every surface, and writes an audit row", { timeout: 60_000 }, async () => {
      await removeMember();

      const seen = await visibleOn(memberKey);
      expect(seen).toEqual(allSurfaces(false, seen));

      // A check's results no longer include it either — and the key itself is
      // still a good key, just without the book.
      const probe = await check(memberKey, { ...recipe("probe-after-removal"), recipe_book: member.personalBookId });
      expect(probe.status).toBe(200);
      expect(probe.text).not.toContain(ownerRecipeId);

      const audit = await sql`
        SELECT actor_user_id, metadata FROM claimnet.audit_log
        WHERE action = 'group.member_removed' AND target_id = ${shared.id}
        ORDER BY occurred_at DESC LIMIT 1
      `;
      expect(audit.length).toBe(1);
      expect((audit[0] as { actor_user_id: string }).actor_user_id).toBe(owner.userId);
      expect((audit[0] as { metadata: { removedUserId?: string } }).metadata.removedUserId).toBe(member.userId);
    });

    it("refuses a deposit into the book with the existing not-writable error", async () => {
      const res = await check(memberKey, { ...recipe("after-removal"), recipe_book: shared.slug });
      expect(res.status).toBe(400);
      expect(res.error).toBe(`Group "${shared.slug}" not found or not writable with this key.`);
    });

    it("refuses a deposit that names no book, rather than redirecting it, when the default was that book", async () => {
      const res = await check(memberKey, recipe("after-removal-default"));
      expect(res.status).toBe(400);
      expect(res.error).toContain("API key has no write access to its default group.");
      expect(res.error).toContain("recipe_book");
      // Naming a book the key can still write works.
      const named = await check(memberKey, { ...recipe("after-removal-named"), recipe_book: member.personalBookId });
      expect(named.status).toBe(200);
      // …and the briefing does not advertise a default the check would not honor.
      const briefing = await (await fetch(`${BASE}/briefing`, { headers: { Authorization: `Bearer ${memberKey}` } })).text();
      expect(briefing).toContain("Default write recipe book: none right now");
    });

    it("gives the book back, default included, when they are re-added", { timeout: 60_000 }, async () => {
      await addMember();
      const seen = await visibleOn(memberKey);
      expect(seen).toEqual(allSurfaces(true, seen));
      const deposit = await check(memberKey, recipe("after-rejoin"));
      expect(deposit.status).toBe(200);
    });
  });

  describe("OAuth refresh after a membership change", () => {
    it("does not carry a book the owner has left into the new bundle", async () => {
      const bundle = await mintBundle(member, [member.personalBookId, shared.id]);
      expect((await grantedBooks(bundle.access)).read).toContain(shared.id);

      await removeMember();
      try {
        const res = await refresh(bundle.refresh);
        expect(res.status).toBe(200);
        const next = (await res.json()) as TokenBody;
        const granted = await grantedBooks(next.access_token!);
        expect(granted.read).toEqual([member.personalBookId]);
        expect(granted.write).toEqual([member.personalBookId]);
      } finally {
        await addMember();
      }
    });

    it("refuses, without burning the token, when every granted book has fallen away", async () => {
      const bundle = await mintBundle(member, [shared.id]);
      await removeMember();
      let before = 0;
      try {
        before = await keyCountFor(member.userId);
        const res = await refresh(bundle.refresh);
        expect(res.status).toBe(400);
        expect(((await res.json()) as TokenBody).error).toBe("invalid_grant");
        expect(await keyCountFor(member.userId)).toBe(before);
      } finally {
        await addMember();
      }
      // Reversible: once they are a member again the same token rotates.
      const res = await refresh(bundle.refresh);
      expect(res.status).toBe(200);
    });
  });

  // ── A book that no longer exists ──────────────────────────────────────────

  describe("a key whose granted book has been deleted", () => {
    // `traces.group_id` carries no foreign key, so nothing at the storage
    // layer stops a write to a book id that is gone. The guarantee has to come
    // from scope: a deleted book has no memberships, so it is in no Principal.
    const GONE_WORD = `gonebook${uid.replace(/-/g, "")}`;
    let goneBookId = "";
    let goneRecipeId = "";
    let key = "";

    async function tracesIn(bookId: string): Promise<number> {
      const rows = await sql`SELECT count(*)::int AS n FROM claimnet.traces WHERE group_id = ${bookId}::uuid`;
      return (rows[0] as { n: number }).n;
    }

    beforeAll(async () => {
      const created = await call(member, "POST", "/recipe-books", {
        name: `Gone ${uid}`,
        slug: `gone-${uid}`,
        organizationId: member.orgId,
      });
      goneBookId = ((await created.json()) as { data?: { id: string } }).data?.id ?? "";
      if (!goneBookId) throw new Error("Failed to create the book to delete");
      key = await mintScopedKey(member, [goneBookId, member.personalBookId], goneBookId);
      const seeded = await check(key, recipe(GONE_WORD));
      goneRecipeId = (JSON.parse(seeded.text) as { data?: { checked?: { recipeId?: string } } }).data?.checked?.recipeId ?? "";
      if (!goneRecipeId) throw new Error("Failed to seed the book to delete");

      // Delete the book the way a teardown that does not know about this key
      // would: memberships and the book row go, the key's grant arrays and its
      // default pointer still name the id, and the recipe row is left behind.
      await sql`DELETE FROM claimnet.group_members WHERE group_id = ${goneBookId}::uuid`;
      await sql`DELETE FROM claimnet.groups WHERE id = ${goneBookId}::uuid`;
    }, 60_000);

    it("cannot deposit into it by id", async () => {
      const before = await tracesIn(goneBookId);
      const res = await check(key, { ...recipe("into-gone-by-id"), recipe_book: goneBookId });
      expect(res.status).toBe(400);
      expect(res.error).toBe(`Group "${goneBookId}" not found or not writable with this key.`);
      expect(await tracesIn(goneBookId)).toBe(before);
    });

    it("cannot default-write into it: the deposit is refused, not written to the dead id and not redirected", async () => {
      const before = await tracesIn(goneBookId);
      const personalBefore = await tracesIn(member.personalBookId);
      const res = await check(key, recipe("into-gone-by-default"));
      expect(res.status).toBe(400);
      expect(res.error).toContain("API key has no write access to its default group.");
      expect(await tracesIn(goneBookId)).toBe(before);
      expect(await tracesIn(member.personalBookId)).toBe(personalBefore);
    });

    it("cannot read what was left behind in it, by id or by search", async () => {
      const bearer = { Authorization: `Bearer ${key}` };
      const byId = await (await fetch(`${BASE}/recipes?ids=${goneRecipeId}`, { headers: bearer })).text();
      expect(byId).not.toContain(GONE_WORD);
      const query = encodeURIComponent(`"${GONE_WORD}" author:anyone`);
      const search = await (await fetch(`${BASE}/check?key=${encodeURIComponent(key)}&f=${query}&format=json`)).text();
      expect(search).not.toContain(goneRecipeId);
      expect((await mcpTool(key, "get_recipes", { recipe_ids: goneRecipeId })).text).not.toContain(GONE_WORD);
    });

    it("still works for the books that do exist", async () => {
      const res = await check(key, { ...recipe("still-works"), recipe_book: member.personalBookId });
      expect(res.status).toBe(200);
    });
  });

  // ── Account state at the token endpoint (F66) ─────────────────────────────

  describe("OAuth issuance consults the owner's account state", () => {
    it("refresh: invalid_grant, no key minted, and the token still works once the owner passes again", async () => {
      const bundle = await mintBundle(member, [member.personalBookId]);
      await setVerified(member.userId, false);
      try {
        const before = await keyCountFor(member.userId);
        const res = await refresh(bundle.refresh);
        expect(res.status).toBe(400);
        expect(((await res.json()) as TokenBody).error).toBe("invalid_grant");
        expect(await keyCountFor(member.userId)).toBe(before);
      } finally {
        await setVerified(member.userId, true);
      }
      expect((await refresh(bundle.refresh)).status).toBe(200);
    });

    it("code redemption: invalid_grant and no key minted", async () => {
      const { code, verifier } = await grantCode(member, [member.personalBookId]);
      await setVerified(member.userId, false);
      try {
        const before = await keyCountFor(member.userId);
        const res = await redeem(code, verifier);
        expect(res.status).toBe(400);
        expect(((await res.json()) as TokenBody).error).toBe("invalid_grant");
        expect(await keyCountFor(member.userId)).toBe(before);
      } finally {
        await setVerified(member.userId, true);
      }
    });
  });
});

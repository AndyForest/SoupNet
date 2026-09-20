import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import postgres from "postgres";

/**
 * Characterization tests for API-key authentication and scope resolution on
 * every key-authed surface — requires running backend + postgres.
 *
 * Written against the code BEFORE key authentication moved into src/authz/,
 * to pin what each surface does with a dead key and with a call-time scope
 * parameter, then kept green across the move. They assert what the surfaces do
 * today: a change to an expectation here is a behavior change and needs its
 * own decision, separate from a refactor.
 *
 * The rule under test: a key is dead when it is unknown, expired, consumed by
 * OAuth rotation, or owned by a user who fails the user-state predicate — and
 * every dead key gets the SAME response on a given surface (no existence
 * oracle). The matrix below checks each dead-key case against the garbage-key
 * response, surface by surface, MCP tools included.
 *
 * Pinned elsewhere, deliberately not repeated here:
 *   - concurrent refresh / client_id mismatch / refresh after the access
 *     token's natural expiry                      → oauth-flow.test.ts
 *   - JWT surfaces deny a removed member at once  → book-access-gates.test.ts
 *   - update_recipe_book_description needs key write scope AND a live
 *     owner/admin role                            → mcp.test.ts
 *   - POST /keys/briefing 404s another user's key → keys.test.ts (F33)
 *   - tombstone (briefing, by-id, check, deposit) → workspaces.test.ts
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const uid = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const PASSWORD = "key-auth-characterization-pw";
const NONEXISTENT_ID = "00000000-0000-4000-8000-000000000000";
const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
const ACCEPT_BOTH = "application/json, text/event-stream";

function canConnect(): boolean {
  return !!(process.env["DATABASE_URL"] || process.env["PGHOST"]);
}

function dbConn() {
  return postgres({
    host: process.env["PGHOST"] ?? "localhost",
    port: Number(process.env["PGPORT"] ?? 5633),
    user: process.env["PGUSER"] ?? "claimnet",
    password: process.env["PGPASSWORD"] ?? "claimnet",
    database: process.env["PGDATABASE"] ?? "claimnet",
  });
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

interface Reply {
  status: number;
  body: string;
}

async function reply(res: Response): Promise<Reply> {
  return { status: res.status, body: await res.text() };
}

async function registerAndVerify(label: string): Promise<Actor> {
  const email = `test-keyauth-${label}-${uid}@test.local`;
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
  const booksRes = await fetch(`${BASE}/recipe-books`, { headers: { Authorization: `Bearer ${jwt}` } });
  const books = ((await booksRes.json()) as { data: Array<{ id: string; organization_id: string }> }).data;
  const personalBookId = books[0]?.id ?? "";
  const orgId = books[0]?.organization_id ?? "";
  if (!personalBookId || !orgId) throw new Error(`Missing personal book for ${email}`);
  return { email, jwt, userId, personalBookId, orgId };
}

async function createBook(actor: Actor, tag: string): Promise<{ id: string; slug: string }> {
  const slug = `keyauth-${tag}-${uid}`;
  const res = await fetch(`${BASE}/recipe-books`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${actor.jwt}` },
    body: JSON.stringify({ name: `Key auth ${tag} ${uid}`, slug, organizationId: actor.orgId }),
  });
  const id = ((await res.json()) as { data?: { id: string } }).data?.id ?? "";
  if (!id) throw new Error(`Failed to create book ${slug}`);
  return { id, slug };
}

async function mintScopedKey(actor: Actor, bookIds: string[], defaultBookId?: string): Promise<string> {
  const res = await fetch(`${BASE}/keys/scoped`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${actor.jwt}` },
    body: JSON.stringify({
      readRecipeBookIds: bookIds,
      writeRecipeBookIds: bookIds,
      defaultWriteRecipeBookId: defaultBookId ?? bookIds[0],
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }),
  });
  const key = ((await res.json()) as { data?: { key?: string } }).data?.key ?? "";
  if (!key) throw new Error(`Failed to mint scoped key for ${actor.email}: ${res.status}`);
  return key;
}

/** Full DCR → grant → code → token exchange, then one refresh. Returns the
 *  rotated-away (dead) access token and the live one that replaced it. */
async function mintAndRotateOAuth(actor: Actor): Promise<{ oldAccess: string; newAccess: string }> {
  const dcr = await fetch(`${BASE}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: [REDIRECT_URI], client_name: `keyauth-${uid}` }),
  });
  const client = (await dcr.json()) as { client_id: string; client_secret: string };
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  const grantRes = await fetch(`${BASE}/oauth/authorize/grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${actor.jwt}` },
    body: JSON.stringify({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: REDIRECT_URI,
      state: "s",
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope_read_group_ids: [actor.personalBookId],
      scope_write_group_ids: [actor.personalBookId],
      scope_default_write_group_id: actor.personalBookId,
    }),
  });
  const redirectUrl = ((await grantRes.json()) as { redirect_url?: string }).redirect_url ?? "";
  const code = new URL(redirectUrl).searchParams.get("code") ?? "";
  const form = (body: Record<string, string>) =>
    fetch(`${BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
  const first = (await (await form({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    client_id: client.client_id,
    client_secret: client.client_secret,
    redirect_uri: REDIRECT_URI,
  })).json()) as { access_token?: string; refresh_token?: string };
  if (!first.access_token || !first.refresh_token) throw new Error("OAuth setup: token exchange failed");
  const second = (await (await form({
    grant_type: "refresh_token",
    refresh_token: first.refresh_token,
    client_id: client.client_id,
    client_secret: client.client_secret,
  })).json()) as { access_token?: string };
  if (!second.access_token) throw new Error("OAuth setup: refresh failed");
  return { oldAccess: first.access_token, newAccess: second.access_token };
}

// ── Surfaces ────────────────────────────────────────────────────────────────

const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });

/** Every REST surface that authorizes on an API key. `safeLive` marks the ones
 *  a live key can call with no side effect, for the positive control. */
const REST_SURFACES: Array<{ name: string; safeLive: boolean; call: (key: string) => Promise<Reply> }> = [
  {
    name: "GET /check (json)",
    safeLive: true,
    call: async (key) => reply(await fetch(`${BASE}/check?key=${encodeURIComponent(key)}&format=json`)),
  },
  {
    name: "GET /check (html)",
    safeLive: true,
    call: async (key) => reply(await fetch(`${BASE}/check?key=${encodeURIComponent(key)}`)),
  },
  {
    name: "GET /check?f= (read-only search)",
    safeLive: true,
    call: async (key) =>
      reply(await fetch(`${BASE}/check?key=${encodeURIComponent(key)}&f=characterization&format=json`)),
  },
  {
    name: "POST /check",
    safeLive: true,
    call: async (key) =>
      reply(await fetch(`${BASE}/check`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ key, format: "json" }).toString(),
      })),
  },
  {
    name: "GET /briefing",
    safeLive: true,
    call: async (key) => reply(await fetch(`${BASE}/briefing`, { headers: bearer(key) })),
  },
  {
    name: "GET /recipes",
    safeLive: true,
    call: async (key) => reply(await fetch(`${BASE}/recipes?ids=${NONEXISTENT_ID}`, { headers: bearer(key) })),
  },
  {
    name: "POST /feedback",
    safeLive: true,
    call: async (key) =>
      reply(await fetch(`${BASE}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...bearer(key) },
        body: JSON.stringify({
          trace_id: NONEXISTENT_ID,
          kind: "check-feedback",
          impact: "none",
          disposition: "proceeded",
          story_fulfilled: "unknown",
          story: "As a characterization test, I wanted a dead key refused so that no row is written.",
        }),
      })),
  },
  {
    name: "GET /feedback",
    safeLive: true,
    call: async (key) =>
      reply(await fetch(`${BASE}/feedback?key=${encodeURIComponent(key)}&trace_id=${NONEXISTENT_ID}&format=json`)),
  },
  {
    name: "POST /uploads",
    safeLive: true,
    call: async (key) => reply(await fetch(`${BASE}/uploads`, { method: "POST", headers: bearer(key) })),
  },
  {
    name: "POST /workspaces",
    safeLive: false, // a live key would create a workspace
    call: async (key) =>
      reply(await fetch(`${BASE}/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...bearer(key) },
        body: JSON.stringify({ name: "characterization" }),
      })),
  },
  {
    name: "POST /workspaces/:id/expiry",
    safeLive: true,
    call: async (key) =>
      reply(await fetch(`${BASE}/workspaces/${NONEXISTENT_ID}/expiry`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...bearer(key) },
        body: JSON.stringify({ expiresAt: "now" }),
      })),
  },
  {
    name: "GET /health/version",
    safeLive: true,
    call: async (key) => reply(await fetch(`${BASE}/health/version`, { headers: bearer(key) })),
  },
  {
    name: "GET /health/integrity",
    safeLive: true,
    call: async (key) => reply(await fetch(`${BASE}/health/integrity`, { headers: bearer(key) })),
  },
];

/** Minimal schema-valid arguments per MCP tool, so a call reaches the tool's
 *  own key handling instead of stopping at argument validation. A tool that
 *  is missing here is still exercised (with `{}`) by the tools/list sweep. */
const MCP_TOOL_ARGS: Record<string, Record<string, unknown>> = {
  check_recipe: {
    recipe: "As a characterization test author, I prefer dead keys refused so that nothing is deposited.",
    supporting_evidence: "A dead key must not deposit.\n> \"dead keys refused\"\n-- this test",
  },
  search_recipes: { query: "characterization" },
  get_briefing: {},
  get_recipes: { recipe_ids: NONEXISTENT_ID },
  list_my_recipe_books: {},
  update_recipe_book_description: { recipe_book_id_or_slug: "personal", description: "characterization" },
  log_feedback: {
    trace_id: NONEXISTENT_ID,
    kind: "check-feedback",
    impact: "none",
    disposition: "proceeded",
    story_fulfilled: "unknown",
    story: "As a characterization test, I wanted a dead key refused so that no row is written.",
  },
};

async function mcpRequest(key: string, method: string, params: unknown): Promise<Reply> {
  return reply(await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: ACCEPT_BOTH, ...bearer(key) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }));
}

function mcpToolCall(key: string, tool: string): Promise<Reply> {
  return mcpRequest(key, "tools/call", { name: tool, arguments: MCP_TOOL_ARGS[tool] ?? {} });
}

// ── Suite ───────────────────────────────────────────────────────────────────

describe.skipIf(!canConnect() || !BASE)("API-key authentication (characterization)", () => {
  let sql: ReturnType<typeof postgres>;
  let carol: Actor; // live key, expired key, OAuth bundle
  let dave: Actor; // the owner who becomes unverified

  let liveKey = "";
  const deadKeys: Record<"malformed" | "unknown" | "expired" | "consumed" | "unverified-owner", string> = {
    malformed: "not-a-key",
    unknown: `cn_s_${"0".repeat(32)}`,
    expired: "",
    consumed: "",
    "unverified-owner": "",
  };
  const DEAD_CASES = ["malformed", "expired", "consumed", "unverified-owner"] as const;

  beforeAll(async () => {
    sql = dbConn();
    [carol, dave] = await Promise.all([registerAndVerify("carol"), registerAndVerify("dave")]);

    liveKey = await mintScopedKey(carol, [carol.personalBookId]);

    deadKeys.expired = await mintScopedKey(carol, [carol.personalBookId]);
    await sql`
      UPDATE claimnet.api_keys SET expires_at = NOW() - INTERVAL '1 minute'
      WHERE key = ${sha256hex(deadKeys.expired)}
    `;

    const oauth = await mintAndRotateOAuth(carol);
    deadKeys.consumed = oauth.oldAccess;

    // The only user-state predicate that exists today: a verified email.
    // Nothing in the product clears it, so the fixture does.
    deadKeys["unverified-owner"] = await mintScopedKey(dave, [dave.personalBookId]);
    await sql`UPDATE claimnet.users SET email_verified_at = NULL WHERE id = ${dave.userId}::uuid`;
  }, 120_000);

  afterAll(async () => {
    if (!sql) return;
    await sql`UPDATE claimnet.users SET email_verified_at = NOW() WHERE id = ${dave.userId}::uuid`;
    await sql.end({ timeout: 2 });
  });

  // ── Dead keys, REST ───────────────────────────────────────────────────────

  describe.each(REST_SURFACES)("$name", (surface) => {
    it("refuses an unknown key with 401", async () => {
      expect((await surface.call(deadKeys.unknown)).status).toBe(401);
    });

    it.each(DEAD_CASES)("answers a %s key byte-for-byte like an unknown one", async (deadCase) => {
      const unknown = await surface.call(deadKeys.unknown);
      expect(await surface.call(deadKeys[deadCase])).toEqual(unknown);
    });

    it.skipIf(!surface.safeLive)("does not refuse a live key", async () => {
      expect((await surface.call(liveKey)).status).not.toBe(401);
    });
  });

  // ── Dead keys, remote MCP ─────────────────────────────────────────────────

  /**
   * Today two tools resolve the key through the briefing service's own lookup,
   * which does not consult the owning user. Those two cells are recorded as
   * expected failures (`it.fails`) so the gap is visible and the suite stays
   * green; the change that routes MCP through the one authentication path
   * turns them into plain `it`.
   */
  const KNOWN_GAP_TODAY = new Set(["get_briefing:unverified-owner", "list_my_recipe_books:unverified-owner"]);

  describe.each(Object.keys(MCP_TOOL_ARGS))("MCP tool %s", (tool) => {
    it("refuses an unknown key with the invalid-key message", async () => {
      const res = await mcpToolCall(deadKeys.unknown, tool);
      expect(res.body).toContain("Invalid or expired API key");
    });

    for (const deadCase of DEAD_CASES) {
      const test = KNOWN_GAP_TODAY.has(`${tool}:${deadCase}`) ? it.fails : it;
      test(`answers a ${deadCase} key byte-for-byte like an unknown one`, { timeout: 30_000 }, async () => {
        const unknown = await mcpToolCall(deadKeys.unknown, tool);
        expect(await mcpToolCall(deadKeys[deadCase], tool)).toEqual(unknown);
      });
    }
  });

  it("every tool in tools/list is covered, including ones added later", { timeout: 60_000 }, async () => {
    const listed = await mcpRequest(liveKey, "tools/list", {});
    expect(listed.status).toBe(200);
    const payload = listed.body.includes("data: ")
      ? listed.body.split("\n").find((l) => l.startsWith("data: "))!.slice(6)
      : listed.body;
    const names = ((JSON.parse(payload) as { result: { tools: Array<{ name: string }> } }).result.tools)
      .map((t) => t.name);
    expect(names.length).toBeGreaterThan(0);
    // The static table above must not name a tool that no longer exists…
    for (const known of Object.keys(MCP_TOOL_ARGS)) expect(names).toContain(known);
    // …and a tool it does not name yet is swept here, so a new tool cannot be
    // unauthenticated by omission.
    for (const tool of names.filter((n) => !(n in MCP_TOOL_ARGS))) {
      const unknown = await mcpToolCall(deadKeys.unknown, tool);
      expect(unknown.body).toContain("Invalid or expired API key");
      for (const deadCase of DEAD_CASES) {
        expect(await mcpToolCall(deadKeys[deadCase], tool)).toEqual(unknown);
      }
    }
  });

  // ── Rotation kills the old access token through expires_at ────────────────

  it("a rotated-away OAuth row carries both the consumed stamp and the epoch expiry sentinel", async () => {
    const rows = await sql`
      SELECT consumed_at, expires_at FROM claimnet.api_keys WHERE key = ${sha256hex(deadKeys.consumed)}
    `;
    const row = rows[0] as { consumed_at: Date | null; expires_at: Date } | undefined;
    expect(row).toBeTruthy();
    expect(row!.consumed_at).not.toBeNull();
    // Every liveness reader checks expires_at > NOW(); the sentinel is what
    // lets all of them inherit the revocation.
    expect(new Date(row!.expires_at).getTime()).toBe(0);
  });

  // ── Call-time parameters only narrow ──────────────────────────────────────

  describe("call-time scope parameters", () => {
    let outside: { id: string; slug: string }; // carol owns it; narrowKey does not hold it
    let narrowKey = ""; // read+write: carol's personal book only
    let outsideRecipeId = "";
    const MARKER = `narrowingmarker${uid.replace(/-/g, "")}`;

    async function check(key: string, extra: Record<string, string>): Promise<{
      status: number;
      body: { ok?: boolean; error?: string; data?: { checked?: { recipeId?: string }; results?: Array<{ recipeId?: string; id?: string }> } };
    }> {
      const res = await fetch(`${BASE}/check`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ key, format: "json", ...extra }).toString(),
      });
      return { status: res.status, body: (await res.json()) as never };
    }

    const recipe = (tag: string) => ({
      trace: `As a scope-narrowing test author working on ${MARKER} ${tag}, I prefer call-time parameters that only narrow so that a key never reads or writes outside its books.`,
      ef: `Seed evidence.\n> "${MARKER}"\n-- this test`,
    });

    beforeAll(async () => {
      outside = await createBook(carol, "outside");
      narrowKey = await mintScopedKey(carol, [carol.personalBookId]);
      const wideKey = await mintScopedKey(carol, [carol.personalBookId, outside.id], outside.id);
      const seeded = await check(wideKey, recipe("seed"));
      outsideRecipeId = seeded.body.data?.checked?.recipeId ?? "";
      if (!outsideRecipeId) throw new Error(`Failed to seed the outside book: ${JSON.stringify(seeded.body)}`);
    }, 60_000);

    it("recipe_book outside the key's write books is refused, by slug and by id", async () => {
      for (const target of [outside.slug, outside.id]) {
        const res = await check(narrowKey, { ...recipe("write-outside"), recipe_book: target });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe(`Group "${target}" not found or not writable with this key.`);
      }
    });

    it("read_recipe_books outside the key's read books never widens a check", async () => {
      const res = await check(narrowKey, { ...recipe("read-outside"), read_recipe_books: outside.slug });
      expect(res.body.ok).toBe(true);
      expect(JSON.stringify(res.body.data)).not.toContain(outsideRecipeId);
    });

    it("read_recipe_books outside the key's read books never widens a read-only search", async () => {
      const q = `&f=${encodeURIComponent(`"${MARKER}"`)}&format=json`;
      const widened = await fetch(
        `${BASE}/check?key=${encodeURIComponent(narrowKey)}${q}&read_recipe_books=${encodeURIComponent(outside.slug)}`,
      );
      expect(await widened.text()).not.toContain(outsideRecipeId);
    });

    it("a key whose default write book is not among its write books cannot deposit by default", async () => {
      // The mint routes never produce this row; the fixture does, to pin the
      // refusal and its wording.
      const brokenKey = await mintScopedKey(carol, [carol.personalBookId]);
      await sql`
        UPDATE claimnet.api_keys SET default_write_group_id = ${outside.id}::uuid
        WHERE key = ${sha256hex(brokenKey)}
      `;
      const res = await check(brokenKey, recipe("broken-default"));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("API key has no write access to its default group.");
    });
  });
});

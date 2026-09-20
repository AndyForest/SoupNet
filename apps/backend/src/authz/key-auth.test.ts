import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";

/**
 * Integration tests for the key half of the authorization seam (key-auth.ts)
 * — requires running backend + postgres.
 *
 * Users, books, memberships, and keys are created through the real HTTP
 * surface (the same fixture convention as authz.test.ts); the module's
 * functions are then called directly against the same database, so each
 * answer is checked at the seam rather than through a route. Direct SQL is
 * used only to put a row into a state no route produces (an expired key, an
 * unverified owner).
 */

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let authz: typeof import("./index");
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let oauth: typeof import("../services/oauth.service");
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getDb: typeof import("../db").getDb;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let sql: typeof import("drizzle-orm").sql;

const BASE = process.env["BACKEND_URL"] ?? "";
const uid = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const PASSWORD = "key-auth-seam-test-pw";

function canConnect(): boolean {
  return !!(process.env["DATABASE_URL"] || process.env["PGHOST"]);
}

function sha256hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

interface Actor {
  email: string;
  jwt: string;
  userId: string;
  personalBookId: string;
  orgId: string;
}

class Rollback extends Error {}

describe.skipIf(!canConnect() || !BASE)("authz seam — API-key authentication", () => {
  let owner: Actor;
  let member: Actor;
  let sharedBookId = "";

  async function registerAndVerify(label: string): Promise<Actor> {
    const email = `test-keyseam-${label}-${uid}@test.local`;
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

  function call(actor: { jwt: string }, method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${actor.jwt}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
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
    const res = await call(owner, "POST", `/recipe-books/${sharedBookId}/members`, { email: member.email, role: "member" });
    if (res.status !== 201) throw new Error(`Failed to add member: ${res.status}`);
  }

  async function removeMember(): Promise<void> {
    const res = await call(owner, "DELETE", `/recipe-books/${sharedBookId}/members/${member.userId}`);
    if (res.status !== 200) throw new Error(`Failed to remove member: ${res.status}`);
  }

  async function setVerified(userId: string, verified: boolean): Promise<void> {
    await getDb().execute(sql`
      UPDATE claimnet.users SET email_verified_at = ${verified ? sql`NOW()` : sql`NULL`}
      WHERE id = ${userId}::uuid
    `);
  }

  beforeAll(async () => {
    authz = await import("./index");
    oauth = await import("../services/oauth.service");
    getDb = (await import("../db")).getDb;
    sql = (await import("drizzle-orm")).sql;

    [owner, member] = await Promise.all([registerAndVerify("owner"), registerAndVerify("member")]);
    const created = await call(owner, "POST", "/recipe-books", {
      name: `Key seam ${uid}`,
      slug: `key-seam-${uid}`,
      organizationId: owner.orgId,
    });
    sharedBookId = ((await created.json()) as { data?: { id: string } }).data?.id ?? "";
    if (!sharedBookId) throw new Error("Failed to create shared book");
    await addMember();
  }, 60_000);

  // ── The credential ────────────────────────────────────────────────────────

  describe("authenticateKey — the credential", () => {
    it("returns the Principal for a live key", async () => {
      const key = await mintScopedKey(member, [member.personalBookId], member.personalBookId);
      const principal = await authz.authenticateKey(getDb(), key);
      expect(principal).not.toBeNull();
      expect(principal!.userId).toBe(member.userId);
      expect(principal!.keyType).toBe("scoped");
      expect(principal!.oauthClientId).toBeNull();
      expect(principal!.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(principal!.readGroupIds).toEqual([member.personalBookId]);
      expect(principal!.writeGroupIds).toEqual([member.personalBookId]);
      expect(principal!.defaultWriteGroupId).toBe(member.personalBookId);
      expect(principal!.expiredReadGroupIds).toEqual([]);
    });

    it("is null for an unknown key and for an empty one", async () => {
      expect(await authz.authenticateKey(getDb(), `cn_s_${"0".repeat(32)}`)).toBeNull();
      expect(await authz.authenticateKey(getDb(), "")).toBeNull();
    });

    it("is null for an expired key", async () => {
      const key = await mintScopedKey(member, [member.personalBookId], member.personalBookId);
      await getDb().execute(sql`
        UPDATE claimnet.api_keys SET expires_at = NOW() - INTERVAL '1 minute' WHERE key = ${sha256hex(key)}
      `);
      expect(await authz.authenticateKey(getDb(), key)).toBeNull();
    });

    it("is null for a consumed key even when its expiry was left in the future", async () => {
      // Rotation stamps both columns; this pins that the consumption marker is
      // enforced on its own, not only through the expiry sentinel.
      const key = await mintScopedKey(member, [member.personalBookId], member.personalBookId);
      await getDb().execute(sql`UPDATE claimnet.api_keys SET consumed_at = NOW() WHERE key = ${sha256hex(key)}`);
      expect(await authz.authenticateKey(getDb(), key)).toBeNull();
    });

    it("is null while the owner fails the user-state predicate, and works again once they pass it", async () => {
      const solo = await registerAndVerify("solo");
      const key = await mintScopedKey(solo, [solo.personalBookId], solo.personalBookId);
      await setVerified(solo.userId, false);
      expect(await authz.authenticateKey(getDb(), key)).toBeNull();
      // Reversible: nothing was done to the key itself.
      await setVerified(solo.userId, true);
      expect((await authz.authenticateKey(getDb(), key))?.userId).toBe(solo.userId);
    });

    it("with ownerUserId, accepts only that user's own key", async () => {
      const key = await mintScopedKey(member, [member.personalBookId], member.personalBookId);
      expect(await authz.authenticateKey(getDb(), key, { ownerUserId: owner.userId })).toBeNull();
      expect((await authz.authenticateKey(getDb(), key, { ownerUserId: member.userId }))?.userId).toBe(member.userId);
    });
  });

  // ── Effective scope ───────────────────────────────────────────────────────

  describe("authenticateKey — effective scope", () => {
    it("drops a book the owner has left from read and write, and restores it when they rejoin", async () => {
      const key = await mintScopedKey(member, [sharedBookId, member.personalBookId], member.personalBookId);
      const before = await authz.authenticateKey(getDb(), key);
      // Grant order is preserved.
      expect(before!.readGroupIds).toEqual([sharedBookId, member.personalBookId]);
      expect(before!.writeGroupIds).toEqual([sharedBookId, member.personalBookId]);

      await removeMember();
      const after = await authz.authenticateKey(getDb(), key);
      expect(after!.readGroupIds).toEqual([member.personalBookId]);
      expect(after!.writeGroupIds).toEqual([member.personalBookId]);
      expect(after!.defaultWriteGroupId).toBe(member.personalBookId);
      expect(after!.expiredReadGroupIds).toEqual([]);

      await addMember();
      const restored = await authz.authenticateKey(getDb(), key);
      expect(restored!.readGroupIds).toEqual([sharedBookId, member.personalBookId]);
      expect(restored!.writeGroupIds).toEqual([sharedBookId, member.personalBookId]);
    });

    it("has no default write book while the stored default is a book the owner has left", async () => {
      const key = await mintScopedKey(member, [sharedBookId, member.personalBookId], sharedBookId);
      expect((await authz.authenticateKey(getDb(), key))!.defaultWriteGroupId).toBe(sharedBookId);

      await removeMember();
      const after = await authz.authenticateKey(getDb(), key);
      // Not redirected to the remaining writable book.
      expect(after!.defaultWriteGroupId).toBeNull();
      expect(after!.writeGroupIds).toEqual([member.personalBookId]);

      // The stored pointer was left alone, so rejoining restores the default.
      await addMember();
      expect((await authz.authenticateKey(getDb(), key))!.defaultWriteGroupId).toBe(sharedBookId);
    });

    it("drops a disposed workspace from read and write and reports it only as expired", async () => {
      const key = await mintScopedKey(member, [member.personalBookId], member.personalBookId);
      const created = await fetch(`${BASE}/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ name: `key seam workspace ${uid}` }),
      });
      const workspaceId = ((await created.json()) as { data?: { recipeBookId: string } }).data?.recipeBookId ?? "";
      if (!workspaceId) throw new Error(`Failed to create workspace: ${created.status}`);

      const live = await authz.authenticateKey(getDb(), key);
      expect(live!.readGroupIds).toContain(workspaceId);
      expect(live!.writeGroupIds).toContain(workspaceId);
      expect(live!.expiredReadGroupIds).toEqual([]);

      const expired = await fetch(`${BASE}/workspaces/${workspaceId}/expiry`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ expiresAt: "now" }),
      });
      expect(expired.status).toBe(200);

      const after = await authz.authenticateKey(getDb(), key);
      expect(after!.readGroupIds).toEqual([member.personalBookId]);
      expect(after!.writeGroupIds).toEqual([member.personalBookId]);
      expect(after!.expiredReadGroupIds).toEqual([workspaceId]);
    });
  });

  // ── Refresh-token rotation ────────────────────────────────────────────────

  describe("consumeRefreshToken", () => {
    async function mintBundle(bookIds: string[]): Promise<string> {
      const bundle = await oauth.mintOAuthTokenBundle(getDb(), {
        userId: member.userId,
        clientId: `key-seam-client-${uid}`,
        scopeReadGroupIds: bookIds,
        scopeWriteGroupIds: bookIds,
        scopeDefaultWriteGroupId: member.personalBookId,
      });
      return sha256hex(bundle.refreshToken);
    }

    it("is single-use and returns the stored grant unchanged (reach is decided at authentication)", async () => {
      const hash = await mintBundle([sharedBookId, member.personalBookId]);
      await removeMember();
      try {
        const first = await authz.consumeRefreshToken(getDb(), hash);
        expect(first).not.toBeNull();
        expect(first!.userId).toBe(member.userId);
        expect([...first!.readGroupIds].sort()).toEqual([sharedBookId, member.personalBookId].sort());
        expect([...first!.writeGroupIds].sort()).toEqual([sharedBookId, member.personalBookId].sort());
        expect(first!.storedDefaultWriteGroupId).toBe(member.personalBookId);
        expect(await authz.consumeRefreshToken(getDb(), hash)).toBeNull();

        // The consumed row carries BOTH stamps: the compare-and-swap marker,
        // and the epoch expiry that kills the old access token for every
        // reader of `expires_at > NOW()`. If rotation ever stops writing the
        // sentinel, this is the assertion that says so.
        const rows = (await getDb().execute(sql`
          SELECT consumed_at, extract(epoch FROM expires_at)::float8 AS expires_epoch
          FROM claimnet.api_keys WHERE refresh_token_hash = ${hash}
        `)) as unknown as Array<{ consumed_at: string | null; expires_epoch: number }>;
        expect(rows[0]?.consumed_at).not.toBeNull();
        expect(rows[0]?.expires_epoch).toBe(0);
      } finally {
        await addMember();
      }
    });

    it("refuses without consuming while the owner fails the user-state predicate", async () => {
      const hash = await mintBundle([member.personalBookId]);
      await setVerified(member.userId, false);
      try {
        expect(await authz.consumeRefreshToken(getDb(), hash)).toBeNull();
      } finally {
        await setVerified(member.userId, true);
      }
      // Refused, not burned: the same token rotates once the owner passes again.
      expect(await authz.consumeRefreshToken(getDb(), hash)).not.toBeNull();
    });
  });

  // ── Workspace scope binding ───────────────────────────────────────────────

  describe("bindBookToKey", () => {
    async function tryBind(key: string): Promise<boolean> {
      const keyId = (await authz.authenticateKey(getDb(), key))?.keyId
        ?? ((await getDb().execute(sql`SELECT id FROM claimnet.api_keys WHERE key = ${sha256hex(key)}`)) as unknown as Array<{ id: string }>)[0]!.id;
      let bound = false;
      // Always rolled back — the test only wants the verdict.
      await getDb().transaction(async (tx) => {
        bound = await authz.bindBookToKey(tx, keyId, sharedBookId);
        throw new Rollback();
      }).catch((err) => {
        if (!(err instanceof Rollback)) throw err;
      });
      return bound;
    }

    it("binds a live key, and refuses one whose owner fails the user-state predicate", async () => {
      const solo = await registerAndVerify("binder");
      const key = await mintScopedKey(solo, [solo.personalBookId], solo.personalBookId);
      expect(await tryBind(key)).toBe(true);
      await setVerified(solo.userId, false);
      expect(await tryBind(key)).toBe(false);
    });
  });
});

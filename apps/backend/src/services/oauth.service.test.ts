import { describe, it, expect, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { validateRedirectUri, hashOpaque, cleanupOAuthArtifacts } from "./oauth.service";

describe("validateRedirectUri", () => {
  it("accepts https URIs", () => {
    expect(validateRedirectUri("https://claude.ai/api/mcp/auth_callback")).toEqual({ ok: true });
    expect(validateRedirectUri("https://claude.com/api/mcp/auth_callback")).toEqual({ ok: true });
  });

  it("accepts http://localhost variants for development", () => {
    expect(validateRedirectUri("http://localhost:3000/callback")).toEqual({ ok: true });
    expect(validateRedirectUri("http://127.0.0.1:8080/cb")).toEqual({ ok: true });
    expect(validateRedirectUri("http://[::1]:8080/cb")).toEqual({ ok: true });
  });

  it("rejects http:// for non-localhost hosts", () => {
    const result = validateRedirectUri("http://example.com/cb");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/https/);
  });

  it("rejects URIs with a fragment (RFC 6749 §3.1.2)", () => {
    const result = validateRedirectUri("https://example.com/cb#frag");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/fragment/);
  });

  it("rejects unparseable values", () => {
    expect(validateRedirectUri("not a url").ok).toBe(false);
    expect(validateRedirectUri("").ok).toBe(false);
  });

  it("rejects extremely long URIs", () => {
    const long = "https://example.com/" + "a".repeat(3000);
    const result = validateRedirectUri(long);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/max length/);
  });
});

describe("hashOpaque", () => {
  it("produces a deterministic SHA-256 hex digest", () => {
    expect(hashOpaque("hello")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("produces different hashes for different inputs", () => {
    expect(hashOpaque("a")).not.toBe(hashOpaque("b"));
  });
});

// F39 (security-audit-2026-06-11): DB-fixture tests for the opportunistic
// sweep — same pattern as waitlist.service.test.ts. Fixtures are inserted
// directly with backdated timestamps, swept, and asserted on by their unique
// client_id values so parallel test files can't collide.
const HAS_DB = Boolean(process.env["PGHOST"] || process.env["DATABASE_URL"]);
const uid = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

describe.skipIf(!HAS_DB)("cleanupOAuthArtifacts (F39, DB fixtures)", () => {
  const db = getDb();
  const staleClientId = `oauth_f39stale_${uid}`;
  const dormantClientId = `oauth_f39dormant_${uid}`;
  const freshClientId = `oauth_f39fresh_${uid}`;
  const allClientIds = [staleClientId, dormantClientId, freshClientId];

  afterAll(async () => {
    await db.execute(sql`
      DELETE FROM claimnet.oauth_authorization_codes
      WHERE client_id IN (${sql.join(allClientIds.map((c) => sql`${c}`), sql`, `)})
    `);
    await db.execute(sql`
      DELETE FROM claimnet.oauth_clients
      WHERE client_id IN (${sql.join(allClientIds.map((c) => sql`${c}`), sql`, `)})
    `);
  });

  it("sweeps long-expired codes, keeps live ones", async () => {
    // A client to hang the codes off (fresh, never swept).
    await db.execute(sql`
      INSERT INTO claimnet.oauth_clients (client_id, client_secret_hash, redirect_uris, created_at, last_used_at)
      VALUES (${freshClientId}, ${hashOpaque("s")}, ARRAY['https://example.com/cb'], NOW(), NOW())
    `);
    // user_id has no FK (see schema/oauth-authorization-codes.ts), so a
    // random UUID keeps this fixture self-contained — no user rows needed.
    await db.execute(sql`
      INSERT INTO claimnet.oauth_authorization_codes
        (code_hash, client_id, user_id, redirect_uri, code_challenge, code_challenge_method,
         scope_read_group_ids, scope_write_group_ids, scope_default_write_group_id, expires_at, created_at)
      VALUES (${hashOpaque(`dead-${uid}`)}, ${freshClientId}, gen_random_uuid(), 'https://example.com/cb', 'ch', 'S256',
              ARRAY[]::uuid[], ARRAY[]::uuid[], gen_random_uuid(), NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days')
    `);
    await db.execute(sql`
      INSERT INTO claimnet.oauth_authorization_codes
        (code_hash, client_id, user_id, redirect_uri, code_challenge, code_challenge_method,
         scope_read_group_ids, scope_write_group_ids, scope_default_write_group_id, expires_at, created_at)
      VALUES (${hashOpaque(`live-${uid}`)}, ${freshClientId}, gen_random_uuid(), 'https://example.com/cb', 'ch', 'S256',
              ARRAY[]::uuid[], ARRAY[]::uuid[], gen_random_uuid(), NOW() + INTERVAL '5 minutes', NOW())
    `);

    await cleanupOAuthArtifacts(db);

    const rows = (await db.execute(sql`
      SELECT code_hash FROM claimnet.oauth_authorization_codes WHERE client_id = ${freshClientId}
    `)) as unknown as Array<{ code_hash: string }>;
    const hashes = rows.map((r) => r.code_hash);
    expect(hashes).toContain(hashOpaque(`live-${uid}`));
    expect(hashes).not.toContain(hashOpaque(`dead-${uid}`));
  });

  it("sweeps old never-used clients, keeps dormant clients that authenticated once", async () => {
    // Stale: registered 60 days ago, never authenticated, nothing minted.
    await db.execute(sql`
      INSERT INTO claimnet.oauth_clients (client_id, client_secret_hash, redirect_uris, created_at, last_used_at)
      VALUES (${staleClientId}, ${hashOpaque("s")}, ARRAY['https://example.com/cb'], NOW() - INTERVAL '60 days', NULL)
    `);
    // Dormant: registered 60 days ago but DID authenticate at some point.
    await db.execute(sql`
      INSERT INTO claimnet.oauth_clients (client_id, client_secret_hash, redirect_uris, created_at, last_used_at)
      VALUES (${dormantClientId}, ${hashOpaque("s")}, ARRAY['https://example.com/cb'], NOW() - INTERVAL '60 days', NOW() - INTERVAL '45 days')
    `);

    await cleanupOAuthArtifacts(db);

    const rows = (await db.execute(sql`
      SELECT client_id FROM claimnet.oauth_clients
      WHERE client_id IN (${sql.join(allClientIds.map((c) => sql`${c}`), sql`, `)})
    `)) as unknown as Array<{ client_id: string }>;
    const ids = rows.map((r) => r.client_id);
    expect(ids).not.toContain(staleClientId);
    expect(ids).toContain(dormantClientId);
    expect(ids).toContain(freshClientId);
  });
});

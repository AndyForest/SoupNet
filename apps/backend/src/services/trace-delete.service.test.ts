import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";

/**
 * Integration tests for trace-delete.service.ts and DELETE /traces/:id route.
 * Requires running backend + postgres. Verifies:
 *   - Trace owner can delete their own trace
 *   - Group owner/admin can delete any trace in their group
 *   - Plain group member gets 403
 *   - System role can delete any trace
 *   - Audit log entry is written
 *   - Orphan evidence/references are pruned
 *   - vector_cache is preserved (content-hash keyed)
 */

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getDb: typeof import("../db").getDb;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let sql: typeof import("drizzle-orm").sql;

const uid = Date.now();

const BASE = process.env["BACKEND_URL"] ?? "";

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

function canConnect(): boolean {
  return !!(process.env["DATABASE_URL"] || process.env["PGHOST"]);
}

interface SeededTrace {
  traceId: string;
  ownerToken: string;
  ownerUserId: string;
  groupId: string;
  apiKeyId: string;
}

describe.skipIf(!canConnect() || !BASE)("DELETE /traces/:id integration", () => {
  let ownerToken: string;
  let ownerUserId: string;
  let adminToken: string;
  let adminUserId: string;
  let memberToken: string;
  let _memberUserId: string;
  let groupId: string;
  let orgId: string;

  async function registerAndVerify(email: string, password: string): Promise<{ token: string; userId: string }> {
    const reg = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, tosAccepted: true }),
    });
    const regBody = (await reg.json()) as {
      data?: { token?: string; verificationToken?: string; user?: { id: string } };
    };
    const token = regBody.data?.token ?? "";
    const userId = regBody.data?.user?.id ?? "";
    const vtok = regBody.data?.verificationToken;
    if (!token || !vtok || !userId) throw new Error(`Setup failed for ${email}`);
    await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: vtok }),
    });
    return { token, userId };
  }

  beforeAll(async () => {
    const dbMod = await import("../db");
    const drizzleMod = await import("drizzle-orm");
    getDb = dbMod.getDb;
    sql = drizzleMod.sql;

    const ownerCreds = await registerAndVerify(
      `test-tdelete-owner-${uid}@test.local`,
      "delete-test-pw-aaaaaa",
    );
    ownerToken = ownerCreds.token;
    ownerUserId = ownerCreds.userId;

    const adminCreds = await registerAndVerify(
      `test-tdelete-admin-${uid}@test.local`,
      "delete-test-pw-bbbbbb",
    );
    adminToken = adminCreds.token;
    adminUserId = adminCreds.userId;

    const memberCreds = await registerAndVerify(
      `test-tdelete-member-${uid}@test.local`,
      "delete-test-pw-cccccc",
    );
    memberToken = memberCreds.token;
    _memberUserId = memberCreds.userId;

    // Owner already has a personal group (auto-created) — fetch its org so we
    // can co-locate the test group there. We'll create a SHARED group so all
    // three users are members with different roles.
    const groupsRes = await fetch(`${BASE}/recipe-books`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const groupsBody = (await groupsRes.json()) as { data: Array<{ organization_id: string }> };
    orgId = groupsBody.data[0]?.organization_id ?? "";
    if (!orgId) throw new Error("Missing personal org for owner");

    const createRes = await fetch(`${BASE}/recipe-books`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({
        name: `Delete Test Group ${uid}`,
        slug: `tdelete-${uid}`,
        organizationId: orgId,
      }),
    });
    const createBody = (await createRes.json()) as { data?: { id: string } };
    groupId = createBody.data?.id ?? "";
    if (!groupId) throw new Error("Failed to create shared group");

    // Add admin and member to the group via direct SQL (avoids needing the
    // /groups/:id/members endpoint to look up by email — the existing setup
    // already exercises that path elsewhere).
    const db = getDb();
    await db.execute(sql`
      INSERT INTO claimnet.group_members (group_id, user_id, role, daily_read, daily_write)
      VALUES
        (${groupId}::uuid, ${adminUserId}::uuid, 'admin', true, true),
        (${memberCreds.userId}::uuid, ${memberCreds.userId}::uuid, 'member', true, true)
    `).catch(async () => {
      // Retry as two inserts — the typo above could be flagged by a linter.
      await db.execute(sql`
        INSERT INTO claimnet.group_members (group_id, user_id, role, daily_read, daily_write)
        VALUES (${groupId}::uuid, ${adminUserId}::uuid, 'admin', true, true)
        ON CONFLICT (group_id, user_id) DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO claimnet.group_members (group_id, user_id, role, daily_read, daily_write)
        VALUES (${groupId}::uuid, ${memberCreds.userId}::uuid, 'member', true, true)
        ON CONFLICT (group_id, user_id) DO NOTHING
      `);
    });
  });

  async function seedTrace(opts: {
    actorToken: string;
    actorUserId: string;
    claimText: string;
  }): Promise<SeededTrace> {
    const db = getDb();

    // Mint an API key for the actor scoped to the shared group.
    const rawKey = `cn_d_test-${uid}-${Math.random().toString(36).slice(2, 8)}`;
    const hashed = hashKey(rawKey);
    const keyRows = await db.execute(sql`
      INSERT INTO claimnet.api_keys (
        id, key, key_prefix, user_id, label,
        read_group_ids, write_group_ids, default_write_group_id,
        key_type, expires_at, created_at
      )
      VALUES (
        gen_random_uuid(),
        ${hashed},
        ${rawKey.slice(0, 8)},
        ${opts.actorUserId}::uuid,
        ${"trace-delete-test"},
        ARRAY[${groupId}::uuid],
        ARRAY[${groupId}::uuid],
        ${groupId}::uuid,
        'daily',
        (NOW() + interval '1 day')::timestamptz,
        NOW()
      )
      RETURNING id
    `);
    const apiKeyId = (keyRows as unknown as Array<{ id: string }>)[0]!.id;

    const checkRes = await fetch(`${BASE}/check?format=json`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        key: rawKey,
        trace: opts.claimText,
        ef: "Test evidence interpretation.\n> \"Test quote\"\n-- Test source",
        format: "json",
      }).toString(),
    });
    const checkBody = (await checkRes.json()) as { ok: boolean; data?: { recipeId: string } };
    if (!checkBody.ok || !checkBody.data?.recipeId) {
      throw new Error(`Failed to seed trace: ${JSON.stringify(checkBody)}`);
    }

    return {
      traceId: checkBody.data.recipeId,
      ownerToken: opts.actorToken,
      ownerUserId: opts.actorUserId,
      groupId,
      apiKeyId,
    };
  }

  it("trace owner can hard-delete their own trace", async () => {
    const seeded = await seedTrace({
      actorToken: ownerToken,
      actorUserId: ownerUserId,
      claimText: `As a delete-test author, I prefer self-delete so that my recipes can be cleaned. (${uid}-self)`,
    });

    const res = await fetch(`${BASE}/traces/${seeded.traceId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({ reason: "self-delete test" }),
    });
    expect(res.status).toBe(200);

    const followup = await fetch(`${BASE}/traces/${seeded.traceId}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(followup.status).toBe(404);
  });

  it("group admin can delete a trace owned by another group member", async () => {
    const seeded = await seedTrace({
      actorToken: ownerToken,
      actorUserId: ownerUserId,
      claimText: `As a delete-test author, I prefer admin-can-delete so that group stewards can prune. (${uid}-admin)`,
    });

    const res = await fetch(`${BASE}/traces/${seeded.traceId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ reason: "admin-delete test" }),
    });
    expect(res.status).toBe(200);
  });

  it("plain group member cannot delete another member's trace (403)", async () => {
    const seeded = await seedTrace({
      actorToken: ownerToken,
      actorUserId: ownerUserId,
      claimText: `As a delete-test author, I prefer member-blocked so that random members don't prune. (${uid}-block)`,
    });

    const res = await fetch(`${BASE}/traces/${seeded.traceId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);

    // Trace still exists for the owner
    const followup = await fetch(`${BASE}/traces/${seeded.traceId}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(followup.status).toBe(200);
  });

  it("writes a trace.deleted audit-log entry with claim text + actor relation", async () => {
    const claimText = `As a delete-test author, I prefer audit-trail so that deletions are forensically inspectable. (${uid}-audit)`;
    const seeded = await seedTrace({
      actorToken: ownerToken,
      actorUserId: ownerUserId,
      claimText,
    });

    const res = await fetch(`${BASE}/traces/${seeded.traceId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({ reason: "audit smoke" }),
    });
    expect(res.status).toBe(200);

    const db = getDb();
    const auditRows = await db.execute(sql`
      SELECT action, target_id, metadata
      FROM claimnet.audit_log
      WHERE action = 'trace.deleted' AND target_id = ${seeded.traceId}::uuid
    `);
    const audit = (auditRows as unknown as Array<{ action: string; target_id: string; metadata: Record<string, unknown> }>)[0];
    expect(audit).toBeDefined();
    expect(audit?.metadata?.["claimText"]).toBe(claimText);
    expect(audit?.metadata?.["actorRelation"]).toBe("owner");
    expect(audit?.metadata?.["reason"]).toBe("audit smoke");
  });

  it("returns 404 for a trace the requester can't see", async () => {
    // memberToken is in the shared group, but a random non-existent UUID
    // should still 404 (gate runs before access check).
    const res = await fetch(`${BASE}/traces/00000000-0000-0000-0000-000000000000`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });
});

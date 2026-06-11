import { describe, it, expect, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { registerUser, loginUser } from "../auth";
import {
  approveWaitlistedUser,
  promoteTopWaitlisted,
  purgeStaleWaitlistedUsers,
} from "./waitlist.service";

/**
 * DB-fixture tests for the waitlist state machine — the paths that can't be
 * exercised over HTTP without closing the global signup cap (which would
 * flake every parallel test file that registers users).
 *
 * Fixtures are created via registerUser({ waitlisted: true }) — the same
 * code path the register route uses when the cap is full — then backdated
 * with direct UPDATEs (test fixtures, not production data). All fixture
 * emails are unique per run and torn down in afterAll.
 *
 * Note: promoteTopWaitlisted operates on the whole table, so a stray
 * verified waitlisted account in a shared dev database could be promoted
 * alongside the fixtures (assertions use toContain to tolerate strays,
 * except the invite-priority check, which assumes no stray invite-holding
 * waitlisted account exists). CI runs against a fresh database.
 */

const HAS_DB = Boolean(process.env["PGHOST"] || process.env["DATABASE_URL"]);
const HAS_JWT = Boolean(process.env["JWT_SECRET"]);

const uid = Date.now();
const PW = "waitlist-service-test-pw-123";
const emailA = `wl-svc-a-${uid}@test.local`; // verified, backdated to 2000 (oldest), no invite
const emailB = `wl-svc-b-${uid}@test.local`; // verified, fresh, holds an invite
const emailC = `wl-svc-c-${uid}@test.local`; // unverified, fresh — approve target
const emailD = `wl-svc-d-${uid}@test.local`; // unverified, stale — purge target
const fixtureEmails = [emailA, emailB, emailC, emailD];

describe.skipIf(!HAS_DB || !HAS_JWT)("waitlist service (DB fixtures)", () => {
  const db = getDb();
  const ids: Record<string, string> = {};

  afterAll(async () => {
    // Tear down whatever the purge test didn't already remove, plus the
    // invitation fixture. Same bottom-up order as the purge.
    for (const email of fixtureEmails) {
      await db.execute(sql`
        DELETE FROM claimnet.group_members WHERE group_id IN (
          SELECT g.id FROM claimnet.groups g WHERE g.organization_id IN (
            SELECT o.id FROM claimnet.organizations o
            JOIN claimnet.users u ON u.id = o.owner_id WHERE u.email = ${email}
          )
        )
      `);
      await db.execute(sql`
        DELETE FROM claimnet.groups WHERE organization_id IN (
          SELECT o.id FROM claimnet.organizations o
          JOIN claimnet.users u ON u.id = o.owner_id WHERE u.email = ${email}
        )
      `);
      await db.execute(sql`
        DELETE FROM claimnet.organizations WHERE owner_id IN (
          SELECT id FROM claimnet.users WHERE email = ${email}
        )
      `);
      await db.execute(sql`DELETE FROM claimnet.invitations WHERE email = ${email}`);
      await db.execute(sql`DELETE FROM claimnet.users WHERE email = ${email}`);
    }
  });

  it("creates waitlisted accounts that cannot log in (no token issued)", async () => {
    for (const email of fixtureEmails) {
      const result = await registerUser(db, email, PW, "tenant", {
        waitlisted: true,
        signupReason: "service-test fixture",
      });
      ids[email] = result.user.id;
    }

    const login = await loginUser(db, emailA, PW);
    expect(login).not.toBeNull();
    expect(login!.waitlistedAt).not.toBeNull();
    expect(login!.token).toBeNull();

    // Wrong password still fails before any waitlist signal.
    expect(await loginUser(db, emailA, "wrong-password-123")).toBeNull();
  });

  it("promoteTopWaitlisted: verified only, invitation-holders before older non-holders", async () => {
    // A: verified and MUCH older (backdated to 2000). B: verified, fresh,
    // but holds a pending invitation — invite-priority must beat A's age.
    await db.execute(sql`
      UPDATE claimnet.users SET email_verified_at = now(), created_at = '2000-01-01'::timestamptz
      WHERE id = ${ids[emailA]}::uuid
    `);
    await db.execute(sql`
      UPDATE claimnet.users SET email_verified_at = now() WHERE id = ${ids[emailB]}::uuid
    `);
    await db.execute(sql`
      INSERT INTO claimnet.invitations (inviter_id, group_id, email, token, bypass_cap, expires_at)
      VALUES (${ids[emailA]}::uuid, NULL, ${emailB}, ${"wl-svc-token-" + uid}, false, now() + interval '7 days')
    `);

    const first = await promoteTopWaitlisted(db, 1);
    expect(first).toContain(emailB);
    expect(first).not.toContain(emailA);

    const second = await promoteTopWaitlisted(db, 1);
    expect(second).toContain(emailA);

    // C is unverified — never auto-promoted, no matter the headroom.
    const more = await promoteTopWaitlisted(db, 50);
    expect(more).not.toContain(emailC);
    const cRow = await db.execute(sql`
      SELECT waitlisted_at FROM claimnet.users WHERE id = ${ids[emailC]}::uuid
    `);
    expect((cRow as unknown as Array<{ waitlisted_at: Date | null }>)[0]?.waitlisted_at).not.toBeNull();

    // Promoted accounts can log in.
    const login = await loginUser(db, emailB, PW);
    expect(login!.token).toBeTruthy();
    expect(login!.waitlistedAt).toBeNull();
  });

  it("purgeStaleWaitlistedUsers removes stale unverified accounts and their org scaffolding", async () => {
    await db.execute(sql`
      UPDATE claimnet.users SET created_at = now() - interval '31 days' WHERE id = ${ids[emailD]}::uuid
    `);

    const purged = await purgeStaleWaitlistedUsers(db);
    expect(purged).toBeGreaterThanOrEqual(1);

    const dRow = await db.execute(sql`SELECT id FROM claimnet.users WHERE email = ${emailD}`);
    expect((dRow as unknown as unknown[]).length).toBe(0);
    const dOrg = await db.execute(sql`
      SELECT id FROM claimnet.organizations WHERE owner_id = ${ids[emailD]}::uuid
    `);
    expect((dOrg as unknown as unknown[]).length).toBe(0);

    // C is unverified but fresh — not purged.
    const cRow = await db.execute(sql`SELECT id FROM claimnet.users WHERE email = ${emailC}`);
    expect((cRow as unknown as unknown[]).length).toBe(1);
  });

  it("approveWaitlistedUser works regardless of verification; idempotent", async () => {
    // C is unverified — admin approval still works; they land in the normal
    // verify-pending flow at login (token issued, emailVerified false).
    const approved = await approveWaitlistedUser(db, ids[emailC]!, null);
    expect(approved).toBe(emailC);

    const login = await loginUser(db, emailC, PW);
    expect(login).not.toBeNull();
    expect(login!.waitlistedAt).toBeNull();
    expect(login!.token).toBeTruthy();

    // Approving a non-waitlisted account is a no-op.
    expect(await approveWaitlistedUser(db, ids[emailC]!, null)).toBeNull();
  });
});

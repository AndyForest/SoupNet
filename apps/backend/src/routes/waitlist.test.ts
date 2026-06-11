import { describe, it, expect, beforeAll } from "vitest";

/**
 * Integration tests for the signup queue (waitlist v2: waitlisted accounts
 * are user rows, not a side table). Requires running backend +
 * DEV_USERNAME/DEV_PASSWORD (system admin).
 *
 * Covered here (cap-open paths — safe under parallel test files):
 *   - register stores the optional signup reason on the user row
 *   - GET /auth/invite-status shapes
 *   - groupless admin invite: no auto-email, invite URL returned, consumed
 *     (stamped accepted) at registration
 *   - the admin queue shows pending member invitations
 *   - approve endpoint auth + not-found shapes
 *
 * NOT covered here: registration landing on the waitlist, login-blocked,
 * promotion ordering, and the stale purge — those require a full cap, which
 * is global state shared with every parallel test file. They're covered by
 * the DB-fixture suite in services/waitlist.service.test.ts.
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const DEV_EMAIL = process.env["DEV_USERNAME"] ?? "";
const DEV_PASSWORD = process.env["DEV_PASSWORD"] ?? "";

const uid = Date.now();
const reasonEmail = `signup-reason-${uid}@test.local`;
const adminInviteEmail = `admin-invite-${uid}@test.local`;
const memberInviteEmail = `member-invite-${uid}@test.local`;

type QueueRowType = "waitlist" | "admin_invite" | "member_invite";

interface QueueRow {
  id: string;
  email: string;
  type: QueueRowType;
  reason: string | null;
  inviterEmail: string | null;
  verified: boolean;
  createdAt: string;
  invitePending: boolean;
}

let adminToken = "";
let adminInviteToken = "";

async function fetchQueue(): Promise<QueueRow[]> {
  const res = await fetch(`${BASE}/admin/waitlist`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; data: QueueRow[] };
  expect(body.ok).toBe(true);
  return body.data;
}

describe.skipIf(!BASE)("GET /auth/invite-status (public)", () => {
  it("reports an unknown token as invalid", async () => {
    const res = await fetch(`${BASE}/auth/invite-status?token=obviously-fake`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data?: { valid: boolean; canRegister: boolean } };
    expect(body.ok).toBe(true);
    expect(body.data?.valid).toBe(false);
    expect(body.data?.canRegister).toBe(false);
  });

  it("requires a token", async () => {
    const res = await fetch(`${BASE}/auth/invite-status`);
    expect(res.status).toBe(400);
  });
});

describe.skipIf(!BASE || !DEV_EMAIL || !DEV_PASSWORD)("signup queue + admin invite arc", () => {
  beforeAll(async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: DEV_EMAIL, password: DEV_PASSWORD }),
    });
    const json = (await res.json()) as { ok: boolean; data?: { token?: string } };
    if (!json.ok || !json.data?.token) {
      throw new Error("Admin login failed: " + JSON.stringify(json));
    }
    adminToken = json.data.token;
  });

  it("GET /admin/waitlist requires auth", async () => {
    const res = await fetch(`${BASE}/admin/waitlist`);
    expect(res.status).toBe(401);
  });

  it("register stores the optional signup reason; active accounts skip the queue", async () => {
    const reg = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: reasonEmail,
        password: "reason-test-password-123",
        reason: "Trying out the signup reason field",
        tosAccepted: true,
      }),
    });
    expect(reg.status).toBe(200);
    const regBody = (await reg.json()) as {
      ok: boolean;
      data?: { waitlisted?: boolean; verificationToken?: string };
    };
    expect(regBody.ok).toBe(true);
    // Cap is open in the test environment, so the account is active.
    expect(regBody.data?.waitlisted).toBe(false);
    expect(regBody.data?.verificationToken).toBeTruthy();

    // Reason + waitlist state are visible on the admin users list.
    const users = await fetch(`${BASE}/admin/users?q=${encodeURIComponent(reasonEmail)}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const usersBody = (await users.json()) as {
      data: { users: Array<{ email: string; signupReason: string | null; waitlistedAt: string | null }> };
    };
    const row = usersBody.data.users.find((u) => u.email === reasonEmail);
    expect(row).toBeDefined();
    expect(row!.signupReason).toBe("Trying out the signup reason field");
    expect(row!.waitlistedAt).toBeNull();

    // Active accounts are not in the signup queue.
    const queue = await fetchQueue();
    expect(queue.find((r) => r.email === reasonEmail)).toBeUndefined();
  });

  it("POST /admin/invite works with just an email, returns the URL, sends nothing", async () => {
    const res = await fetch(`${BASE}/admin/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ email: adminInviteEmail }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data?: { email: string; groupId: string | null; inviteUrl: string };
    };
    expect(body.ok).toBe(true);
    expect(body.data?.groupId).toBeNull();
    expect(body.data?.inviteUrl).toContain("/auth/register?invite=");
    adminInviteToken = body.data!.inviteUrl.split("invite=")[1]!;

    // Shows in the queue as a pending admin invite.
    const entry = (await fetchQueue()).find((row) => row.email === adminInviteEmail);
    expect(entry).toBeDefined();
    expect(entry!.type).toBe("admin_invite");
    expect(entry!.invitePending).toBe(true);

    // No invitation email was sent — the admin shares the link manually.
    const emails = await fetch(`${BASE}/admin/emails?q=${encodeURIComponent(adminInviteEmail)}&kind=invitation`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const emailsBody = (await emails.json()) as { data: { total: number } };
    expect(emailsBody.data.total).toBe(0);
  });

  it("GET /auth/invite-status reports the admin invite as registerable (bypass)", async () => {
    const res = await fetch(
      `${BASE}/auth/invite-status?token=${encodeURIComponent(adminInviteToken)}`,
    );
    const body = (await res.json()) as { ok: boolean; data?: { valid: boolean; canRegister: boolean } };
    expect(body.data?.valid).toBe(true);
    expect(body.data?.canRegister).toBe(true);
  });

  it("registering through the invite link consumes the groupless invitation", async () => {
    const reg = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: adminInviteEmail,
        password: "invite-arc-password-123",
        inviteToken: adminInviteToken,
        tosAccepted: true,
      }),
    });
    expect(reg.status).toBe(200);
    const regBody = (await reg.json()) as {
      ok: boolean;
      data?: { waitlisted?: boolean; verificationToken?: string };
    };
    expect(regBody.ok).toBe(true);
    expect(regBody.data?.waitlisted).toBe(false);
    expect(regBody.data?.verificationToken).toBeTruthy();

    // The verify response carries the waitlist flag (false here — active
    // account) so VerifyPage can pick its copy.
    const verify = await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: regBody.data!.verificationToken }),
    });
    const verifyBody = (await verify.json()) as { ok: boolean; data?: { waitlisted?: boolean } };
    expect(verifyBody.ok).toBe(true);
    expect(verifyBody.data?.waitlisted).toBe(false);

    // Groupless invitations are stamped accepted at registration (cap bypass
    // was their only job) — the token is no longer valid and the queue row
    // is gone (the email now belongs to a user record).
    const status = await fetch(
      `${BASE}/auth/invite-status?token=${encodeURIComponent(adminInviteToken)}`,
    );
    const statusBody = (await status.json()) as { ok: boolean; data?: { valid: boolean } };
    expect(statusBody.data?.valid).toBe(false);

    const queue = await fetchQueue();
    expect(queue.find((row) => row.email === adminInviteEmail)).toBeUndefined();
  });

  it("member invitations appear in the queue as member_invite with the inviter", async () => {
    const booksRes = await fetch(`${BASE}/recipe-books`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const booksBody = (await booksRes.json()) as { data: Array<{ id: string }> };
    const groupId = booksBody.data[0]?.id;
    expect(groupId).toBeTruthy();

    const inviteRes = await fetch(`${BASE}/recipe-books/${groupId}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ email: memberInviteEmail }),
    });
    expect(inviteRes.status).toBe(201);

    const entry = (await fetchQueue()).find((row) => row.email === memberInviteEmail);
    expect(entry).toBeDefined();
    expect(entry!.type).toBe("member_invite");
    expect(entry!.inviterEmail).toBe(DEV_EMAIL);
    expect(entry!.invitePending).toBe(true);
  });

  it("POST /admin/waitlist/:userId/approve returns 404 for a non-waitlisted user", async () => {
    const res = await fetch(`${BASE}/admin/waitlist/00000000-0000-0000-0000-000000000000/approve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(404);
  });

  it("approve requires auth", async () => {
    const res = await fetch(`${BASE}/admin/waitlist/00000000-0000-0000-0000-000000000000/approve`, {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });
});

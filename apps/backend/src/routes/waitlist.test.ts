import { describe, it, expect, beforeAll } from "vitest";

/**
 * Integration tests for the signup queue: public POST /auth/waitlist,
 * GET /auth/invite-status, the merged admin view, the notify action, the
 * groupless admin invite, and the email log. Requires running backend +
 * DEV_USERNAME/DEV_PASSWORD (system admin).
 *
 * Walks one email through the whole arc:
 *   waitlist signup → Waiting → notified (spot-open email, logged) →
 *   admin-invited (groupless bypass, no auto-email) → registered via the
 *   invite link → invitation consumed (stamped accepted at registration).
 *
 * Cap-boundary behavior (registration blocked at a full cap, reservation
 * exclusion) is not exercised here — the cap is global state shared with
 * every parallel test file, so closing it mid-run would flake the other
 * suites. The branch logic is unit-tested in system-settings.service.test.ts.
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const DEV_EMAIL = process.env["DEV_USERNAME"] ?? "";
const DEV_PASSWORD = process.env["DEV_PASSWORD"] ?? "";

const uid = Date.now();
const waitlistEmail = `waitlist-${uid}@test.local`;
const memberInviteEmail = `waitlist-member-${uid}@test.local`;

type QueueRowType = "waitlist" | "admin_invite" | "member_invite";

interface QueueRow {
  id: string;
  email: string;
  type: QueueRowType;
  reason: string | null;
  inviterEmail: string | null;
  invitedAt: string | null;
  notifiedAt: string | null;
  createdAt: string;
  registered: boolean;
  invitePending: boolean;
}

let adminToken = "";
let adminInviteToken = ""; // token from the admin invite URL
let waitlistRowId = "";

async function fetchQueue(): Promise<QueueRow[]> {
  const res = await fetch(`${BASE}/admin/waitlist`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; data: QueueRow[] };
  expect(body.ok).toBe(true);
  return body.data;
}

describe.skipIf(!BASE)("POST /auth/waitlist (public)", () => {
  it("accepts a valid email with reason", async () => {
    const res = await fetch(`${BASE}/auth/waitlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: waitlistEmail, reason: "Testing the waitlist flow" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data?: { message?: string } };
    expect(body.ok).toBe(true);
    expect(body.data?.message).toContain("waitlist");
  });

  it("returns an identical response for a duplicate email (no enumeration)", async () => {
    const res = await fetch(`${BASE}/auth/waitlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: waitlistEmail }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data?: { message?: string } };
    expect(body.ok).toBe(true);
    expect(body.data?.message).toContain("waitlist");
  });

  it("rejects an invalid email with 400", async () => {
    const res = await fetch(`${BASE}/auth/waitlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    });
    expect(res.status).toBe(400);
  });
});

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

describe.skipIf(!BASE || !DEV_EMAIL || !DEV_PASSWORD)("admin signup queue", () => {
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

  it("shows the waitlist signup as Waiting", async () => {
    const queue = await fetchQueue();
    const entry = queue.find((row) => row.email === waitlistEmail);
    expect(entry).toBeDefined();
    expect(entry!.type).toBe("waitlist");
    expect(entry!.reason).toBe("Testing the waitlist flow");
    expect(entry!.registered).toBe(false);
    expect(entry!.invitePending).toBe(false);
    expect(entry!.invitedAt).toBeNull();
    expect(entry!.notifiedAt).toBeNull();
    waitlistRowId = entry!.id;
  });

  it("POST /admin/waitlist/:id/notify sends the spot-open email and stamps notified_at", async () => {
    const res = await fetch(`${BASE}/admin/waitlist/${waitlistRowId}/notify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);

    const entry = (await fetchQueue()).find((row) => row.email === waitlistEmail);
    expect(entry!.notifiedAt).not.toBeNull();
  });

  it("GET /admin/emails logged the notification (metadata only)", async () => {
    const res = await fetch(`${BASE}/admin/emails?q=${encodeURIComponent(waitlistEmail)}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: Array<{ toEmail: string; kind: string; status: string; subject: string }>;
    };
    const row = body.data.find((r) => r.kind === "waitlist_spot_open");
    expect(row).toBeDefined();
    expect(row!.toEmail).toBe(waitlistEmail);
    expect(row!.status).toBe("sent");
  });

  it("POST /admin/invite works with just an email (no group, no auto-send) and returns the invite URL", async () => {
    const res = await fetch(`${BASE}/admin/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ email: waitlistEmail }),
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

    const entry = (await fetchQueue()).find((row) => row.email === waitlistEmail);
    expect(entry!.invitedAt).not.toBeNull();
    expect(entry!.invitePending).toBe(true);

    // No invitation email was sent — the admin shares the link manually.
    const emails = await fetch(`${BASE}/admin/emails?q=${encodeURIComponent(waitlistEmail)}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const emailsBody = (await emails.json()) as { data: Array<{ kind: string }> };
    expect(emailsBody.data.some((r) => r.kind === "invitation")).toBe(false);
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
        email: waitlistEmail,
        password: "waitlist-arc-password-123",
        inviteToken: adminInviteToken,
        tosAccepted: true,
      }),
    });
    expect(reg.status).toBe(200);
    const regBody = (await reg.json()) as { ok: boolean; data?: { verificationToken?: string } };
    expect(regBody.ok).toBe(true);
    // Dev-mode verificationToken proves the genuinely-new branch ran (a
    // cap-rejected or duplicate registration would omit it).
    const vtok = regBody.data?.verificationToken;
    expect(vtok).toBeTruthy();

    await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: vtok }),
    });

    // Groupless invitations are stamped accepted at registration (cap bypass
    // was their only job), so the invite no longer reads as pending and the
    // queue row shows the conversion.
    const entry = (await fetchQueue()).find((row) => row.email === waitlistEmail);
    expect(entry!.registered).toBe(true);
    expect(entry!.invitePending).toBe(false);

    // The consumed token is no longer valid for registration.
    const status = await fetch(
      `${BASE}/auth/invite-status?token=${encodeURIComponent(adminInviteToken)}`,
    );
    const statusBody = (await status.json()) as { ok: boolean; data?: { valid: boolean } };
    expect(statusBody.data?.valid).toBe(false);
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
});

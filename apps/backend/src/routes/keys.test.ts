import { describe, it, expect, beforeAll } from "vitest";

/**
 * Integration tests for /keys routes — requires running backend.
 * Skips if BACKEND_URL is not set.
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const uid = Date.now();

interface DailyKeyResponse {
  ok: boolean;
  data?: { key?: string };
}

interface BriefingResponse {
  ok: boolean;
  error?: string;
  data?: {
    text?: string;
    groups?: Array<{ slug: string; isDefault: boolean }>;
  };
}

let userToken = "";
let keyA = "";
let keyB = "";
let groupASlug = "";
let groupBSlug = "";

describe.skipIf(!BASE)("/keys briefing — F33 lookup-by-hashed-key", () => {
  beforeAll(async () => {
    const email = `keys-f33-${uid}@test.local`;
    const password = "f33-test-password-123";

    // Register + verify + log in (F30: register no longer auto-logs-in).
    const regRes = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, tosAccepted: true }),
    });
    const regBody = (await regRes.json()) as { data?: { verificationToken?: string } };
    const vtok = regBody.data?.verificationToken;
    if (!vtok) throw new Error("Setup: missing verificationToken (ALLOW_AUTO_SETUP must be true)");
    await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: vtok }),
    });
    const loginRes = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const loginBody = (await loginRes.json()) as { data?: { token?: string } };
    userToken = loginBody.data?.token ?? "";
    if (!userToken) throw new Error("Setup: failed to log in");

    // Look up the auto-created personal group + create a second group so the
    // user has two distinct group sets to differentiate the briefings.
    const groupsRes = await fetch(`${BASE}/recipe-books`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const groupsBody = (await groupsRes.json()) as {
      data: Array<{ id: string; slug: string; organization_id: string }>;
    };
    const personalGroup = groupsBody.data[0];
    if (!personalGroup) throw new Error("Setup: missing personal group");
    groupASlug = personalGroup.slug;
    const orgId = personalGroup.organization_id;

    const create = await fetch(`${BASE}/recipe-books`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({
        name: `F33 Group B ${uid}`,
        slug: `f33-b-${uid}`,
        organizationId: orgId,
        description: "Distinct group for F33 lookup test",
      }),
    });
    const created = (await create.json()) as { data?: { id: string; slug: string } };
    const groupBId = created.data?.id ?? "";
    groupBSlug = created.data?.slug ?? "";
    if (!groupBId) throw new Error("Setup: failed to create second group");

    // Key A: scoped to group A only (the personal group).
    const keyAExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const keyARes = await fetch(`${BASE}/keys/scoped`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({
        readRecipeBookIds: [personalGroup.id],
        writeRecipeBookIds: [personalGroup.id],
        defaultWriteRecipeBookId: personalGroup.id,
        expiresAt: keyAExpires,
        label: "F33 keyA",
      }),
    });
    const keyABody = (await keyARes.json()) as DailyKeyResponse;
    keyA = keyABody.data?.key ?? "";

    // Key B: scoped to group B only.
    const keyBRes = await fetch(`${BASE}/keys/scoped`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({
        readRecipeBookIds: [groupBId],
        writeRecipeBookIds: [groupBId],
        defaultWriteRecipeBookId: groupBId,
        expiresAt: keyAExpires,
        label: "F33 keyB",
      }),
    });
    const keyBBody = (await keyBRes.json()) as DailyKeyResponse;
    keyB = keyBBody.data?.key ?? "";

    if (!keyA || !keyB) throw new Error("Setup: failed to mint two scoped keys");
  });

  // F33: pre-fix the lookup ran on the 8-char key_prefix (cn_s_ + 3 random
  // base62 chars), which collided across the same user's keys and returned
  // a non-deterministic row via LIMIT 1. The hashed-key lookup deterministic-
  // ally selects the exact key, so the briefing's group set must reflect
  // *that* key — not a sibling key.
  it("F33: each scoped key's briefing returns its own group set (no prefix collision)", async () => {
    const briefA = await fetch(
      `${BASE}/keys/briefing?type=mcp&key=${encodeURIComponent(keyA)}`,
      { headers: { Authorization: `Bearer ${userToken}` } },
    );
    expect(briefA.status).toBe(200);
    const bodyA = (await briefA.json()) as BriefingResponse;
    expect(bodyA.ok).toBe(true);
    const slugsA = (bodyA.data?.groups ?? []).map((g) => g.slug);
    expect(slugsA).toContain(groupASlug);
    expect(slugsA).not.toContain(groupBSlug);

    const briefB = await fetch(
      `${BASE}/keys/briefing?type=mcp&key=${encodeURIComponent(keyB)}`,
      { headers: { Authorization: `Bearer ${userToken}` } },
    );
    expect(briefB.status).toBe(200);
    const bodyB = (await briefB.json()) as BriefingResponse;
    expect(bodyB.ok).toBe(true);
    const slugsB = (bodyB.data?.groups ?? []).map((g) => g.slug);
    expect(slugsB).toContain(groupBSlug);
    expect(slugsB).not.toContain(groupASlug);
  });

  it("F33: briefing 404s a key that doesn't belong to the authed user", async () => {
    // Register a second user; their keys must not be returnable via this user.
    const otherEmail = `keys-f33-other-${uid}@test.local`;
    const otherPassword = "f33-other-password-123";
    const reg = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: otherEmail, password: otherPassword, tosAccepted: true }),
    });
    const regBody = (await reg.json()) as { data?: { verificationToken?: string } };
    await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: regBody.data?.verificationToken }),
    });
    const otherLogin = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: otherEmail, password: otherPassword }),
    });
    const otherLoginBody = (await otherLogin.json()) as { data?: { token?: string } };
    const otherToken = otherLoginBody.data?.token ?? "";

    const otherKeyRes = await fetch(`${BASE}/keys/daily`, {
      method: "POST",
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    const otherKeyBody = (await otherKeyRes.json()) as DailyKeyResponse;
    const otherUsersKey = otherKeyBody.data?.key ?? "";
    expect(otherUsersKey).toBeTruthy();

    const cross = await fetch(
      `${BASE}/keys/briefing?type=mcp&key=${encodeURIComponent(otherUsersKey)}`,
      { headers: { Authorization: `Bearer ${userToken}` } },
    );
    expect(cross.status).toBe(404);
  });
});

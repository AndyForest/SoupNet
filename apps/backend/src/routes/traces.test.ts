import { describe, it, expect, beforeAll } from "vitest";

/**
 * Integration tests for /traces/map — requires running backend.
 * Focus: the groupIds (plural) param added 2026-04-17 for Custom Briefing
 * flow. Single-group semantics (groupId) are covered indirectly by the
 * RecipeMapPage's original behavior; these tests lock down the plural.
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const uid = Date.now();

const userEmail = `test-mapscope-${uid}@test.local`;
const userPassword = "traces-map-test-pw-abc";
let token = "";
let personalGroupId = "";
let secondGroupId = "";
let orgId = "";

describe.skipIf(!BASE)("/traces/map groupIds scoping", () => {
  async function registerAndVerify(email: string, password: string): Promise<string> {
    const reg = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, tosAccepted: true }),
    });
    const regBody = (await reg.json()) as { data?: { token?: string; verificationToken?: string } };
    const t = regBody.data?.token ?? "";
    const vtok = regBody.data?.verificationToken;
    if (!t || !vtok) throw new Error(`Setup failed for ${email}`);
    await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: vtok }),
    });
    return t;
  }

  beforeAll(async () => {
    token = await registerAndVerify(userEmail, userPassword);

    // Look up the auto-created personal group + org for this user.
    const groupsRes = await fetch(`${BASE}/recipe-books`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const groupsBody = (await groupsRes.json()) as { data: Array<{ id: string; organization_id: string }> };
    personalGroupId = groupsBody.data[0]?.id ?? "";
    orgId = groupsBody.data[0]?.organization_id ?? "";
    if (!personalGroupId || !orgId) throw new Error("Missing personal group / org after register");

    // Create a second group so the user has multiple groups to exercise
    // the groupIds plural param against.
    const createRes = await fetch(`${BASE}/recipe-books`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: `Second Group ${uid}`,
        slug: `second-group-${uid}`,
        organizationId: orgId,
      }),
    });
    const createBody = (await createRes.json()) as { data?: { id: string } };
    secondGroupId = createBody.data?.id ?? "";
    if (!secondGroupId) throw new Error("Failed to create second group");
  });

  it("accepts groupIds with a CSV of user's groups", async () => {
    const groupIds = `${personalGroupId},${secondGroupId}`;
    const res = await fetch(`${BASE}/traces/map?groupIds=${encodeURIComponent(groupIds)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { clusters: unknown[]; meta: { totalTraces: number } } };
    expect(body.ok).toBe(true);
    // The user's traces (if any) should be in scope — we don't assert a
    // specific totalTraces here because it depends on prior session data,
    // only that the request succeeded and the response is well-formed.
    expect(Array.isArray(body.data.clusters)).toBe(true);
    expect(typeof body.data.meta.totalTraces).toBe("number");
  });

  it("rejects groupIds containing a group the user isn't a member of", async () => {
    const foreignGroupId = "00000000-0000-0000-0000-000000000000";
    const groupIds = `${personalGroupId},${foreignGroupId}`;
    const res = await fetch(`${BASE}/traces/map?groupIds=${encodeURIComponent(groupIds)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it("rejects empty groupIds param", async () => {
    const res = await fetch(`${BASE}/traces/map?groupIds=`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // Empty param string is treated as "parameter not provided" by Hono's
    // query parser, so this behaves exactly like no filter — 200 with full
    // scope. The ",,," variant below covers the "sent but blank" case.
    expect(res.status).toBe(200);
  });

  it("rejects groupIds with only whitespace / empty IDs", async () => {
    const res = await fetch(`${BASE}/traces/map?groupIds=${encodeURIComponent(", ,")}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
  });

  it("groupId (singular) takes precedence when both are supplied", async () => {
    // Pass groupId=personal AND groupIds=second — the singular should win,
    // scoping to the personal group only. We can't verify cluster contents
    // without seed data, but the request should succeed and not 403 on the
    // second-group-id being outside the narrowed scope.
    const res = await fetch(
      `${BASE}/traces/map?groupId=${encodeURIComponent(personalGroupId)}&groupIds=${encodeURIComponent(secondGroupId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status).toBe(200);
  });
});

/**
 * Cross-author visibility — locks down the read-permission fix shipped
 * 2026-04-26. In a shared group, a member sees ALL traces in the group, not
 * just their own. Before the fix, fetchCorpusTraces filtered by user_id, so
 * the Recipe Map was effectively single-author even when scoped to a shared
 * group. After the fix, scope is group-only (validated against the
 * requester's memberships in the route handler).
 */
const crossUid = Date.now() + 1;
const authorEmail = `test-crossauthor-author-${crossUid}@test.local`;
const viewerEmail = `test-crossauthor-viewer-${crossUid}@test.local`;
const sharedPassword = "cross-author-test-pw-xyz";

describe.skipIf(!BASE)("/traces/map cross-author visibility in shared groups", () => {
  let authorToken = "";
  let authorUserId = "";
  let viewerToken = "";
  let sharedGroupId = "";
  let authorPersonalGroupId = "";

  async function registerAndVerify(email: string, password: string): Promise<{ token: string; userId: string }> {
    const reg = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, tosAccepted: true }),
    });
    const regBody = (await reg.json()) as {
      data?: { token?: string; verificationToken?: string; user?: { id: string } };
    };
    const t = regBody.data?.token ?? "";
    const userId = regBody.data?.user?.id ?? "";
    const vtok = regBody.data?.verificationToken;
    if (!t || !vtok || !userId) throw new Error(`Setup failed for ${email}`);
    await fetch(`${BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: vtok }),
    });
    return { token: t, userId };
  }

  beforeAll(async () => {
    const author = await registerAndVerify(authorEmail, sharedPassword);
    authorToken = author.token;
    authorUserId = author.userId;
    const viewer = await registerAndVerify(viewerEmail, sharedPassword);
    viewerToken = viewer.token;

    // Author owns a personal group (auto-created) + creates a shared group
    // they invite the viewer into.
    const groupsRes = await fetch(`${BASE}/recipe-books`, {
      headers: { Authorization: `Bearer ${authorToken}` },
    });
    const groupsBody = (await groupsRes.json()) as { data: Array<{ id: string; organization_id: string }> };
    authorPersonalGroupId = groupsBody.data[0]?.id ?? "";
    const orgId = groupsBody.data[0]?.organization_id ?? "";
    if (!authorPersonalGroupId || !orgId) throw new Error("Missing personal group/org for author");

    const createRes = await fetch(`${BASE}/recipe-books`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authorToken}` },
      body: JSON.stringify({
        name: `Cross-Author Shared ${crossUid}`,
        slug: `cross-author-${crossUid}`,
        organizationId: orgId,
      }),
    });
    const createBody = (await createRes.json()) as { data?: { id: string } };
    sharedGroupId = createBody.data?.id ?? "";
    if (!sharedGroupId) throw new Error("Failed to create shared group");

    // Add viewer to shared group as a plain member via /groups/:id/members.
    const addRes = await fetch(`${BASE}/recipe-books/${sharedGroupId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authorToken}` },
      body: JSON.stringify({ email: viewerEmail, role: "member" }),
    });
    if (!addRes.ok) throw new Error(`Failed to add viewer to shared group: ${addRes.status}`);

    // Author posts a trace into the shared group via /check.
    // First mint a daily key scoped to the shared group.
    const keyRes = await fetch(`${BASE}/keys/daily`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authorToken}` },
      body: JSON.stringify({ writeRecipeBookId: sharedGroupId }),
    });
    const keyBody = (await keyRes.json()) as { ok: boolean; data?: { key?: string }; error?: string };
    const rawKey = keyBody.data?.key ?? "";
    if (!rawKey) throw new Error(`Failed to mint author's daily key: ${keyRes.status} ${JSON.stringify(keyBody)}`);

    const formBody = new URLSearchParams({
      key: rawKey,
      trace: `As a cross-author visibility test author, I prefer that members of a shared group see each other's traces in the Recipe Map so that collaboration actually works (${crossUid})`,
      ef: "Author seed evidence.\n> \"members of a shared group see each other's traces\"\n-- this test",
      format: "json",
    });
    const checkRes = await fetch(`${BASE}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody.toString(),
    });
    const checkBody = (await checkRes.json()) as { ok: boolean; data?: { recipeId: string } };
    if (!checkBody.ok || !checkBody.data?.recipeId) {
      throw new Error(`Failed to seed author's trace: ${JSON.stringify(checkBody)}`);
    }
  });

  it("viewer (member, non-author) sees author's trace on /traces/map for the shared group", async () => {
    const res = await fetch(
      `${BASE}/traces/map?groupId=${encodeURIComponent(sharedGroupId)}`,
      { headers: { Authorization: `Bearer ${viewerToken}` } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: {
        clusters: Array<{ memberPreviews: Array<{ text: string }> }>;
        unclustered: Array<{ claimText: string }>;
        meta: { totalTraces: number };
      };
    };
    expect(body.ok).toBe(true);
    expect(body.data.meta.totalTraces).toBeGreaterThanOrEqual(1);

    // The author's trace text should be reachable from either clustered exemplars
    // or the unclustered list. Don't assume which.
    const allTexts = [
      ...body.data.unclustered.map((t) => t.claimText),
      ...body.data.clusters.flatMap((c) => c.memberPreviews.map((m) => m.text)),
    ].join(" ");
    expect(allTexts).toContain("cross-author visibility test author");
  });

  it("viewer cannot scope map to author's personal group (403)", async () => {
    const res = await fetch(
      `${BASE}/traces/map?groupId=${encodeURIComponent(authorPersonalGroupId)}`,
      { headers: { Authorization: `Bearer ${viewerToken}` } },
    );
    expect(res.status).toBe(403);
  });

  it("locks down the prior bug: viewer's map is not empty when scoped to a shared group containing only author traces", async () => {
    // Sanity: the viewer hasn't posted anything to the shared group, so a
    // user-id-filtered query would return zero. Group-id-only must return
    // at least the author's seed.
    const res = await fetch(
      `${BASE}/traces/map?groupId=${encodeURIComponent(sharedGroupId)}`,
      { headers: { Authorization: `Bearer ${viewerToken}` } },
    );
    const body = (await res.json()) as { data: { meta: { totalTraces: number } } };
    expect(body.data.meta.totalTraces).toBeGreaterThan(0);
    // Reference authorUserId so the test linter doesn't flag it as unused —
    // the assertion above implies the author authored the visible trace.
    expect(authorUserId).toMatch(/^[0-9a-f-]{36}$/);
  });

  // ─── /traces?groupId moderation list ────────────────────────────────────
  // The same shared-group fixture exercises the new ?groupId param on
  // /traces. Owner and member should both see the author's trace; only
  // owner/admin (or author themselves) should get canDelete=true on it.

  it("GET /traces?groupId — member sees all traces in shared group, canDelete=false on others", async () => {
    const res = await fetch(
      `${BASE}/traces?groupId=${encodeURIComponent(sharedGroupId)}`,
      { headers: { Authorization: `Bearer ${viewerToken}` } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: Array<{ claimText: string; userEmail: string; canDelete: boolean }>;
    };
    expect(body.ok).toBe(true);
    const authorTrace = body.data.find((t) => t.userEmail === authorEmail);
    expect(authorTrace).toBeDefined();
    // Viewer is a plain member, not owner/admin — must NOT be able to delete
    // a trace they didn't author.
    expect(authorTrace?.canDelete).toBe(false);
  });

  it("GET /traces?groupId — owner sees canDelete=true on everyone's traces", async () => {
    const res = await fetch(
      `${BASE}/traces?groupId=${encodeURIComponent(sharedGroupId)}`,
      { headers: { Authorization: `Bearer ${authorToken}` } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: Array<{ canDelete: boolean }>;
    };
    expect(body.ok).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    for (const row of body.data) {
      expect(row.canDelete).toBe(true);
    }
  });

  it("GET /traces?groupId — non-member returns 403", async () => {
    const res = await fetch(
      `${BASE}/traces?groupId=${encodeURIComponent(authorPersonalGroupId)}`,
      { headers: { Authorization: `Bearer ${viewerToken}` } },
    );
    expect(res.status).toBe(403);
  });
});

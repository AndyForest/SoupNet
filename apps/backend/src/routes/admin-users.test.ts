import { describe, it, expect, beforeAll } from "vitest";

/**
 * Integration tests for /admin/users and /admin/stats.
 * Requires running backend + DEV_USERNAME/DEV_PASSWORD (system admin).
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const DEV_EMAIL = process.env["DEV_USERNAME"] ?? "";
const DEV_PASSWORD = process.env["DEV_PASSWORD"] ?? "";

interface LoginResponse {
  ok: boolean;
  data?: { token?: string; user?: { id: string; email: string; role: string } };
}

interface UsersListResponse {
  ok: boolean;
  data?: {
    users: Array<{
      id: string;
      email: string;
      role: string;
      emailVerifiedAt: string | null;
      premiumAt: string | null;
      lastLoginAt: string | null;
      activeKeyCount: number;
      recipeCount: number;
      groupCount: number;
    }>;
    total: number;
    limit: number;
    offset: number;
  };
  error?: string;
}

interface StatsResponse {
  ok: boolean;
  data?: {
    totalUsers: number;
    verifiedUsers: number;
    activeApiKeys: number;
    signupCap: number;
  };
  error?: string;
}

let adminToken = "";
let adminUserId = "";
let tenantToken = "";
const tenantEmail = `admin-users-tenant-${Date.now()}@test.local`;
const tenantPassword = "integration-test-password-123";

describe.skipIf(!BASE || !DEV_EMAIL || !DEV_PASSWORD)("/admin/users + /admin/stats", () => {
  beforeAll(async () => {
    // Admin login
    const adminRes = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: DEV_EMAIL, password: DEV_PASSWORD }),
    });
    const adminJson = (await adminRes.json()) as LoginResponse;
    if (!adminJson.ok || !adminJson.data?.token) {
      throw new Error("Admin login failed: " + JSON.stringify(adminJson));
    }
    adminToken = adminJson.data.token;
    adminUserId = adminJson.data.user?.id ?? "";

    // Create a non-admin tenant to exercise the role gate
    await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: tenantEmail, password: tenantPassword, tosAccepted: true }),
    });
    const tenantLoginRes = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: tenantEmail, password: tenantPassword }),
    });
    const tenantJson = (await tenantLoginRes.json()) as LoginResponse;
    tenantToken = tenantJson.data?.token ?? "";
  });

  it("GET /admin/users requires auth", async () => {
    const res = await fetch(`${BASE}/admin/users`);
    expect(res.status).toBe(401);
  });

  it("GET /admin/users forbids non-system tenants", async () => {
    if (!tenantToken) return; // tenant may be unverified; the gate still blocks at verify step
    const res = await fetch(`${BASE}/admin/users`, {
      headers: { Authorization: `Bearer ${tenantToken}` },
    });
    expect([401, 403]).toContain(res.status);
  });

  it("GET /admin/users returns paginated shape for system admin", async () => {
    const res = await fetch(`${BASE}/admin/users?limit=5`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UsersListResponse;
    expect(body.ok).toBe(true);
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data!.users)).toBe(true);
    expect(typeof body.data!.total).toBe("number");
    expect(body.data!.limit).toBe(5);
    expect(body.data!.offset).toBe(0);
    // Every row should carry the derived counts.
    for (const u of body.data!.users) {
      expect(typeof u.activeKeyCount).toBe("number");
      expect(typeof u.recipeCount).toBe("number");
      expect(typeof u.groupCount).toBe("number");
    }
  });

  it("GET /admin/users applies email search filter", async () => {
    // Admin should match themselves via email substring
    const needle = DEV_EMAIL.split("@")[0]!.slice(0, 4);
    const res = await fetch(`${BASE}/admin/users?q=${encodeURIComponent(needle)}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UsersListResponse;
    expect(body.ok).toBe(true);
    expect(body.data!.users.some((u) => u.email === DEV_EMAIL)).toBe(true);
  });

  it("GET /admin/users verified=yes only returns verified users", async () => {
    const res = await fetch(`${BASE}/admin/users?verified=yes`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UsersListResponse;
    expect(body.ok).toBe(true);
    for (const u of body.data!.users) {
      expect(u.emailVerifiedAt).not.toBeNull();
    }
  });

  it("GET /admin/users sorts by email asc", async () => {
    const res = await fetch(`${BASE}/admin/users?sortBy=email&sortDir=asc&limit=20`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UsersListResponse;
    const emails = body.data!.users.map((u) => u.email);
    const sorted = [...emails].sort();
    expect(emails).toEqual(sorted);
  });

  // ── PUT /admin/users/:userId/premium ──────────────────────────────────────

  it("PUT /admin/users/:userId/premium requires auth", async () => {
    const res = await fetch(`${BASE}/admin/users/${adminUserId}/premium`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ premium: true }),
    });
    expect(res.status).toBe(401);
  });

  it("PUT /admin/users/:userId/premium forbids non-system tenants", async () => {
    if (!tenantToken) return; // tenant may be unverified; the gate still blocks at verify step
    const res = await fetch(`${BASE}/admin/users/${adminUserId}/premium`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${tenantToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ premium: true }),
    });
    expect([401, 403]).toContain(res.status);
  });

  it("PUT /admin/users/:userId/premium rejects a non-boolean body with 400", async () => {
    const res = await fetch(`${BASE}/admin/users/${adminUserId}/premium`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ premium: "yes" }),
    });
    expect(res.status).toBe(400);
  });

  it("PUT /admin/users/:userId/premium 404s for an unknown user", async () => {
    const res = await fetch(`${BASE}/admin/users/00000000-0000-0000-0000-000000000000/premium`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ premium: true }),
    });
    expect(res.status).toBe(404);
  });

  it("system admin can set and unset premium; GET /admin/users reflects it", async () => {
    // Grant premium on the admin's own account, then verify the list + filter.
    const grant = await fetch(`${BASE}/admin/users/${adminUserId}/premium`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ premium: true }),
    });
    expect(grant.status).toBe(200);
    const grantBody = (await grant.json()) as { ok: boolean; data?: { premium: boolean } };
    expect(grantBody.ok).toBe(true);
    expect(grantBody.data?.premium).toBe(true);

    const listPremium = await fetch(`${BASE}/admin/users?premium=yes&limit=200`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const listPremiumBody = (await listPremium.json()) as UsersListResponse;
    const adminRow = listPremiumBody.data!.users.find((u) => u.id === adminUserId);
    expect(adminRow).toBeDefined();
    expect(adminRow!.premiumAt).not.toBeNull();

    // Revoke and confirm the row drops out of the premium filter.
    const revoke = await fetch(`${BASE}/admin/users/${adminUserId}/premium`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ premium: false }),
    });
    expect(revoke.status).toBe(200);

    const listAfter = await fetch(`${BASE}/admin/users?premium=yes&limit=200`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const listAfterBody = (await listAfter.json()) as UsersListResponse;
    expect(listAfterBody.data!.users.some((u) => u.id === adminUserId)).toBe(false);
  });

  it("GET /admin/stats returns required fields", async () => {
    const res = await fetch(`${BASE}/admin/stats`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as StatsResponse;
    expect(body.ok).toBe(true);
    expect(typeof body.data!.totalUsers).toBe("number");
    expect(typeof body.data!.verifiedUsers).toBe("number");
    expect(typeof body.data!.activeApiKeys).toBe("number");
    expect(typeof body.data!.signupCap).toBe("number");
    expect(body.data!.totalUsers).toBeGreaterThanOrEqual(1);
  });

  it("GET /admin/stats requires auth", async () => {
    const res = await fetch(`${BASE}/admin/stats`);
    expect(res.status).toBe(401);
  });
});

import { describe, it, expect } from "vitest";
import {
  ADMIN_USER_COLUMNS,
  ADMIN_USER_STATUS_LABELS,
  adminUserStatus,
  columnKeysFor,
  columnsFor,
  memberVisibleDescriptions,
} from "./admin-columns";

// What GET /admin/users returned before the shared service (CN-G3 keeps it).
const SITE_ALL_USERS_BEFORE = [
  "id",
  "email",
  "role",
  "emailVerifiedAt",
  "suspendedAt",
  "suspendedReason",
  "waitlistedAt",
  "premiumAt",
  "signupReason",
  "lastLoginAt",
  "createdAt",
  "activeKeyCount",
  "recipeCount",
  "groupCount",
];

describe("columnsFor", () => {
  // Pinned exactly: a column added to the org set has to be added here on
  // purpose, and the member's page changes with it.
  it("gives an org admin exactly these columns for their members", () => {
    expect(columnKeysFor("org", "organization").sort()).toEqual(
      [
        "id",
        "email",
        "displayName",
        "status",
        "lastActiveAt",
        "recipeCount",
        "activeKeyCount",
        "orgRole",
        "joinedVia",
        "joinedAt",
        "privateBookCount",
        "orgWideBookCount",
      ].sort(),
    );
  });

  it("keeps everything the site users list returned before, and adds the organization", () => {
    const keys = columnKeysFor("site", "all");
    for (const key of SITE_ALL_USERS_BEFORE) expect(keys).toContain(key);
    expect(keys).toContain("organization");
  });

  it("leaves membership columns off the all-accounts listing", () => {
    const keys = columnKeysFor("site", "all");
    for (const key of ["orgRole", "joinedVia", "joinedAt", "privateBookCount", "orgWideBookCount"]) {
      expect(keys).not.toContain(key);
    }
  });

  it("makes the org admin's set a strict subset of what the site operator sees for the same organization", () => {
    const org = columnKeysFor("org", "organization");
    const site = columnKeysFor("site", "organization");
    for (const key of org) expect(site).toContain(key);
    expect(site.length).toBeGreaterThan(org.length);
  });

  it("never gives an org admin a site-only column", () => {
    const org = columnKeysFor("org", "organization");
    for (const key of [
      "role",
      "organization",
      "suspendedReason",
      "signupReason",
      "premiumAt",
      "waitlistedAt",
      "suspendedAt",
      "emailVerifiedAt",
      "lastLoginAt",
      "groupCount",
    ]) {
      expect(org).not.toContain(key);
    }
  });

  // Aggregates only (57fc1eee): no column names a book, and none describes a
  // key beyond its count (audit expectation 4: never a label, prefix or scope).
  it("has no column that could carry a book name or a key's details", () => {
    for (const key of columnKeysFor("site", "organization")) {
      expect(key).not.toMatch(/book(name|slug|s$)|^books?$|keyLabel|keyPrefix|keyScope|readGroup|writeGroup/i);
    }
  });

  it("returns nothing when an org admin asks for every account", () => {
    expect(columnsFor("org", "all")).toEqual([]);
  });

  it("has unique keys", () => {
    const keys = ADMIN_USER_COLUMNS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("memberVisibleDescriptions", () => {
  it("describes every column an org admin sees, one sentence each", () => {
    const descriptions = memberVisibleDescriptions();
    expect(descriptions).toHaveLength(columnsFor("org", "organization").length);
    for (const d of descriptions) expect(d.length).toBeGreaterThan(0);
  });

  it("says plainly that private books are counted, not named", () => {
    expect(memberVisibleDescriptions().join(" ")).toMatch(/never their names or contents/);
  });
});

describe("adminUserStatus", () => {
  it("is active with neither stamp", () => {
    expect(adminUserStatus({ suspendedAt: null, orgDisabledAt: null })).toBe("active");
  });

  it("is disabled when the organization disabled the account", () => {
    expect(adminUserStatus({ suspendedAt: null, orgDisabledAt: "2026-10-26T00:00:00Z" })).toBe("disabled");
  });

  // An org admin's re-enable can't lift a site suspension (85a7b2e8), so the
  // suspension is what both consoles show.
  it("is suspended when the site suspended it, whatever the organization says", () => {
    expect(adminUserStatus({ suspendedAt: "2026-10-26T00:00:00Z", orgDisabledAt: null })).toBe("suspended");
    expect(adminUserStatus({ suspendedAt: "2026-10-26T00:00:00Z", orgDisabledAt: "2026-10-26T00:00:00Z" })).toBe(
      "suspended",
    );
  });

  it("names the cause in each label", () => {
    expect(ADMIN_USER_STATUS_LABELS.disabled).toMatch(/organization/);
    expect(ADMIN_USER_STATUS_LABELS.suspended).toMatch(/Soup\.net/);
  });
});

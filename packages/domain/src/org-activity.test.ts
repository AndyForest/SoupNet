import { describe, it, expect } from "vitest";
import {
  DELETED_ACTOR_LABEL,
  DOMAIN_ACTOR_LABEL,
  ORG_ACTIVITY_ACTIONS,
  SOUPNET_ACTOR_LABEL,
  orgActivityActionsFor,
  orgActivityEvent,
} from "./org-activity";

const at = "2026-10-26T12:00:00.000Z";

describe("the allowlist", () => {
  // Pinned exactly (audit expectation 1): an action reaches an org admin only
  // by being added here on purpose.
  it("shows an organization exactly the org-admin actions", () => {
    expect(orgActivityActionsFor("org").sort()).toEqual(
      [
        "organization.member_joined",
        "organization.member_disable",
        "organization.member_enable",
        "organization.member_set_role",
        "organization.sharing_changed",
        "organization.member_directory_status",
        "organization.directory_connected",
        "organization.directory_connect_failed",
        "organization.directory_disconnected",
        "organization.directory_deletions_noticed",
      ].sort(),
    );
  });

  it("shows a member the actions that touched their account, a site suspension included", () => {
    expect(orgActivityActionsFor("member").sort()).toEqual(
      [
        "organization.member_joined",
        "organization.member_disable",
        "organization.member_enable",
        "organization.member_set_role",
        "user.suspended",
        "user.unsuspended",
        "organization.member_directory_status",
      ].sort(),
    );
  });

  it("never names a member's own activity", () => {
    for (const name of Object.keys(ORG_ACTIVITY_ACTIONS)) {
      expect(name).not.toMatch(/^(recipe|check|search|intent|feedback|trace|auth)\./);
    }
  });
});

describe("orgActivityEvent", () => {
  it("drops an action that isn't on the list", () => {
    expect(orgActivityEvent({ action: "recipe.checked", actorEmail: "max@acme.example", targetEmail: null, at })).toBeNull();
    expect(orgActivityEvent({ action: "recipe_book.moved_into_organization", actorEmail: null, targetEmail: null, at })).toBeNull();
  });

  it("names the person who acted", () => {
    expect(
      orgActivityEvent({ action: "organization.member_disable", actorEmail: "ada@acme.example", targetEmail: "max@acme.example", at }),
    ).toEqual({ kind: "disabled", actor: "ada@acme.example", target: "max@acme.example", at });
  });

  // Verification note 2: the operator's address never reaches the org admin.
  it("shows the site operator as Soup.net, never their address", () => {
    expect(
      orgActivityEvent({ action: "organization.member_joined", actorEmail: "sys@soup.example", targetEmail: "max@acme.example", at, joinAuthority: "operator" })?.actor,
    ).toBe(SOUPNET_ACTOR_LABEL);
    expect(orgActivityEvent({ action: "user.suspended", actorEmail: "sys@soup.example", targetEmail: "max@acme.example", at })?.actor).toBe(
      SOUPNET_ACTOR_LABEL,
    );
  });

  it("shows a join on a verified domain as the domain", () => {
    expect(
      orgActivityEvent({ action: "organization.member_joined", actorEmail: null, targetEmail: "new@acme.example", at, joinAuthority: "domain" })?.actor,
    ).toBe(DOMAIN_ACTOR_LABEL);
  });

  it("says so when the person who acted has deleted their account", () => {
    expect(orgActivityEvent({ action: "organization.member_enable", actorEmail: null, targetEmail: null, at })?.actor).toBe(DELETED_ACTOR_LABEL);
  });

  it("carries a role change's new role, and only a real role", () => {
    expect(
      orgActivityEvent({ action: "organization.member_set_role", actorEmail: "olive@acme.example", targetEmail: "ada@acme.example", at, newRole: "admin" }),
    ).toEqual({ kind: "role_changed", actor: "olive@acme.example", target: "ada@acme.example", at, role: "admin" });
    expect(
      orgActivityEvent({ action: "organization.member_set_role", actorEmail: "olive@acme.example", targetEmail: "ada@acme.example", at, newRole: "<script>" }),
    ).not.toHaveProperty("role");
  });

  it("reads a directory status only from the closed set, and shows Google Workspace as the actor", () => {
    const base = { action: "organization.member_directory_status", actorEmail: null, targetEmail: "max@acme.example", at: "2026-11-02T00:00:00.000Z" };
    expect(orgActivityEvent({ ...base, directoryTo: "suspended" })).toMatchObject({ kind: "directory_status", actor: "Google Workspace", directoryStatus: "suspended" });
    expect(orgActivityEvent({ ...base, directoryTo: null })).toMatchObject({ directoryStatus: null });
    expect(orgActivityEvent({ ...base, directoryTo: "<b>made up</b>" })).not.toHaveProperty("directoryStatus");
  });

  it("shows the site operator's disconnect as Soup.net, and an org admin's as themselves", () => {
    const row = { action: "organization.directory_disconnected", actorEmail: "root@soup.example", targetEmail: null, at: "2026-11-02T00:00:00.000Z" };
    expect(orgActivityEvent({ ...row, byOperator: true })?.actor).toBe(SOUPNET_ACTOR_LABEL);
    expect(orgActivityEvent({ ...row, byOperator: false })?.actor).toBe("root@soup.example");
  });

  it("credits a burst of removals to Soup.net, with its count only when it is a count", () => {
    const row = { action: "organization.directory_deletions_noticed", actorEmail: null, targetEmail: null, at: "2026-11-02T00:00:00.000Z" };
    expect(orgActivityEvent({ ...row, removedCount: "4" })).toMatchObject({ kind: "directory_deletions_noticed", actor: SOUPNET_ACTOR_LABEL, removedCount: 4 });
    expect(orgActivityEvent({ ...row, removedCount: "<b>many</b>" })).not.toHaveProperty("removedCount");
  });

  it("gives a connection its kind, domain and cleared numbers, and a failure's reason only from admin consent", () => {
    const base = { actorEmail: "ada@acme.example", targetEmail: null, at: "2026-11-02T00:00:00.000Z" };
    const failed = { ...base, action: "organization.directory_connect_failed", connectionDomain: "acme.example" };
    expect(orgActivityEvent({ ...failed, connectionKind: "admin_consent", connectFailure: "directory_not_admin" })).toMatchObject({ connectFailure: "directory_not_admin", domain: "acme.example" });
    expect(orgActivityEvent({ ...failed, connectionKind: "admin_consent", connectFailure: "directory_not_manager" })).toMatchObject({ connectFailure: "directory_not_manager" });
    // A service account's reason comes from Google's answer, so it is never shown.
    expect(orgActivityEvent({ ...failed, connectionKind: "service_account", connectFailure: "directory_not_admin" })).not.toHaveProperty("connectFailure");
    expect(orgActivityEvent({ ...failed, connectionKind: "admin_consent", connectFailure: "http_403: secret detail" })).not.toHaveProperty("connectFailure");

    const gone = { ...base, action: "organization.directory_disconnected" };
    expect(orgActivityEvent({ ...gone, cleared: { suspended: "2", archived: "0", deleted: 1 } })).toMatchObject({ cleared: { suspended: 2, archived: 0, deleted: 1 } });
    expect(orgActivityEvent({ ...gone, cleared: { suspended: "0", archived: null, deleted: "not a number" } })).not.toHaveProperty("cleared");
    expect(orgActivityEvent({ ...gone, connectionDomain: "acme.example", connectionKind: "admin_consent" })).not.toHaveProperty("domain");
  });

  it("never carries a role on any other event", () => {
    expect(
      orgActivityEvent({ action: "organization.member_disable", actorEmail: "ada@acme.example", targetEmail: "max@acme.example", at, newRole: "owner" }),
    ).not.toHaveProperty("role");
  });
});

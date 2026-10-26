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

  it("never carries a role on any other event", () => {
    expect(
      orgActivityEvent({ action: "organization.member_disable", actorEmail: "ada@acme.example", targetEmail: "max@acme.example", at, newRole: "owner" }),
    ).not.toHaveProperty("role");
  });
});

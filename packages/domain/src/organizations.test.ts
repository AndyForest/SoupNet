import { describe, expect, it } from "vitest";
import {
  bookSlugTakenMessage,
  ACCOUNT_DISABLED_MESSAGE,
  ACCOUNT_SUSPENDED_MESSAGE,
  MANAGED_KEY_MAX_DAYS,
  ORG_ACTION_MESSAGES,
  SCOPED_KEY_MAX_DAYS,
  bookRoleForOrgRole,
  emailChangeAllowed,
  emailDomain,
  hasFreeSeat,
  isOrgManager,
  isOrgRole,
  keyLifetimeCapMessage,
  orgActionRefusal,
  organizationJoinNotice,
  scopedKeyMaxDays,
  slugForMovedBook,
} from "./organizations";

describe("org roles", () => {
  it("recognizes exactly the three roles", () => {
    expect(["owner", "admin", "member"].every(isOrgRole)).toBe(true);
    expect(isOrgRole("guest")).toBe(false);
    expect(isOrgRole(undefined)).toBe(false);
    expect(isOrgRole(3)).toBe(false);
  });

  it("owners and admins manage; anything else fails closed", () => {
    expect(isOrgManager("owner")).toBe(true);
    expect(isOrgManager("admin")).toBe(true);
    expect(isOrgManager("member")).toBe(false);
    expect(isOrgManager("superadmin")).toBe(false);
    expect(isOrgManager(null)).toBe(false);
  });

  it("org owners and admins hold an org-wide book's admin role, members its member role", () => {
    expect(bookRoleForOrgRole("owner")).toBe("admin");
    expect(bookRoleForOrgRole("admin")).toBe("admin");
    expect(bookRoleForOrgRole("member")).toBe("member");
  });
});

describe("orgActionRefusal (OC-R2)", () => {
  const disable = { kind: "disable" } as const;

  it("a member, or a non-member, can't act", () => {
    expect(orgActionRefusal("member", "member", disable, false)).toBe("not_a_manager");
    expect(orgActionRefusal(null, "member", disable, false)).toBe("not_a_manager");
  });

  it("nobody acts on themselves, owners included", () => {
    expect(orgActionRefusal("owner", "owner", disable, true)).toBe("cannot_act_on_self");
    expect(orgActionRefusal("admin", "admin", { kind: "set_role", role: "member" }, true)).toBe("cannot_act_on_self");
  });

  it("an owner can do anything else", () => {
    expect(orgActionRefusal("owner", "owner", disable, false)).toBeNull();
    expect(orgActionRefusal("owner", "member", { kind: "set_role", role: "owner" }, false)).toBeNull();
  });

  it("an admin can't act on an owner or make one", () => {
    expect(orgActionRefusal("admin", "owner", { kind: "enable" }, false)).toBe("owner_only");
    expect(orgActionRefusal("admin", "member", { kind: "set_role", role: "owner" }, false)).toBe("owner_only");
  });

  it("an admin manages members and admins otherwise", () => {
    expect(orgActionRefusal("admin", "member", disable, false)).toBeNull();
    expect(orgActionRefusal("admin", "admin", { kind: "set_role", role: "member" }, false)).toBeNull();
    expect(orgActionRefusal("admin", "member", { kind: "set_role", role: "admin" }, false)).toBeNull();
  });

  it("every refusal has copy", () => {
    for (const message of Object.values(ORG_ACTION_MESSAGES)) expect(message.length).toBeGreaterThan(10);
  });
});

describe("seats and the key cap", () => {
  it("no limit always has a seat; otherwise only active members count", () => {
    expect(hasFreeSeat(null, 10_000)).toBe(true);
    expect(hasFreeSeat(3, 2)).toBe(true);
    expect(hasFreeSeat(3, 3)).toBe(false);
  });

  it("managed accounts cap scoped keys at 90 days, others at a year", () => {
    expect(MANAGED_KEY_MAX_DAYS).toBe(90);
    expect(scopedKeyMaxDays(true)).toBe(90);
    expect(scopedKeyMaxDays(false)).toBe(SCOPED_KEY_MAX_DAYS);
    expect(keyLifetimeCapMessage(90)).toContain("at most 90 days");
  });
});

describe("slugForMovedBook (OC-J2)", () => {
  it("keeps the slug when it is free", () => {
    expect(slugForMovedBook("personal", "max", new Set(["acme"]))).toBe("personal");
  });

  it("appends the email's local part on a collision, then numbers", () => {
    expect(slugForMovedBook("personal", "Max.Smith", new Set(["personal"]))).toBe("personal-max-smith");
    expect(slugForMovedBook("personal", "max", new Set(["personal", "personal-max"]))).toBe("personal-max-2");
    expect(slugForMovedBook("personal", "max", new Set(["personal", "personal-max", "personal-max-2"]))).toBe("personal-max-3");
  });

  it("falls back to 'member' for a local part with nothing usable, and stays within the slug limit", () => {
    expect(slugForMovedBook("personal", "+++", new Set(["personal"]))).toBe("personal-member");
    const long = "a".repeat(100);
    const out = slugForMovedBook(long, "max", new Set([long]));
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("emailChangeAllowed (program §3.4)", () => {
  it("a managed account keeps its domain; a personal one changes freely", () => {
    expect(emailChangeAllowed(true, "max@acme.example", "m.smith@ACME.example")).toBe(true);
    expect(emailChangeAllowed(true, "max@acme.example", "max@gmail.example")).toBe(false);
    expect(emailChangeAllowed(false, "gus@acme.example", "gus@gmail.example")).toBe(true);
    expect(emailDomain("no-at-sign")).toBe("");
  });
});

describe("copy", () => {
  it("the refusals say the cause and the next step", () => {
    expect(ACCOUNT_DISABLED_MESSAGE).toContain("Ask one of its admins");
    expect(ACCOUNT_SUSPENDED_MESSAGE).toContain("suspended");
  });

  it("a taken slug's message says whose space it was taken in", () => {
    expect(bookSlugTakenMessage("plans", true)).toBe('Another recipe book in this organization already uses the short name "plans". Choose a different name.');
    expect(bookSlugTakenMessage("plans", false)).toBe('You already have a recipe book with the short name "plans". Choose a different name.');
  });

  it("the join notice names the organization and each moved book, and a changed slug", () => {
    const notice = organizationJoinNotice("Acme", [
      { name: "Personal", slug: "personal-max", previousSlug: "personal" },
      { name: "Recipes", slug: "recipes", previousSlug: "recipes" },
    ]);
    expect(notice.subject).toBe("Your Soup.net account joined Acme");
    expect(notice.text).toContain("now part of Acme");
    expect(notice.text).toContain("- Personal (its short name changed from personal to personal-max)");
    expect(notice.text).toContain("- Recipes\n");
    expect(notice.text).not.toContain("http");
    expect(notice.text).toContain("An agent that names one of these books by its old short name needs the new one.");
    expect(notice.text).not.toContain("as before");
  });

  it("with no short name changed, the keys and connections keep working as before", () => {
    const notice = organizationJoinNotice("Acme", [{ name: "Recipes", slug: "recipes", previousSlug: "recipes" }]);
    expect(notice.text).toContain("keep working as before.");
    expect(notice.text).not.toContain("old short name");
  });

  it("with no books moved, the notice says nothing about books", () => {
    expect(organizationJoinNotice("Acme", []).text).not.toContain("recipe books moved");
    expect(organizationJoinNotice("Acme", []).text).toContain("keep working as before.");
  });
});

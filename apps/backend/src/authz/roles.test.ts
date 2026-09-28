import { describe, it, expect } from "vitest";
import { isOwner, isOwnerOrAdmin, mayReadTrace, unpublishedDraftManagement } from "./roles";

// Layer 1 — the pure half of the authorization seam. Every branch, including
// the fail-closed ones: no membership, and a role this module has never seen.

describe("isOwner", () => {
  it("is true only for owner", () => {
    expect(isOwner("owner")).toBe(true);
    expect(isOwner("admin")).toBe(false);
    expect(isOwner("member")).toBe(false);
  });

  it("fails closed without a membership and for unknown roles", () => {
    expect(isOwner(null)).toBe(false);
    expect(isOwner(undefined)).toBe(false);
    expect(isOwner("")).toBe(false);
    expect(isOwner("viewer")).toBe(false);
    expect(isOwner("Owner")).toBe(false);
  });
});

describe("isOwnerOrAdmin", () => {
  it("is true for owner and admin, false for member", () => {
    expect(isOwnerOrAdmin("owner")).toBe(true);
    expect(isOwnerOrAdmin("admin")).toBe(true);
    expect(isOwnerOrAdmin("member")).toBe(false);
  });

  it("fails closed without a membership and for unknown roles", () => {
    expect(isOwnerOrAdmin(null)).toBe(false);
    expect(isOwnerOrAdmin(undefined)).toBe(false);
    expect(isOwnerOrAdmin("")).toBe(false);
    expect(isOwnerOrAdmin("viewer")).toBe(false);
    expect(isOwnerOrAdmin("ADMIN")).toBe(false);
  });
});

describe("mayReadTrace", () => {
  it("lets the author read whether or not they are still a member", () => {
    expect(mayReadTrace({ isAuthor: true, role: null })).toBe(true);
    expect(mayReadTrace({ isAuthor: true, role: "member" })).toBe(true);
  });

  it("lets any member of the book read, whatever the role", () => {
    expect(mayReadTrace({ isAuthor: false, role: "owner" })).toBe(true);
    expect(mayReadTrace({ isAuthor: false, role: "admin" })).toBe(true);
    expect(mayReadTrace({ isAuthor: false, role: "member" })).toBe(true);
  });

  it("refuses a non-author with no membership", () => {
    expect(mayReadTrace({ isAuthor: false, role: null })).toBe(false);
    expect(mayReadTrace({ isAuthor: false, role: undefined })).toBe(false);
  });
});

describe("unpublishedDraftManagement (slice 4, S4-M5)", () => {
  const f = (draftState: string | null, isDraftSubject: boolean, isDraftDepositor: boolean) =>
    unpublishedDraftManagement({ draftState, isDraftSubject, isDraftDepositor });

  it("published recipes fall to the ordinary rules", () => {
    expect(f(null, true, true)).toBeNull();
    expect(f("verified", false, true)).toBeNull();
  });

  it("the subject may move and delete; the depositor may delete only; nobody else may do either", () => {
    for (const s of ["unverified", "rejected", "not_chosen", "garbage"]) {
      expect(f(s, true, true), s).toEqual({ move: true, delete: true });
      expect(f(s, true, false), s).toEqual({ move: true, delete: true });
      expect(f(s, false, true), s).toEqual({ move: false, delete: true });
      expect(f(s, false, false), s).toEqual({ move: false, delete: false });
    }
  });
});

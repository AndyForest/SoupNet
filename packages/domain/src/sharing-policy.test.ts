import { describe, it, expect } from "vitest";
import {
  decideMembershipSharing,
  decideRefileSharing,
  isInboundSharing,
  isOutboundSharing,
  sharingRefusalMessage,
  DEFAULT_SHARING_POLICY,
} from "./sharing-policy";
import type { SharingPolicy, SharingRefusal } from "./sharing-policy";

const open: SharingPolicy = { outbound: "allowed", inbound: "allowed" };
const closed: SharingPolicy = { outbound: "blocked", inbound: "blocked" };
const adminsOnly: SharingPolicy = { outbound: "admins_only", inbound: "allowed" };

describe("policy values", () => {
  it.each(["blocked", "admins_only", "allowed"])("accepts outbound %s", (v) => {
    expect(isOutboundSharing(v)).toBe(true);
  });

  it.each(["blocked", "allowed"])("accepts inbound %s", (v) => {
    expect(isInboundSharing(v)).toBe(true);
  });

  // "Admins only" has no meaning for a member accepting someone else's book.
  it("refuses admins_only for inbound, and anything unknown for either", () => {
    expect(isInboundSharing("admins_only")).toBe(false);
    expect(isOutboundSharing("open")).toBe(false);
    expect(isOutboundSharing(null)).toBe(false);
    expect(isInboundSharing(undefined)).toBe(false);
  });

  it("defaults both directions to allowed, so nothing changes until an admin chooses", () => {
    expect(DEFAULT_SHARING_POLICY).toEqual({ outbound: "allowed", inbound: "allowed" });
  });
});

describe("decideMembershipSharing", () => {
  const base = {
    bookOrgPolicy: null as SharingPolicy | null,
    joinerOrgPolicy: null as SharingPolicy | null,
    sameOrganization: false,
    actorIsBookOrgAdmin: false,
  };

  it("allows anything between two personal accounts (no company policy applies)", () => {
    expect(decideMembershipSharing(base)).toEqual({ allowed: true });
  });

  it("allows inside one organization whatever its policy says", () => {
    expect(
      decideMembershipSharing({ ...base, bookOrgPolicy: closed, joinerOrgPolicy: closed, sameOrganization: true }),
    ).toEqual({ allowed: true });
  });

  describe("outbound: a company book, a joiner outside the company", () => {
    it("allows when the policy allows", () => {
      expect(decideMembershipSharing({ ...base, bookOrgPolicy: open })).toEqual({ allowed: true });
    });

    it("refuses everyone, admins included, when blocked", () => {
      expect(decideMembershipSharing({ ...base, bookOrgPolicy: closed })).toEqual({
        allowed: false,
        refusal: "outbound_blocked",
      });
      expect(decideMembershipSharing({ ...base, bookOrgPolicy: closed, actorIsBookOrgAdmin: true })).toEqual({
        allowed: false,
        refusal: "outbound_blocked",
      });
    });

    it("lets an admin through and refuses anyone else when admins only", () => {
      expect(decideMembershipSharing({ ...base, bookOrgPolicy: adminsOnly, actorIsBookOrgAdmin: true })).toEqual({
        allowed: true,
      });
      expect(decideMembershipSharing({ ...base, bookOrgPolicy: adminsOnly })).toEqual({
        allowed: false,
        refusal: "outbound_admins_only",
      });
    });
  });

  describe("inbound: a book outside the company, a joiner inside it", () => {
    it("allows when the joiner's organization allows", () => {
      expect(decideMembershipSharing({ ...base, joinerOrgPolicy: open })).toEqual({ allowed: true });
    });

    it("refuses when the joiner's organization blocks it", () => {
      expect(decideMembershipSharing({ ...base, joinerOrgPolicy: closed })).toEqual({
        allowed: false,
        refusal: "inbound_blocked",
      });
    });

    // Admins-only is an outbound idea; a joiner's organization set to
    // admins_only outbound and allowed inbound lets them bring context in.
    it("is decided by the inbound setting alone", () => {
      expect(decideMembershipSharing({ ...base, joinerOrgPolicy: adminsOnly })).toEqual({ allowed: true });
    });
  });

  it("checks outbound before inbound when two companies meet", () => {
    expect(decideMembershipSharing({ ...base, bookOrgPolicy: closed, joinerOrgPolicy: closed })).toEqual({
      allowed: false,
      refusal: "outbound_blocked",
    });
    expect(decideMembershipSharing({ ...base, bookOrgPolicy: open, joinerOrgPolicy: closed })).toEqual({
      allowed: false,
      refusal: "inbound_blocked",
    });
  });
});

describe("decideRefileSharing", () => {
  const base = {
    sourceOrgPolicy: null as SharingPolicy | null,
    destinationInSameOrganization: false,
    actorIsSourceOrgAdmin: false,
  };

  it("allows a recipe leaving a book that no company owns", () => {
    expect(decideRefileSharing(base)).toEqual({ allowed: true });
  });

  it("allows moving between two books of the same organization", () => {
    expect(decideRefileSharing({ ...base, sourceOrgPolicy: closed, destinationInSameOrganization: true })).toEqual({
      allowed: true,
    });
  });

  it("follows the outbound setting when a recipe leaves the company", () => {
    expect(decideRefileSharing({ ...base, sourceOrgPolicy: open })).toEqual({ allowed: true });
    expect(decideRefileSharing({ ...base, sourceOrgPolicy: closed, actorIsSourceOrgAdmin: true })).toEqual({
      allowed: false,
      refusal: "outbound_blocked",
    });
    expect(decideRefileSharing({ ...base, sourceOrgPolicy: adminsOnly, actorIsSourceOrgAdmin: true })).toEqual({
      allowed: true,
    });
    expect(decideRefileSharing({ ...base, sourceOrgPolicy: adminsOnly })).toEqual({
      allowed: false,
      refusal: "outbound_admins_only",
    });
  });

  // Inbound governs joining books; a recipe arriving from outside isn't a
  // membership, so a closed inbound setting never stops a re-file.
  it("ignores the inbound setting", () => {
    expect(
      decideRefileSharing({ ...base, sourceOrgPolicy: { outbound: "allowed", inbound: "blocked" } }),
    ).toEqual({ allowed: true });
  });
});

describe("sharingRefusalMessage", () => {
  const refusals: SharingRefusal[] = ["outbound_blocked", "outbound_admins_only", "inbound_blocked"];

  it.each(refusals)("names the cause and a next step for the joiner (%s)", (refusal) => {
    const text = sharingRefusalMessage(refusal, "joiner");
    expect(text).toMatch(/organization/);
    expect(text).toMatch(/Ask /);
  });

  it.each(["outbound_blocked", "outbound_admins_only"] as const)(
    "names the cause and a next step for the sharer and the mover (%s)",
    (refusal) => {
      for (const audience of ["sharer", "mover"] as const) {
        const text = sharingRefusalMessage(refusal, audience);
        expect(text).toMatch(/[Yy]our organization/);
        expect(text).toMatch(/Ask one of its admins\.$/);
      }
    },
  );

  it("tells a joiner refused by their own organization that it is theirs", () => {
    expect(sharingRefusalMessage("inbound_blocked", "joiner")).toBe(
      "Your organization doesn't allow joining recipe books owned outside it. Ask one of its admins.",
    );
  });

  it("tells an outside joiner it is the book's organization, not theirs", () => {
    expect(sharingRefusalMessage("outbound_blocked", "joiner")).toMatch(/^This recipe book's organization/);
  });

  it("gives every audience distinct copy for a re-file", () => {
    expect(sharingRefusalMessage("outbound_blocked", "mover")).not.toBe(
      sharingRefusalMessage("outbound_blocked", "sharer"),
    );
  });
});

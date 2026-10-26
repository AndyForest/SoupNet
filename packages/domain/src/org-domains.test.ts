import { describe, it, expect } from "vitest";
import {
  normalizeDomain,
  isPublicEmailDomain,
  domainChallengeRecord,
  txtAnswerMatches,
  addressDomain,
  isAddressOnDomain,
  googleHdMatches,
  applyDomainCheck,
  domainClaimStatus,
  domainLapsesAt,
  challengeExpiresAt,
  isDomainCaptured,
  domainRefusalMessage,
  domainInstructions,
  domainNotFoundMessage,
  domainJoinNotice,
  domainFailingEmail,
  domainLapsedEmail,
  DOMAIN_CHALLENGE_LABEL,
  DOMAIN_RECORD_PREFIX,
  DOMAIN_CHALLENGE_TTL_DAYS,
  DOMAIN_RECHECK_HOURS,
  DOMAIN_FRESHNESS_HOURS,
  DOMAIN_GRACE_DAYS,
  type DomainClaimState,
} from "./org-domains";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-26T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const pending = (issuedAgo = HOUR): DomainClaimState => ({
  verifiedAt: null,
  failingSince: null,
  lastCheckedAt: null,
  lastFoundAt: null,
  tokenIssuedAt: ago(issuedAgo),
});

const verified = (over: Partial<DomainClaimState> = {}): DomainClaimState => ({
  verifiedAt: ago(30 * DAY),
  failingSince: null,
  lastCheckedAt: ago(HOUR),
  lastFoundAt: ago(HOUR),
  tokenIssuedAt: ago(31 * DAY),
  ...over,
});

describe("the published numbers", () => {
  it("OD-D2: challenge seven days, re-check daily, freshness 48 hours, grace fourteen days", () => {
    expect(DOMAIN_CHALLENGE_LABEL).toBe("_soupnet-challenge");
    expect(DOMAIN_RECORD_PREFIX).toBe("soupnet-domain-verification=");
    expect(DOMAIN_CHALLENGE_TTL_DAYS).toBe(7);
    expect(DOMAIN_RECHECK_HOURS).toBe(24);
    expect(DOMAIN_FRESHNESS_HOURS).toBe(48);
    expect(DOMAIN_GRACE_DAYS).toBe(14);
  });
});

describe("normalizeDomain", () => {
  it("ORG-DOM-01: lowercases, trims and drops one trailing dot", () => {
    expect(normalizeDomain("  Acme.Example. ")).toEqual({ ok: true, domain: "acme.example" });
    expect(normalizeDomain("sub.acme.example")).toEqual({ ok: true, domain: "sub.acme.example" });
    expect(normalizeDomain("my-co.example")).toEqual({ ok: true, domain: "my-co.example" });
  });

  it("stores an internationalized name in its ASCII (punycode) form", () => {
    expect(normalizeDomain("bücher.example")).toEqual({ ok: true, domain: "xn--bcher-kva.example" });
    expect(normalizeDomain("xn--bcher-kva.example")).toEqual({ ok: true, domain: "xn--bcher-kva.example" });
  });

  it("ORG-DOM-02: refuses anything that isn't a plain multi-label host name", () => {
    const bad = [
      undefined,
      null,
      42,
      "",
      "   ",
      ".",
      "localhost",
      "exa mple.com",
      "http://acme.example",
      "acme.example/path",
      "user@acme.example",
      "acme.example:443",
      "acme..example",
      ".acme.example",
      "acme.example..",
      "-acme.example",
      "acme-.example",
      "acme_x.example",
      "acme.example?x",
      "acme.example#x",
      "[::1]",
      "192.0.2.1",
      "0x7f.1",
      "acme.123",
      "a".repeat(64) + ".example",
      `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.example`,
    ];
    for (const raw of bad) {
      expect(normalizeDomain(raw), String(raw)).toEqual({ ok: false, refusal: "invalid_domain" });
    }
  });

  it("ORG-DOM-02: refuses a public email provider's domain with its own reason", () => {
    expect(normalizeDomain("Gmail.com")).toEqual({ ok: false, refusal: "public_email_domain" });
    expect(normalizeDomain("outlook.com")).toEqual({ ok: false, refusal: "public_email_domain" });
  });
});

describe("isPublicEmailDomain", () => {
  it("OD-V2: exact provider names", () => {
    for (const d of ["gmail.com", "googlemail.com", "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "pm.me", "aol.com", "mail.com", "zoho.com", "fastmail.com", "hey.com"]) {
      expect(isPublicEmailDomain(d), d).toBe(true);
    }
  });

  it("OD-V2: the hosted-tenant suffix and anything under it", () => {
    expect(isPublicEmailDomain("onmicrosoft.com")).toBe(true);
    expect(isPublicEmailDomain("contoso.onmicrosoft.com")).toBe(true);
    expect(isPublicEmailDomain("contoso.mail.onmicrosoft.com")).toBe(true);
    expect(isPublicEmailDomain("notonmicrosoft.com")).toBe(false);
  });

  it("OD-V2: multi-country brands under a one- or two-label ending", () => {
    for (const d of ["yahoo.com", "yahoo.co.uk", "yahoo.fr", "hotmail.com", "hotmail.co.uk", "live.com", "live.ca", "outlook.com", "outlook.fr", "gmx.de", "gmx.net", "msn.com", "ymail.com", "yandex.ru", "yandex.com"]) {
      expect(isPublicEmailDomain(d), d).toBe(true);
    }
  });

  it("OD-V2: a company's own name that merely contains a brand label isn't caught", () => {
    for (const d of ["acme.example", "mail.acme.example", "yahoo.acme.example", "live.acme.example", "outlook-partners.example", "mygmail.com"]) {
      expect(isPublicEmailDomain(d), d).toBe(false);
    }
  });
});

describe("domainChallengeRecord", () => {
  it("names the dedicated label and prefixes the token", () => {
    expect(domainChallengeRecord("acme.example", "tok")).toEqual({
      name: "_soupnet-challenge.acme.example",
      value: "soupnet-domain-verification=tok",
    });
  });
});

describe("txtAnswerMatches", () => {
  const value = "soupnet-domain-verification=tok123";

  it("OD-V5: matches a record whose joined character-strings equal the value exactly", () => {
    expect(txtAnswerMatches([[value]], value)).toBe(true);
    expect(txtAnswerMatches([["soupnet-domain-", "verification=tok123"]], value)).toBe(true);
    expect(txtAnswerMatches([["v=spf1 -all"], [value]], value)).toBe(true);
  });

  it("OD-V5: a near miss doesn't verify", () => {
    expect(txtAnswerMatches([], value)).toBe(false);
    expect(txtAnswerMatches([["x " + value + " y"]], value)).toBe(false);
    expect(txtAnswerMatches([["tok123"]], value)).toBe(false);
    expect(txtAnswerMatches([[value + " "]], value)).toBe(false);
    expect(txtAnswerMatches([["soupnet-domain-verification=other"]], value)).toBe(false);
  });

  it("an empty expected value never matches", () => {
    expect(txtAnswerMatches([[""]], "")).toBe(false);
  });
});

describe("addressDomain, isAddressOnDomain and googleHdMatches", () => {
  it("OD-J8: takes the part after the last @, normalized like a claim", () => {
    expect(addressDomain("Nia@Acme.Example")).toBe("acme.example");
    expect(addressDomain("odd\"@\"name@acme.example")).toBe("acme.example");
    expect(addressDomain("nia@BÜCHER.example")).toBe("xn--bcher-kva.example");
    expect(addressDomain("nia@gmail.com")).toBe("gmail.com");
  });

  it("OD-J8: an address whose domain part isn't a host name has no domain", () => {
    expect(addressDomain("no-at-sign")).toBe("");
    expect(addressDomain("nia@")).toBe("");
    expect(addressDomain("nia@localhost")).toBe("");
    expect(addressDomain("nia@[192.0.2.1]")).toBe("");
  });

  it("ORG-JOIN-D06: equality, never a suffix, in either direction", () => {
    expect(isAddressOnDomain("nia@acme.example", "acme.example")).toBe(true);
    expect(isAddressOnDomain("NIA@ACME.EXAMPLE", "acme.example")).toBe(true);
    expect(isAddressOnDomain("nia@mail.acme.example", "acme.example")).toBe(false);
    expect(isAddressOnDomain("nia@acme.example", "mail.acme.example")).toBe(false);
    expect(isAddressOnDomain("nia@notacme.example", "acme.example")).toBe(false);
    expect(isAddressOnDomain("nia@bücher.example", "xn--bcher-kva.example")).toBe(true);
    expect(isAddressOnDomain("no-at-sign", "")).toBe(false);
  });

  it("ORG-JOIN-D03: hd must equal both the claim's domain and the address's domain", () => {
    expect(googleHdMatches("acme.example", "nia@acme.example", "acme.example")).toBe(true);
    expect(googleHdMatches("ACME.example", "nia@acme.example", "acme.example")).toBe(true);
    expect(googleHdMatches(undefined, "nia@acme.example", "acme.example")).toBe(false);
    expect(googleHdMatches("", "nia@acme.example", "acme.example")).toBe(false);
    expect(googleHdMatches("acme-corp.example", "nia@acme.example", "acme.example")).toBe(false);
    expect(googleHdMatches("acme.example", "nia@other.example", "acme.example")).toBe(false);
    expect(googleHdMatches("acme.example", "nia@mail.acme.example", "acme.example")).toBe(false);
    expect(googleHdMatches("mail.acme.example", "nia@mail.acme.example", "acme.example")).toBe(false);
  });
});

describe("applyDomainCheck: a pending claim", () => {
  it("ORG-DOM-03: found verifies it", () => {
    const r = applyDomainCheck(pending(), "found", NOW);
    expect(r.event).toBe("verified");
    expect(r.rotateToken).toBe(false);
    expect(r.next).toMatchObject({ verifiedAt: NOW, failingSince: null, lastCheckedAt: NOW, lastFoundAt: NOW });
  });

  it("ORG-DOM-03: absent or error leaves it pending, recording the check", () => {
    for (const outcome of ["absent", "error"] as const) {
      const r = applyDomainCheck(pending(), outcome, NOW);
      expect(r.event).toBe("still_pending");
      expect(r.next).toMatchObject({ verifiedAt: null, failingSince: null, lastCheckedAt: NOW, lastFoundAt: null });
    }
  });

  it("ORG-DOM-03: an expired challenge changes nothing, even with the record published", () => {
    const state = pending(7 * DAY + 1);
    const r = applyDomainCheck(state, "found", NOW);
    expect(r.event).toBe("expired");
    expect(r.next).toEqual(state);
  });

  it("exactly seven days old is still live", () => {
    expect(applyDomainCheck(pending(7 * DAY), "found", NOW).event).toBe("verified");
  });
});

describe("applyDomainCheck: a verified claim", () => {
  it("found keeps it verified and refreshes the check", () => {
    const r = applyDomainCheck(verified(), "found", NOW);
    expect(r.event).toBe("still_verified");
    expect(r.next).toMatchObject({ lastCheckedAt: NOW, lastFoundAt: NOW, failingSince: null });
  });

  it("ORG-DOM-04: the first failed check starts failing", () => {
    for (const outcome of ["absent", "error"] as const) {
      const r = applyDomainCheck(verified(), outcome, NOW);
      expect(r.event).toBe("failing");
      expect(r.next.failingSince).toEqual(NOW);
      expect(r.next.verifiedAt).not.toBeNull();
      expect(r.next.lastCheckedAt).toEqual(NOW);
    }
  });

  it("a later failed check keeps the first failure's time", () => {
    const since = ago(3 * DAY);
    const r = applyDomainCheck(verified({ failingSince: since }), "absent", NOW);
    expect(r.event).toBe("still_failing");
    expect(r.next.failingSince).toEqual(since);
  });

  it("ORG-DOM-05: found while failing recovers", () => {
    const r = applyDomainCheck(verified({ failingSince: ago(3 * DAY) }), "found", NOW);
    expect(r.event).toBe("recovered");
    expect(r.next.failingSince).toBeNull();
  });

  it("ORG-DOM-06: fourteen days of failure lapses the claim and rotates the token", () => {
    const r = applyDomainCheck(verified({ failingSince: ago(14 * DAY) }), "absent", NOW);
    expect(r.event).toBe("lapsed");
    expect(r.rotateToken).toBe(true);
    expect(r.next).toMatchObject({ verifiedAt: null, failingSince: null, lastCheckedAt: NOW, tokenIssuedAt: NOW });
  });

  it("one hour short of fourteen days is still failing", () => {
    const r = applyDomainCheck(verified({ failingSince: ago(14 * DAY - HOUR) }), "error", NOW);
    expect(r.event).toBe("still_failing");
    expect(r.rotateToken).toBe(false);
  });
});

describe("domainClaimStatus, lapsesAt and challengeExpiresAt", () => {
  it("names the four states a console shows", () => {
    expect(domainClaimStatus(pending(), NOW)).toBe("pending");
    expect(domainClaimStatus(pending(8 * DAY), NOW)).toBe("expired");
    expect(domainClaimStatus(verified(), NOW)).toBe("verified");
    expect(domainClaimStatus(verified({ failingSince: ago(DAY) }), NOW)).toBe("failing");
  });

  it("dates the lapse and the challenge expiry", () => {
    const since = ago(DAY);
    expect(domainLapsesAt(verified({ failingSince: since }))).toEqual(new Date(since.getTime() + 14 * DAY));
    expect(domainLapsesAt(verified())).toBeNull();
    const p = pending(DAY);
    expect(challengeExpiresAt(p)).toEqual(new Date(p.tokenIssuedAt.getTime() + 7 * DAY));
  });
});

describe("isDomainCaptured (the rule domainVerifiedFor states in SQL)", () => {
  it("ORG-DOM-07: verified, not failing, fresh and switched on", () => {
    expect(isDomainCaptured({ ...verified(), autoJoin: true }, NOW)).toBe(true);
  });

  it("ORG-DOM-07: each clause false in turn refuses", () => {
    expect(isDomainCaptured({ ...verified(), autoJoin: false }, NOW)).toBe(false);
    expect(isDomainCaptured({ ...verified({ failingSince: ago(HOUR) }), autoJoin: true }, NOW)).toBe(false);
    expect(isDomainCaptured({ ...verified({ lastCheckedAt: ago(49 * HOUR) }), autoJoin: true }, NOW)).toBe(false);
    expect(isDomainCaptured({ ...verified({ lastCheckedAt: null }), autoJoin: true }, NOW)).toBe(false);
    expect(isDomainCaptured({ ...pending(), autoJoin: true }, NOW)).toBe(false);
  });
});

describe("copy", () => {
  it("every refusal has a plain message with the way forward", () => {
    expect(domainRefusalMessage("invalid_domain")).toContain("example.com");
    expect(domainRefusalMessage("public_email_domain")).toContain("public email provider");
    expect(domainRefusalMessage("domain_taken")).toBe("This domain is already verified by another organization. Contact Soup.net support.");
    expect(domainRefusalMessage("challenge_expired")).toContain("Add the domain again");
  });

  it("OD-D2: the instructions publish the record, the numbers, and how to revoke", () => {
    const text = domainInstructions({ name: "_soupnet-challenge.acme.example", value: "soupnet-domain-verification=tok" });
    expect(text).toContain("_soupnet-challenge.acme.example");
    expect(text).toContain("soupnet-domain-verification=tok");
    expect(text).toContain("72 hours");
    expect(text).toContain("seven days");
    expect(text).toContain("every day");
    expect(text).toContain("fourteen days");
    expect(text).toContain("remove the record");
    expect(text).toContain("Before your organization gives up this domain");
    expect(text).toContain("Subdomains are verified separately");
  });

  it("OD-V3: the not-found message names where we looked and nothing we saw", () => {
    expect(domainNotFoundMessage("_soupnet-challenge.acme.example")).toBe(
      "No matching record was found at _soupnet-challenge.acme.example. DNS changes can take up to 72 hours to appear.",
    );
  });

  it("ORG-JOIN-D01: the join notice names the organization and its admins", () => {
    expect(domainJoinNotice("Acme")).toBe("Confirming this address adds your account to Acme on Soup.net. Acme's admins will manage it.");
  });

  it("ORG-DOM-04, ORG-DOM-06: the admin emails say what is frozen and when it lapses", () => {
    const lapsesAt = new Date("2026-11-09T12:00:00Z");
    const failing = domainFailingEmail({ organizationName: "Acme", domain: "acme.example", recordName: "_soupnet-challenge.acme.example", lapsesAt });
    expect(failing.subject).toContain("acme.example");
    expect(failing.text).toContain("_soupnet-challenge.acme.example");
    expect(failing.text).toContain("paused");
    expect(failing.text).toContain("2026-11-09");
    expect(failing.text).toContain("Nobody's account");

    const lapsed = domainLapsedEmail({ organizationName: "Acme", domain: "acme.example" });
    expect(lapsed.subject).toContain("acme.example");
    expect(lapsed.text).toContain("no longer verified");
    expect(lapsed.text).toContain("new record");
    expect(lapsed.text).toContain("Nobody's account");
  });

  it("OD-R2: the emails carry the record's name, never a token value", () => {
    const failing = domainFailingEmail({ organizationName: "Acme", domain: "acme.example", recordName: "_soupnet-challenge.acme.example", lapsesAt: NOW });
    const lapsed = domainLapsedEmail({ organizationName: "Acme", domain: "acme.example" });
    for (const mail of [failing, lapsed]) {
      expect(mail.text).not.toContain(DOMAIN_RECORD_PREFIX);
      expect(mail.subject).not.toContain(DOMAIN_RECORD_PREFIX);
    }
  });
});

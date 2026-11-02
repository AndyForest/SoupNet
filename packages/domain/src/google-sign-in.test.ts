import { describe, it, expect } from "vitest";
import {
  googleIsAuthoritative,
  googleSessionIdp,
  resolveGoogleSignIn,
  GOOGLE_SIGN_IN_ERRORS,
  googleSignInErrorMessage,
  isGoogleSignInError,
  safeAppReturnPath,
} from "./google-sign-in";

/**
 * Pure rules for Sign in with Google (organization accounts round 1, stream
 * SSO; rubric docs/planning/org-accounts-build/sso.md, SSO-M3).
 */

describe("googleIsAuthoritative (Google's two authoritative cases)", () => {
  it("is true for an @gmail.com address, in any case, whatever email_verified says", () => {
    expect(googleIsAuthoritative({ email: "pat@gmail.com", emailVerified: true, hostedDomain: null })).toBe(true);
    expect(googleIsAuthoritative({ email: "Pat@GMAIL.COM", emailVerified: false, hostedDomain: null })).toBe(true);
  });

  it("is true for a verified address with hd set", () => {
    expect(googleIsAuthoritative({ email: "olive@acme.example", emailVerified: true, hostedDomain: "acme.example" })).toBe(true);
  });

  it("is false with hd set but email_verified false", () => {
    expect(googleIsAuthoritative({ email: "olive@acme.example", emailVerified: false, hostedDomain: "acme.example" })).toBe(false);
  });

  it("is false for a consumer account on a third-party address, even when Google says verified", () => {
    expect(googleIsAuthoritative({ email: "cy@outside.example", emailVerified: true, hostedDomain: null })).toBe(false);
  });

  it("treats an empty hd as absent", () => {
    expect(googleIsAuthoritative({ email: "cy@outside.example", emailVerified: true, hostedDomain: "" })).toBe(false);
  });

  it("does not take a look-alike gmail suffix", () => {
    expect(googleIsAuthoritative({ email: "x@notgmail.com", emailVerified: true, hostedDomain: null })).toBe(false);
    expect(googleIsAuthoritative({ email: "x@gmail.com.evil.example", emailVerified: true, hostedDomain: null })).toBe(false);
  });
});

describe("googleSessionIdp", () => {
  it("is google for a Workspace identity and google-consumer otherwise", () => {
    expect(googleSessionIdp("acme.example")).toBe("google");
    expect(googleSessionIdp(null)).toBe("google-consumer");
    expect(googleSessionIdp("")).toBe("google-consumer");
  });
});

describe("resolveGoogleSignIn (rubric order, recipe 3a943b1c)", () => {
  it("signs a known identity in to its account, whatever the email says", () => {
    expect(
      resolveGoogleSignIn({
        identityUserId: "u1",
        emailAccount: { userId: "u2", verified: true, holdsOtherGoogleIdentity: false },
        authoritative: false,
      }),
    ).toEqual({ kind: "sign_in", userId: "u1" });
  });

  it("creates a verified account for an authoritative token with no account", () => {
    expect(resolveGoogleSignIn({ identityUserId: null, emailAccount: null, authoritative: true })).toEqual({ kind: "create", verified: true });
  });

  it("creates an unverified account for a non-authoritative token with no account", () => {
    expect(resolveGoogleSignIn({ identityUserId: null, emailAccount: null, authoritative: false })).toEqual({ kind: "create", verified: false });
  });

  it("links into a verified account when authoritative, without a takeover", () => {
    expect(
      resolveGoogleSignIn({
        identityUserId: null,
        emailAccount: { userId: "max", verified: true, holdsOtherGoogleIdentity: false },
        authoritative: true,
      }),
    ).toEqual({ kind: "link", userId: "max", takeover: false });
  });

  it("refuses to link a verified account when not authoritative", () => {
    expect(
      resolveGoogleSignIn({
        identityUserId: null,
        emailAccount: { userId: "max", verified: true, holdsOtherGoogleIdentity: false },
        authoritative: false,
      }),
    ).toEqual({ kind: "refuse", error: "not_authoritative" });
  });

  it("refuses a verified account that holds a different Google identity, even when authoritative", () => {
    expect(
      resolveGoogleSignIn({
        identityUserId: null,
        emailAccount: { userId: "max", verified: true, holdsOtherGoogleIdentity: true },
        authoritative: true,
      }),
    ).toEqual({ kind: "refuse", error: "different_google_account" });
  });

  it("takes over an unverified password pre-registration when authoritative (Eve, SSO-A3)", () => {
    expect(
      resolveGoogleSignIn({
        identityUserId: null,
        emailAccount: { userId: "eve", verified: false, holdsOtherGoogleIdentity: false },
        authoritative: true,
      }),
    ).toEqual({ kind: "link", userId: "eve", takeover: true });
  });

  it("takes over an unverified consumer-Google pre-registration when authoritative (Gil, SSO-A3b)", () => {
    expect(
      resolveGoogleSignIn({
        identityUserId: null,
        emailAccount: { userId: "gil", verified: false, holdsOtherGoogleIdentity: true },
        authoritative: true,
      }),
    ).toEqual({ kind: "link", userId: "gil", takeover: true });
  });

  it("links nothing into an unverified account when not authoritative", () => {
    expect(
      resolveGoogleSignIn({
        identityUserId: null,
        emailAccount: { userId: "gil", verified: false, holdsOtherGoogleIdentity: true },
        authoritative: false,
      }),
    ).toEqual({ kind: "refuse", error: "not_authoritative" });
    expect(
      resolveGoogleSignIn({
        identityUserId: null,
        emailAccount: { userId: "eve", verified: false, holdsOtherGoogleIdentity: false },
        authoritative: false,
      }),
    ).toEqual({ kind: "refuse", error: "not_authoritative" });
  });
});

describe("the closed error list", () => {
  it("has copy for every code, in plain words with a next step", () => {
    for (const code of GOOGLE_SIGN_IN_ERRORS) {
      const message = googleSignInErrorMessage(code);
      expect(message.length).toBeGreaterThan(10);
      expect(message.endsWith(".")).toBe(true);
    }
  });

  it("recognises only listed codes", () => {
    expect(isGoogleSignInError("expired")).toBe(true);
    expect(isGoogleSignInError("organization_full")).toBe(true);
    expect(isGoogleSignInError("<script>")).toBe(false);
    expect(isGoogleSignInError(undefined)).toBe(false);
    expect(isGoogleSignInError(3)).toBe(false);
  });

  it("falls back to the generic failure copy for an unknown code", () => {
    expect(googleSignInErrorMessage("nope" as never)).toBe(googleSignInErrorMessage("failed"));
  });
});

describe("safeAppReturnPath (the server's copy of the SPA's return rule, plus /oauth/authorize)", () => {
  it("accepts app paths with a query and a hash", () => {
    expect(safeAppReturnPath("/app/drafts?ids=a,b")).toBe("/app/drafts?ids=a,b");
    expect(safeAppReturnPath("/app/traces/abc#evidence")).toBe("/app/traces/abc#evidence");
  });

  it("accepts exactly /oauth/authorize with a query", () => {
    expect(safeAppReturnPath("/oauth/authorize?client_id=x&state=y")).toBe("/oauth/authorize?client_id=x&state=y");
    expect(safeAppReturnPath("/oauth/authorize")).toBe("/oauth/authorize");
  });

  it("refuses look-alikes of /oauth/authorize", () => {
    expect(safeAppReturnPath("/oauth/authorizex")).toBeNull();
    expect(safeAppReturnPath("/oauth/authorize/grant")).toBeNull();
    expect(safeAppReturnPath("/oauth/authorize/../x")).toBeNull();
    expect(safeAppReturnPath("/oauth/token")).toBeNull();
  });

  it("refuses everything off the app", () => {
    for (const bad of [
      "",
      "https://evil.example/app/x",
      "//evil.example/app/x",
      "/\\evil.example",
      "/app/../admin",
      "/app/%2e%2e/admin",
      "/app/x%2Fy",
      "/app/ x",
      "/app/\u0000",
      "/dashboard",
      "app/x",
      "/" + "a".repeat(2048),
    ]) {
      expect(safeAppReturnPath(bad), bad).toBeNull();
    }
    expect(safeAppReturnPath(null)).toBeNull();
    expect(safeAppReturnPath(undefined)).toBeNull();
    expect(safeAppReturnPath(42 as unknown as string)).toBeNull();
  });
});

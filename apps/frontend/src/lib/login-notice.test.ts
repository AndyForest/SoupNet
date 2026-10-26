import { describe, it, expect } from "vitest";
import { ACCOUNT_DELETED_SEARCH, loginNoticeFromSearch, loginPathAfterSignOut, searchWithoutLoginNotice } from "./login-notice";

// After deleting their account a person lands on the sign-in page. A short
// confirmation there tells them the deletion went through, instead of a
// bare sign-in form that could read as "something went wrong".

describe("loginNoticeFromSearch", () => {
  it("confirms the deletion when the page is reached from account deletion", () => {
    expect(loginNoticeFromSearch(`?${ACCOUNT_DELETED_SEARCH}`)).toBe("Your account has been deleted.");
  });

  it("shows nothing on an ordinary visit", () => {
    expect(loginNoticeFromSearch("")).toBeNull();
    expect(loginNoticeFromSearch("?invite=abc")).toBeNull();
  });

  it("ignores other values of the flag", () => {
    expect(loginNoticeFromSearch("?account=someone@example.com")).toBeNull();
  });

  // Signed out by the server (stream SSO, SSO-U4): the page says why.
  it("says why the server ended the session, for known reasons only", () => {
    expect(loginNoticeFromSearch("?signedOut=sso_required")).toBe("Your organization signs in with Google. Sign in with Google to continue.");
    expect(loginNoticeFromSearch("?signedOut=directory_inactive")).toContain("Google Workspace doesn't list this account");
    expect(loginNoticeFromSearch("?signedOut=account_disabled")).toContain("disabled this account");
    expect(loginNoticeFromSearch("?signedOut=<script>")).toBeNull();
    expect(loginNoticeFromSearch("?signedOut=toString")).toBeNull();
  });
});

describe("loginPathAfterSignOut", () => {
  it("carries a known reason and drops anything else", () => {
    expect(loginPathAfterSignOut("sso_required")).toBe("/auth/login?signedOut=sso_required");
    expect(loginPathAfterSignOut("whatever")).toBe("/auth/login");
    expect(loginPathAfterSignOut(null)).toBe("/auth/login");
  });
});

// Once the person submits the form the notice has done its job; the page
// drops the flag from the URL (a replace navigation) so the notice never sits
// beside a sign-in error and a refresh doesn't bring it back.
describe("searchWithoutLoginNotice", () => {
  it("drops the flag and leaves an empty search", () => {
    expect(searchWithoutLoginNotice(`?${ACCOUNT_DELETED_SEARCH}`)).toBe("");
  });

  it("keeps every other parameter", () => {
    expect(searchWithoutLoginNotice("?invite=abc&account=deleted&x=1")).toBe("?invite=abc&x=1");
  });

  it("drops the signed-out reason too", () => {
    expect(searchWithoutLoginNotice("?signedOut=sso_required&invite=abc")).toBe("?invite=abc");
  });

  it("leaves a search without the flag unchanged", () => {
    expect(searchWithoutLoginNotice("")).toBe("");
    expect(searchWithoutLoginNotice("?invite=abc")).toBe("?invite=abc");
  });
});

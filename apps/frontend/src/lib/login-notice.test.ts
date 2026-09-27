import { describe, it, expect } from "vitest";
import { ACCOUNT_DELETED_SEARCH, loginNoticeFromSearch, searchWithoutLoginNotice } from "./login-notice";

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

  it("leaves a search without the flag unchanged", () => {
    expect(searchWithoutLoginNotice("")).toBe("");
    expect(searchWithoutLoginNotice("?invite=abc")).toBe("?invite=abc");
  });
});

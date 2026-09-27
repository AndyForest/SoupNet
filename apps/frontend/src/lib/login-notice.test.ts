import { describe, it, expect } from "vitest";
import { ACCOUNT_DELETED_SEARCH, loginNoticeFromSearch } from "./login-notice";

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

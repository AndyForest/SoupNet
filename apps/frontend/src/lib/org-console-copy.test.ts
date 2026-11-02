import { describe, it, expect } from "vitest";
import { MEMBER_PAGE_COPY, accountsAwaitingMessage, directoryLastErrorLabel, migrationSummaryMessage } from "./org-console-copy.js";
import { describeOrgEvent } from "./org-activity-copy.js";

describe("MEMBER_PAGE_COPY, the promise to employees", () => {
  it("is exactly this text: changing it is a decision about what employees are told", () => {
    expect(MEMBER_PAGE_COPY).toEqual({
      canSeeOrgWide: "The names of the organization's org-wide recipe books and how many people belong to each. Like everyone in the organization, they can also read the published recipes in those books.",
      cannotSee: [
        "Your private recipe books' names, or the recipes in them, unless you share a book with them.",
        "What you and your agents search for.",
        "Your API keys themselves, their names, or which books they reach.",
        "Your sign-in history or how you sign in. They see only the latest time you signed in or a key was used, as listed above.",
      ],
      orgWide: "An org-wide recipe book, including the organization's default book, is open to everyone in the organization, admins included. A recipe you or your agent checks into one is logged there, and anyone in the organization can read it and see that it's yours once it's published. To keep a recipe private, check it into a private book.",
      oneWayIn: "Your organization can get to your private books by taking over this account. Because it controls your work email and, if you sign in with Google, your company Google account, it can reset your sign-in and sign in as you. Soup.net doesn't let admins browse private books, so unless you share a book with them, that is the only path to it, and it shows up below as a sign-in you didn't make.",
    });
  });

  it("doesn't promise the text of every recipe, or deny the last-active time it lists", () => {
    const text = JSON.stringify(MEMBER_PAGE_COPY);
    expect(text).not.toContain("The text of your recipes");
    expect(text).not.toContain("When and how you sign in");
  });
});

describe("migrationSummaryMessage", () => {
  it("says nothing when nothing happened", () => {
    expect(migrationSummaryMessage({ joined: 0, awaitingSeat: 0, failed: 0 })).toBeNull();
  });

  it("counts who joined and who is waiting for a seat", () => {
    expect(migrationSummaryMessage({ joined: 2, awaitingSeat: 1, failed: 0 })).toBe("2 accounts joined. 1 account couldn't join because there are no free seats.");
  });

  it("says the daily job retries a failed or stopped run", () => {
    expect(migrationSummaryMessage({ joined: 0, awaitingSeat: 0, failed: 1 })).toContain("We try again every day");
    expect(migrationSummaryMessage({ joined: 0, awaitingSeat: 0, failed: 0, stopped: true })).toContain("We try again every day");
  });
});

describe("accountsAwaitingMessage", () => {
  it("reads differently with automatic joining on and off", () => {
    expect(accountsAwaitingMessage(1, true)).toContain("1 verified account on this domain is waiting");
    expect(accountsAwaitingMessage(3, false)).toContain("3 verified accounts on this domain would join");
  });
});

describe("directoryLastErrorLabel", () => {
  it("labels an HTTP code", () => {
    expect(directoryLastErrorLabel("http_403")).toBe("Google refused the connection (http_403)");
    expect(directoryLastErrorLabel("http_400")).toBe("Google answered with an error (http_400)");
  });

  it("labels each stored code and keeps the code beside it", () => {
    for (const code of ["member_renamed", "bad_answer", "bad_404", "admin_not_found", "bad_service_account_key", "decrypt_failed"]) {
      const label = directoryLastErrorLabel(code);
      expect(label).toContain(`(${code})`);
      expect(label).not.toBe(code);
    }
    expect(directoryLastErrorLabel("member_renamed")).toBe("A member's address changed in Google Workspace (member_renamed)");
    expect(directoryLastErrorLabel("token_invalid_grant")).toBe("Google refused the connection's credential (token_invalid_grant)");
  });

  it("doesn't take a property of Object for a label", () => {
    expect(directoryLastErrorLabel("constructor")).toBe("constructor");
  });

  it("never repeats an address, even in a row stored before the rename code", () => {
    expect(directoryLastErrorLabel("renamed: max@acme.example is now maxine@acme.example in the directory")).toBe("Unknown error");
  });

  it("shows a plain code and refuses anything else", () => {
    expect(directoryLastErrorLabel("something_new")).toBe("something_new");
    expect(directoryLastErrorLabel('{"error":"token ya29.abc"}')).toBe("Unknown error");
  });
});

describe("describeOrgEvent, directory events", () => {
  const at = "2026-11-02T00:00:00.000Z";
  const base = { actor: "Google Workspace", target: "max@acme.example", at };

  it("names the member for the organization and says you to the member", () => {
    const event = { ...base, kind: "directory_status" as const, directoryStatus: "suspended" as const };
    expect(describeOrgEvent(event, "org")).toBe("The directory lists max@acme.example as suspended");
    expect(describeOrgEvent(event, "me")).toBe("The directory lists you as suspended");
    expect(describeOrgEvent({ ...event, directoryStatus: "deleted" }, "org")).toBe("The directory no longer lists max@acme.example");
  });

  it("gives a connection its domain, kind and cleared numbers", () => {
    expect(
      describeOrgEvent({ ...base, target: null, kind: "directory_connected", domain: "acme.example", connectionKind: "service_account", cleared: { suspended: 2, archived: 0, deleted: 1 } }, "org"),
    ).toBe("Connected the Google Workspace directory on acme.example with a service account; recorded statuses cleared: 2 suspended, 1 deleted");
    expect(describeOrgEvent({ ...base, target: null, kind: "directory_disconnected" }, "org")).toBe("Disconnected the Google Workspace directory");
  });

  it("says how many members a burst of removals found", () => {
    expect(describeOrgEvent({ ...base, actor: "Soup.net", target: null, kind: "directory_deletions_noticed", removedCount: 4 }, "org")).toBe("4 members were found removed from the directory within an hour");
    expect(describeOrgEvent({ ...base, actor: "Soup.net", target: null, kind: "directory_deletions_noticed" }, "org")).toBe("Several members were found removed from the directory within an hour");
  });

  it("labels a failed admin consent's reason", () => {
    expect(describeOrgEvent({ ...base, target: null, kind: "directory_connect_failed", domain: "acme.example", connectFailure: "directory_not_admin" }, "org")).toBe(
      "Couldn't connect the Google Workspace directory on acme.example: that account can't read the directory",
    );
  });
});

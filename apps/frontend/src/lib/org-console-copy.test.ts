import { describe, it, expect } from "vitest";
import { MEMBER_PAGE_COPY, accountsAwaitingMessage, autoJoinConfirmMessage, directoryLastErrorLabel, migrationSummaryMessage } from "./org-console-copy.js";
import { describeOrgEvent } from "./org-activity-copy.js";

describe("MEMBER_PAGE_COPY, the promise to employees", () => {
  it("is exactly this text: changing it is a decision about what employees are told", () => {
    expect(MEMBER_PAGE_COPY).toEqual({
    canSeeOrgWide: "The names of the organization's org-wide recipe books and who belongs to each, with each person's account id, email address, role and the date they joined. Anyone in one of those books can see that list too. Like everyone in the organization, admins can also read the published recipes in those books.",
    cannotSee: [
      "Your private recipe books' names, or the recipes in them, unless you share a book with them.",
      "The words you or your agents search with, or the task an agent declares when it starts. Feedback is different: see the next section.",
      "The secret value of any of your API keys, or a list of your keys and which books each one reaches. They see how many are live, and a key's name shows with what it wrote in an org-wide book: see the next section.",
      "Your sign-in history or how you sign in. They see only the latest time you signed in or a key was used, as listed above.",
    ],
    orgWide: "An org-wide recipe book, including the organization's default book, is open to everyone in the organization, admins included. Once a recipe in one is published, they can all read its text, its supporting evidence and references (which can quote your conversations), that it's yours, its book, and the name of the API key that wrote it. They can also read, word for word, any feedback your agent leaves on a recipe in one: the story it gave, its note, its session id and agent id, and the key's name. So a key's name or an agent's story can show what you were working on, even if you found that recipe while working on something private. To keep a recipe private, check it into a private book.",
    oneWayIn: "Your organization can get to your private books by taking over this account. Because it controls your work email and, if you sign in with Google, your company Google account, it can reset your sign-in and sign in as you. Soup.net doesn't let admins browse private books, so unless you share a book with them, that is the only path to it, and it shows up below as a sign-in you didn't make.",
  });
  });

  it("doesn't repeat a promise the org-wide books break", () => {
    const text = JSON.stringify(MEMBER_PAGE_COPY);
    expect(text).not.toContain("The text of your recipes");
    expect(text).not.toContain("When and how you sign in");
    expect(text).not.toContain("What you and your agents search for");
    expect(text).not.toContain("Your API keys themselves, their names");
    expect(text).not.toContain("how many people belong to each");
  });
});

describe("migrationSummaryMessage", () => {
  it("says nothing when nothing happened", () => {
    expect(migrationSummaryMessage({ joined: 0, awaitingSeat: 0, failed: 0 })).toBeNull();
  });

  it("counts who joined and who is waiting for a seat", () => {
    expect(migrationSummaryMessage({ joined: 2, awaitingSeat: 1, failed: 0 })).toBe("2 accounts joined. 1 account couldn't join because there are no free seats.");
  });

  it("doesn't tell a manager a failure needs nothing from them", () => {
    expect(migrationSummaryMessage({ joined: 0, awaitingSeat: 0, failed: 1 })).not.toContain("don't need to do anything");
    expect(migrationSummaryMessage({ joined: 0, awaitingSeat: 0, failed: 1 })).toContain("your own server's operator if you host Soup.net yourselves");
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

describe("autoJoinConfirmMessage", () => {
  it("names how many accounts will move, and that it can't be undone", () => {
    expect(autoJoinConfirmMessage("acme.example", 1)).toContain("1 existing account on acme.example will move into your organization");
    expect(autoJoinConfirmMessage("acme.example", 3)).toContain("3 existing accounts on acme.example will move");
    expect(autoJoinConfirmMessage("acme.example", 0)).toContain("No existing accounts on acme.example are waiting");
    expect(autoJoinConfirmMessage("acme.example", undefined)).toContain("Once acme.example is verified");
    for (const accounts of [0, 1, 3, undefined]) {
      expect(autoJoinConfirmMessage("acme.example", accounts)).toContain("Turning this off later won't return anyone who has joined");
      expect(autoJoinConfirmMessage("acme.example", accounts)).toContain("they can't delete them themselves");
    }
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

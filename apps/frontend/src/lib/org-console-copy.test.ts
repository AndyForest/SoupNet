import { describe, it, expect } from "vitest";
import { accountsAwaitingMessage, directoryLastErrorLabel, migrationSummaryMessage } from "./org-console-copy.js";
import { describeOrgEvent } from "./org-activity-copy.js";

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

  it("never repeats the addresses a rename stored", () => {
    const label = directoryLastErrorLabel("renamed: max@acme.example is now maxine@acme.example in the directory");
    expect(label).not.toContain("@");
  });

  it("shows a plain code and refuses anything else", () => {
    expect(directoryLastErrorLabel("invalid_grant")).toBe("invalid_grant");
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

  it("labels a failed admin consent's reason", () => {
    expect(describeOrgEvent({ ...base, target: null, kind: "directory_connect_failed", domain: "acme.example", connectFailure: "directory_not_admin" }, "org")).toBe(
      "Couldn't connect the Google Workspace directory on acme.example: that account can't read the directory",
    );
  });
});

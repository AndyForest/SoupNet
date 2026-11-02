import { describe, it, expect } from "vitest";
import {
  classifyDirectoryAnswer,
  directoryStatusRefuses,
  directoryDisabledMessage,
  DIRECTORY_INACTIVE_MESSAGE,
  DIRECTORY_UNCONFIRMED_MESSAGE,
  parseServiceAccountKey,
  directoryWarningEmail,
} from "./directory";

describe("classifyDirectoryAnswer (OB-M3)", () => {
  it("reads suspended, archived and active from a user", () => {
    expect(classifyDirectoryAnswer({ httpStatus: 200, body: { suspended: true } })).toEqual({ kind: "status", status: "suspended" });
    expect(classifyDirectoryAnswer({ httpStatus: 200, body: { archived: true } })).toEqual({ kind: "status", status: "archived" });
    expect(classifyDirectoryAnswer({ httpStatus: 200, body: { suspended: false, archived: false } })).toEqual({ kind: "status", status: "active" });
    expect(classifyDirectoryAnswer({ httpStatus: 200, body: null })).toEqual({ kind: "status", status: "active" });
  });

  it("treats a 404 as deleted", () => {
    expect(classifyDirectoryAnswer({ httpStatus: 404, body: {} })).toEqual({ kind: "status", status: "deleted" });
  });

  it("treats no answer, a 429 and a 5xx as unreachable", () => {
    expect(classifyDirectoryAnswer(null)).toEqual({ kind: "unreachable" });
    expect(classifyDirectoryAnswer({ httpStatus: 429, body: {} })).toEqual({ kind: "unreachable" });
    expect(classifyDirectoryAnswer({ httpStatus: 503, body: {} })).toEqual({ kind: "unreachable" });
  });

  it("treats every other refusal as the connection's error, never the member's status", () => {
    expect(classifyDirectoryAnswer({ httpStatus: 401, body: {} })).toEqual({ kind: "connection_error", code: "http_401" });
    expect(classifyDirectoryAnswer({ httpStatus: 403, body: {} })).toEqual({ kind: "connection_error", code: "http_403" });
    expect(classifyDirectoryAnswer({ httpStatus: 400, body: {} })).toEqual({ kind: "connection_error", code: "http_400" });
  });
});

describe("directoryStatusRefuses", () => {
  it("refuses suspended, archived and deleted only", () => {
    expect(directoryStatusRefuses("suspended")).toBe(true);
    expect(directoryStatusRefuses("archived")).toBe(true);
    expect(directoryStatusRefuses("deleted")).toBe(true);
    expect(directoryStatusRefuses("active")).toBe(false);
    expect(directoryStatusRefuses(null)).toBe(false);
  });
});

describe("the copy (recipe efa4bbca)", () => {
  it("names each directory cause", () => {
    expect(directoryDisabledMessage("directory_inactive")).toBe(DIRECTORY_INACTIVE_MESSAGE);
    expect(directoryDisabledMessage("directory_unconfirmed")).toBe(DIRECTORY_UNCONFIRMED_MESSAGE);
  });
});

describe("parseServiceAccountKey (OB-K3)", () => {
  const good = { type: "service_account", client_email: "sa@acme-project.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n" };

  it("reads a key given as JSON text or as an object", () => {
    expect(parseServiceAccountKey(JSON.stringify(good))).toEqual({ ok: true, key: { clientEmail: good.client_email, privateKey: good.private_key } });
    expect(parseServiceAccountKey(good)).toMatchObject({ ok: true });
  });

  it("says what's wrong without repeating the key", () => {
    for (const bad of ["{", null, 3, { ...good, type: "user" }, { ...good, client_email: "x" }, { ...good, private_key: "nope" }]) {
      const result = parseServiceAccountKey(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).not.toContain("BEGIN");
    }
  });
});

describe("directoryWarningEmail (OB-C8; verification O1, O2)", () => {
  it("names the last success and the hour everyone is signed out by, a day later, without claiming hours of failure", () => {
    const mail = directoryWarningEmail("Acme", new Date("2026-10-26T09:15:00Z"));
    expect(mail.subject).toBe("Soup.net can't reach Acme's Google Workspace directory");
    expect(mail.text).toContain("its last successful check was at 2026-10-26 09:15 UTC");
    expect(mail.text).toContain("everyone on your domain will be by 2026-10-27 09:15 UTC");
    expect(mail.text).toContain("may be signed out already");
    expect(mail.text).not.toContain("For the last");
  });
});

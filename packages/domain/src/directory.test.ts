import { describe, it, expect } from "vitest";
import {
  classifyDirectoryAnswer,
  isGoogleError,
  directoryStatusRefuses,
  directoryDisabledMessage,
  DIRECTORY_INACTIVE_MESSAGE,
  DIRECTORY_UNCONFIRMED_MESSAGE,
  parseServiceAccountKey,
  directoryWarningEmail,
} from "./directory";

describe("classifyDirectoryAnswer (OB-M3)", () => {
  const max = { email: "max@acme.example" };
  const record = (over: Record<string, unknown> = {}) => ({ id: "111", primaryEmail: "max@acme.example", suspended: false, archived: false, ...over });
  const status = (body: unknown, asked: { email: string } | { id: string } = max) => classifyDirectoryAnswer({ httpStatus: 200, body }, asked);

  it("reads suspended, archived and active from a complete record", () => {
    expect(status(record({ suspended: true }))).toEqual({ kind: "status", status: "suspended" });
    expect(status(record({ archived: true }))).toEqual({ kind: "status", status: "archived" });
    expect(status(record())).toEqual({ kind: "status", status: "active" });
  });

  it("F183: anything less than a complete record of the person is the connection's error, never a status", () => {
    const bad = { kind: "connection_error", code: "bad_answer" };
    for (const body of [
      null,
      "",
      "<html></html>",
      [],
      {},
      { error: { code: 200 } },
      { primaryEmail: "max@acme.example" },
      record({ suspended: "true" }),
      record({ suspended: undefined }),
      record({ archived: "false" }),
      record({ archived: undefined }),
      record({ primaryEmail: 7 }),
      record({ primaryEmail: "someone-else@acme.example" }),
      record({ primaryEmail: "someone-else@acme.example", suspended: true }),
    ]) {
      expect(status(body), JSON.stringify(body)).toEqual(bad);
    }
    expect(status(record(), { id: "222" })).toEqual(bad);
  });

  it("F183: an address may be an alias of the record, in any case; a lookup by id goes by the id", () => {
    const active = { kind: "status", status: "active" };
    const primary = { primaryEmail: "maxwell@acme.example" };
    expect(status(record({ ...primary, aliases: ["MAX@acme.example"] }))).toEqual(active);
    expect(status(record({ ...primary, nonEditableAliases: ["max@acme.example"] }))).toEqual(active);
    expect(status(record({ ...primary, emails: [null, { address: "max@acme.example" }] }))).toEqual(active);
    expect(status(record({ ...primary, aliases: "max@acme.example", emails: "max@acme.example" }))).toEqual({ kind: "connection_error", code: "bad_answer" });
    expect(status(record({ primaryEmail: "MAX@ACME.EXAMPLE" }))).toEqual(active);
    expect(status(record(primary), { id: "111" })).toEqual(active);
  });

  it("F184: only Google's own not-found is deleted; any other 404 is the connection's error", () => {
    const notFound = (error: Record<string, unknown>) => classifyDirectoryAnswer({ httpStatus: 404, body: { error } }, max);
    const deleted = { kind: "status", status: "deleted" };
    expect(notFound({ code: 404, message: "Resource Not Found: userKey", errors: [{ message: "Resource Not Found: userKey", domain: "global", reason: "notFound" }] })).toEqual(deleted);
    expect(notFound({ code: 404, status: "NOT_FOUND" })).toEqual(deleted);
    const bad = { kind: "connection_error", code: "bad_404" };
    for (const body of [null, "", "<html>404</html>", {}, [], { error: "nope" }, { error: { code: 404 } }, { error: { code: 404, errors: "notFound" } }, { error: { code: 404, errors: [null, { reason: "gone" }] } }, { error: { code: 500, status: "NOT_FOUND" } }]) {
      expect(classifyDirectoryAnswer({ httpStatus: 404, body }, max), JSON.stringify(body)).toEqual(bad);
    }
  });

  it("treats no answer, a 429 and a 5xx as unreachable", () => {
    expect(classifyDirectoryAnswer(null, max)).toEqual({ kind: "unreachable" });
    expect(classifyDirectoryAnswer({ httpStatus: 429, body: {} }, max)).toEqual({ kind: "unreachable" });
    expect(classifyDirectoryAnswer({ httpStatus: 503, body: {} }, max)).toEqual({ kind: "unreachable" });
  });

  it("treats every other refusal as the connection's error, never the member's status", () => {
    expect(classifyDirectoryAnswer({ httpStatus: 401, body: {} }, max)).toEqual({ kind: "connection_error", code: "http_401" });
    expect(classifyDirectoryAnswer({ httpStatus: 403, body: {} }, max)).toEqual({ kind: "connection_error", code: "http_403" });
    expect(classifyDirectoryAnswer({ httpStatus: 400, body: {} }, max)).toEqual({ kind: "connection_error", code: "http_400" });
  });
});

describe("isGoogleError", () => {
  it("needs Google's error object with that code", () => {
    expect(isGoogleError({ error: { code: 400 } }, 400)).toBe(true);
    for (const body of [null, "x", {}, { error: "x" }, { error: { code: 404 } }, { error: { code: "400" } }]) expect(isGoogleError(body, 400), JSON.stringify(body)).toBe(false);
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

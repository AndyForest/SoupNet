import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { checkDirectoryMember, testDirectoryCredential, forgetDirectoryTokens } from "./google-directory.service";
import type { GoogleOidcConfig } from "./google-oidc.service";

/**
 * The Directory API client, in process with an injected fetch (stream
 * Offboarding, rubric OB-M2). The live behaviour is in routes/directory.test.ts.
 */

const config: GoogleOidcConfig = {
  clientId: "client-1",
  clientSecret: "secret-1",
  redirectUri: "https://mcp.example.net/auth/google/callback",
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
  issuers: ["https://accounts.google.com"],
  testIssuer: false,
};

type Call = { url: string; init?: RequestInit };

function fakeFetch(answers: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    const call = { url, ...(init ? { init } : {}) };
    calls.push(call);
    const a = answers(call);
    return new Response(JSON.stringify(a.body), { status: a.status });
  };
  return { fn, calls };
}

const consent = { organizationId: "org-1", kind: "admin_consent" as const, adminEmail: "olive@acme.example", secret: "refresh-1" };

const NOT_FOUND = { error: { code: 404, message: "Resource Not Found: userKey", errors: [{ message: "Resource Not Found: userKey", domain: "global", reason: "notFound" }] } };

/** The record Google gives for a lookup: the address in its URL, or a `sub`. */
function record(url: string, over: Record<string, unknown> = {}) {
  const key = decodeURIComponent(url.split("/users/")[1]!.split("?")[0]!);
  return { id: key, primaryEmail: key, suspended: false, archived: false, ...over };
}

beforeEach(() => forgetDirectoryTokens());

describe("checkDirectoryMember", () => {
  it("refreshes a token once, then asks users.get by the member's own stored address", async () => {
    const f = fakeFetch((c) =>
      c.url === config.tokenEndpoint ? { status: 200, body: { access_token: "at-1", expires_in: 3600 } } : { status: 200, body: record(c.url, { suspended: true }) },
    );
    const first = await checkDirectoryMember(config, consent, { email: "max@acme.example", googleSubject: null }, f.fn);
    expect(first).toEqual({ answer: { kind: "status", status: "suspended" }, renamed: false });
    await checkDirectoryMember(config, consent, { email: "max2@acme.example", googleSubject: null }, f.fn);
    expect(f.calls.filter((c) => c.url === config.tokenEndpoint)).toHaveLength(1);
    const lookups = f.calls.filter((c) => c.url !== config.tokenEndpoint).map((c) => c.url);
    expect(lookups).toEqual([
      "https://admin.googleapis.com/admin/directory/v1/users/max%40acme.example?projection=basic&viewType=admin_view",
      "https://admin.googleapis.com/admin/directory/v1/users/max2%40acme.example?projection=basic&viewType=admin_view",
    ]);
    const body = new URLSearchParams(String(f.calls[0]!.init?.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-1");
  });

  it("treats a refused token as the connection's error", async () => {
    const f = fakeFetch(() => ({ status: 400, body: { error: "invalid_grant" } }));
    expect((await checkDirectoryMember(config, consent, { email: "max@acme.example", googleSubject: null }, f.fn)).answer).toEqual({ kind: "connection_error", code: "token_invalid_grant" });
  });

  it("asks once more by sub after a 404 by address, and reports a rename", async () => {
    const f = fakeFetch((c) => {
      if (c.url === config.tokenEndpoint) return { status: 200, body: { access_token: "at", expires_in: 3600 } };
      if (c.url.includes("max%40acme.example")) return { status: 404, body: NOT_FOUND };
      return { status: 200, body: record(c.url, { primaryEmail: "maxwell@acme.example" }) };
    });
    expect(await checkDirectoryMember(config, consent, { email: "max@acme.example", googleSubject: "sub-1" }, f.fn)).toEqual({
      answer: { kind: "status", status: "active" },
      renamed: true,
    });
  });

  /** Google answers `gone` and the `sub` as told, and knows the connection's admin. */
  const directory = (gone: { status: number; body: unknown }, subject: { status: number; body: unknown } = gone, admin?: { status: number; body: unknown }) =>
    fakeFetch((c) => {
      if (c.url === config.tokenEndpoint) return { status: 200, body: { access_token: "at" } };
      if (c.url.includes("olive%40")) return admin ?? { status: 200, body: record(c.url) };
      return c.url.includes("%40") ? gone : subject;
    });
  const gone = { email: "gone@acme.example", googleSubject: "sub-2" };
  const notFound = { status: 404, body: NOT_FOUND };

  it("is deleted only when both lookups say unknown, and undecided when the second can't answer", async () => {
    expect((await checkDirectoryMember(config, consent, gone, directory(notFound).fn)).answer).toEqual({ kind: "status", status: "deleted" });
    forgetDirectoryTokens();
    expect((await checkDirectoryMember(config, consent, gone, directory(notFound, { status: 400, body: { error: { code: 400 } } }).fn)).answer).toEqual({ kind: "status", status: "deleted" });
    forgetDirectoryTokens();
    expect((await checkDirectoryMember(config, consent, gone, directory(notFound, { status: 503, body: {} }).fn)).answer).toEqual({ kind: "unreachable" });
    forgetDirectoryTokens();
    expect((await checkDirectoryMember(config, consent, gone, directory(notFound, { status: 400, body: "<html>" }).fn)).answer).toEqual({ kind: "connection_error", code: "http_400" });
    forgetDirectoryTokens();
    expect((await checkDirectoryMember(config, consent, gone, directory(notFound, { status: 404, body: "<html>" }).fn)).answer).toEqual({ kind: "connection_error", code: "bad_404" });
  });

  it("F184: a 404 that isn't Google's asks no more and deletes nobody", async () => {
    const proxy = directory({ status: 404, body: "<html>not here</html>" });
    expect((await checkDirectoryMember(config, consent, gone, proxy.fn)).answer).toEqual({ kind: "connection_error", code: "bad_404" });
    expect(proxy.calls.filter((c) => c.url !== config.tokenEndpoint)).toHaveLength(1);
  });

  it("F184: `deleted` is believed only while the connection's own admin still resolves", async () => {
    const adminAnswers = async (admin: { status: number; body: unknown }, member = gone) => {
      forgetDirectoryTokens();
      return (await checkDirectoryMember(config, consent, member, directory(notFound, notFound, admin).fn)).answer;
    };
    expect(await adminAnswers(notFound)).toEqual({ kind: "connection_error", code: "admin_not_found" });
    expect(await adminAnswers({ status: 503, body: {} })).toEqual({ kind: "unreachable" });
    expect(await adminAnswers({ status: 403, body: {} })).toEqual({ kind: "connection_error", code: "http_403" });
    expect(await adminAnswers({ status: 200, body: {} })).toEqual({ kind: "connection_error", code: "bad_answer" });
    // Even suspended, the admin proves the directory still knows people.
    expect(await adminAnswers({ status: 200, body: { id: "o", primaryEmail: "olive@acme.example", suspended: true, archived: false } })).toEqual({ kind: "status", status: "deleted" });
    // The member being checked is the admin: that's the connection's problem, with no second lookup to make.
    forgetDirectoryTokens();
    const self = directory(notFound, notFound, notFound);
    expect((await checkDirectoryMember(config, consent, { email: "Olive@acme.example", googleSubject: null }, self.fn)).answer).toEqual({ kind: "connection_error", code: "admin_not_found" });
    expect(self.calls.filter((c) => c.url !== config.tokenEndpoint)).toHaveLength(1);
  });

  it("refuses a credential whose admin the directory doesn't know", async () => {
    expect(await testDirectoryCredential(config, consent, directory(notFound, notFound, notFound).fn)).toEqual({ kind: "connection_error", code: "admin_not_found" });
  });

  it("signs a JWT-bearer assertion for a service account, acting as the admin", async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const secret = JSON.stringify({ type: "service_account", client_email: "sa@p.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() });
    let assertion = "";
    const f = fakeFetch((c) => {
      if (c.url === config.tokenEndpoint) {
        assertion = new URLSearchParams(String(c.init?.body)).get("assertion") ?? "";
        return { status: 200, body: { access_token: "at" } };
      }
      return { status: 200, body: record(c.url) };
    });
    expect(await testDirectoryCredential(config, { organizationId: "org-2", kind: "service_account", adminEmail: "olive@acme.example", secret }, f.fn)).toBeNull();
    const claims = jwt.verify(assertion, publicKey, { algorithms: ["RS256"] }) as jwt.JwtPayload;
    expect(claims).toMatchObject({
      iss: "sa@p.iam.gserviceaccount.com",
      sub: "olive@acme.example",
      scope: "https://www.googleapis.com/auth/admin.directory.user.readonly",
      aud: config.tokenEndpoint,
    });
  });

  it("F183: a body that stalls after its headers is no answer, and a whole one that isn't a record is the connection's error", async () => {
    const stalled = (status: number) =>
      new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{")); c.error(new Error("aborted")); } }), { status });
    const lookupAnswering = (answer: () => Response) => async (url: string) =>
      url === config.tokenEndpoint ? new Response(JSON.stringify({ access_token: "at" })) : answer();
    const member = { email: "max@acme.example", googleSubject: null };
    expect((await checkDirectoryMember(config, consent, member, lookupAnswering(() => stalled(200)))).answer).toEqual({ kind: "unreachable" });
    forgetDirectoryTokens();
    expect((await checkDirectoryMember(config, consent, member, lookupAnswering(() => stalled(404)))).answer).toEqual({ kind: "unreachable" });
    forgetDirectoryTokens();
    expect((await checkDirectoryMember(config, consent, member, lookupAnswering(() => new Response("{\"primaryEmail\":")))).answer).toEqual({ kind: "connection_error", code: "bad_answer" });
    forgetDirectoryTokens();
    expect((await checkDirectoryMember(config, consent, member, async () => stalled(200))).answer).toEqual({ kind: "unreachable" });
  });

  it("gives up within the timeout on a network failure", async () => {
    const f = { fn: async () => { throw new Error("network"); } };
    expect((await checkDirectoryMember(config, consent, { email: "max@acme.example", googleSubject: null }, f.fn)).answer).toEqual({ kind: "unreachable" });
  });
});

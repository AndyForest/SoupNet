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

beforeEach(() => forgetDirectoryTokens());

describe("checkDirectoryMember", () => {
  it("refreshes a token once, then asks users.get by the member's own stored address", async () => {
    const f = fakeFetch((c) =>
      c.url === config.tokenEndpoint ? { status: 200, body: { access_token: "at-1", expires_in: 3600 } } : { status: 200, body: { suspended: true } },
    );
    const first = await checkDirectoryMember(config, consent, { email: "max@acme.example", googleSubject: null }, f.fn);
    expect(first).toEqual({ answer: { kind: "status", status: "suspended" }, renamedTo: null });
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
      if (c.url.includes("max%40acme.example")) return { status: 404, body: {} };
      return { status: 200, body: { primaryEmail: "maxwell@acme.example", suspended: false } };
    });
    expect(await checkDirectoryMember(config, consent, { email: "max@acme.example", googleSubject: "sub-1" }, f.fn)).toEqual({
      answer: { kind: "status", status: "active" },
      renamedTo: "maxwell@acme.example",
    });
  });

  it("is deleted only when both lookups say unknown, and undecided when the second can't answer", async () => {
    const unknown = fakeFetch((c) => (c.url === config.tokenEndpoint ? { status: 200, body: { access_token: "at" } } : { status: 404, body: {} }));
    expect((await checkDirectoryMember(config, consent, { email: "gone@acme.example", googleSubject: "sub-2" }, unknown.fn)).answer).toEqual({ kind: "status", status: "deleted" });
    forgetDirectoryTokens();
    const flaky = fakeFetch((c) => {
      if (c.url === config.tokenEndpoint) return { status: 200, body: { access_token: "at" } };
      return c.url.includes("%40") ? { status: 404, body: {} } : { status: 503, body: {} };
    });
    expect((await checkDirectoryMember(config, consent, { email: "gone@acme.example", googleSubject: "sub-2" }, flaky.fn)).answer).toEqual({ kind: "unreachable" });
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
      return { status: 200, body: {} };
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

  it("gives up within the timeout on a network failure", async () => {
    const f = { fn: async () => { throw new Error("network"); } };
    expect((await checkDirectoryMember(config, consent, { email: "max@acme.example", googleSubject: null }, f.fn)).answer).toEqual({ kind: "unreachable" });
  });
});

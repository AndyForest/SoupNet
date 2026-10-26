import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { oauthWellKnownRoutes } from "./oauth";

/**
 * The well-known documents, in process (no running backend): rubric O1-1,
 * O2-1, O2-2, O4-1, O5-1 and O7-1 (docs/planning/openai-plugin-build/oauth.md).
 * The live suite (oauth.test.ts) checks the same documents as served.
 */

const saved = { ...process.env };
beforeEach(() => {
  process.env["BACKEND_URL"] = "https://mcp.example.net";
  process.env["FRONTEND_URL"] = "https://www.example.net";
  delete process.env["OPENAI_APPS_CHALLENGE_TOKEN"];
});
afterEach(() => {
  process.env = { ...saved };
});

async function json(path: string): Promise<Record<string, unknown>> {
  const res = await oauthWellKnownRoutes.request(path);
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

describe("authorization server and protected resource metadata", () => {
  it("names one identifier as issuer, resource and authorization server (O1-1)", async () => {
    const as = await json("/oauth-authorization-server");
    const prm = await json("/oauth-protected-resource");
    expect(as["issuer"]).toBe("https://mcp.example.net");
    expect(prm["resource"]).toBe(as["issuer"]);
    expect(prm["authorization_servers"]).toEqual([as["issuer"]]);
  });

  it("strips a trailing slash from BACKEND_URL so the strings stay byte-identical", async () => {
    process.env["BACKEND_URL"] = "https://mcp.example.net/";
    const as = await json("/oauth-authorization-server");
    const prm = await json("/oauth-protected-resource");
    expect(as["issuer"]).toBe("https://mcp.example.net");
    expect(prm["resource"]).toBe("https://mcp.example.net");
  });

  it("advertises iss, CIMD, the client auth methods, OpenID scopes and UserInfo (O4-1, O5-1, O7-1)", async () => {
    const as = await json("/oauth-authorization-server");
    expect(as["authorization_response_iss_parameter_supported"]).toBe(true);
    expect(as["client_id_metadata_document_supported"]).toBe(true);
    expect(as["token_endpoint_auth_methods_supported"]).toEqual(["client_secret_post", "client_secret_basic", "none", "private_key_jwt"]);
    expect(as["token_endpoint_auth_signing_alg_values_supported"]).toEqual(["RS256", "ES256"]);
    expect(as["scopes_supported"]).toEqual(["read", "write", "openid", "email"]);
    expect(as["userinfo_endpoint"]).toBe("https://mcp.example.net/oauth/userinfo");
    expect(as["registration_endpoint"]).toBe("https://mcp.example.net/oauth/register");
    expect(as["code_challenge_methods_supported"]).toEqual(["S256"]);
  });
});

describe("/.well-known/openai-apps-challenge (O2)", () => {
  it("serves the token as plain text, exactly", async () => {
    process.env["OPENAI_APPS_CHALLENGE_TOKEN"] = "oai-challenge-abc123";
    const res = await oauthWellKnownRoutes.request("/openai-apps-challenge");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await res.text()).toBe("oai-challenge-abc123");
  });

  it("is 404 when the variable is unset or blank", async () => {
    expect((await oauthWellKnownRoutes.request("/openai-apps-challenge")).status).toBe(404);
    process.env["OPENAI_APPS_CHALLENGE_TOKEN"] = "   ";
    expect((await oauthWellKnownRoutes.request("/openai-apps-challenge")).status).toBe(404);
  });
});

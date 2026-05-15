import { describe, it, expect } from "vitest";

/**
 * Integration tests for OAuth metadata + DCR endpoints. Requires running
 * backend (skips otherwise — matches the rest of the integration suite).
 */

const BASE = process.env["BACKEND_URL"] ?? "";

interface DcrResponse {
  client_id?: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_name?: string | null;
  redirect_uris?: string[];
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  error?: string;
  error_description?: string;
}

describe.skipIf(!BASE)("/.well-known/oauth-authorization-server", () => {
  it("returns AS metadata with the required fields (RFC 8414)", async () => {
    const res = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body["issuer"]).toBe(BASE);
    expect(body["authorization_endpoint"]).toBe(`${BASE}/oauth/authorize`);
    expect(body["token_endpoint"]).toBe(`${BASE}/oauth/token`);
    expect(body["registration_endpoint"]).toBe(`${BASE}/oauth/register`);
    expect(body["response_types_supported"]).toEqual(["code"]);
    expect(body["grant_types_supported"]).toContain("authorization_code");
    expect(body["grant_types_supported"]).toContain("refresh_token");
    expect(body["code_challenge_methods_supported"]).toEqual(["S256"]);
    expect(Array.isArray(body["scopes_supported"])).toBe(true);
  });
});

describe.skipIf(!BASE)("/.well-known/oauth-protected-resource", () => {
  it("returns protected resource metadata pointing back to the AS (RFC 9728)", async () => {
    const res = await fetch(`${BASE}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body["resource"]).toBe(BASE);
    expect(body["authorization_servers"]).toEqual([BASE]);
  });
});

describe.skipIf(!BASE)("POST /oauth/register — Dynamic Client Registration", () => {
  it("registers a client with valid redirect_uris and returns credentials", async () => {
    const res = await fetch(`${BASE}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        client_name: "Test Client",
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as DcrResponse;
    expect(body.client_id).toMatch(/^oauth_/);
    expect(typeof body.client_secret).toBe("string");
    expect((body.client_secret ?? "").length).toBeGreaterThan(20);
    expect(body.client_name).toBe("Test Client");
    expect(body.redirect_uris).toEqual(["https://claude.ai/api/mcp/auth_callback"]);
    expect(body.token_endpoint_auth_method).toBe("client_secret_post");
    expect(body.grant_types).toContain("authorization_code");
    expect(body.response_types).toEqual(["code"]);
    expect(typeof body.client_id_issued_at).toBe("number");
  });

  it("issues unique client_id + client_secret per registration", async () => {
    const reg = async () => {
      const res = await fetch(`${BASE}/oauth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }),
      });
      return (await res.json()) as DcrResponse;
    };
    const a = await reg();
    const b = await reg();
    expect(a.client_id).not.toBe(b.client_id);
    expect(a.client_secret).not.toBe(b.client_secret);
  });

  it("rejects a missing redirect_uris field", async () => {
    const res = await fetch(`${BASE}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "no uris" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as DcrResponse;
    expect(body.error).toBe("invalid_redirect_uri");
  });

  it("rejects an empty redirect_uris array", async () => {
    const res = await fetch(`${BASE}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects http:// redirect_uri for non-localhost hosts", async () => {
    const res = await fetch(`${BASE}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["http://example.com/cb"] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as DcrResponse;
    expect(body.error).toBe("invalid_redirect_uri");
  });

  it("accepts http://localhost redirect_uri for development", async () => {
    const res = await fetch(`${BASE}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["http://localhost:3000/cb"] }),
    });
    expect(res.status).toBe(201);
  });

  it("rejects malformed JSON", async () => {
    const res = await fetch(`${BASE}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as DcrResponse;
    expect(body.error).toBe("invalid_client_metadata");
  });
});

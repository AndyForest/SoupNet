import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateReturnTarget } from "./google-sign-in.service";
import { resetCimdStateForTests } from "./oauth-cimd.service";
import type { Fetcher } from "./oauth-cimd.service";

/**
 * SSO-G8 (docs/planning/org-accounts-build/sso.md): Google sign-in's start
 * accepts a consent page's client exactly as the grant does, through stream
 * O's resolver, so a client ID metadata document client (ChatGPT's) can sign
 * in with Google and come back. No network and no database: the document
 * fetcher is injected, and a metadata-document client never reads the
 * registered-client table.
 */

const CLIENT_ID = "https://client.example.com/oauth/client.json";
const REDIRECT = "https://client.example.com/connector_platform_oauth_redirect";
const savedEnv = { ...process.env };

beforeEach(() => {
  resetCimdStateForTests();
  process.env["BACKEND_URL"] = "https://mcp.example.net";
  process.env["FRONTEND_URL"] = "https://www.example.net";
  delete process.env["OAUTH_CIMD_DENIED_HOSTS"];
});
afterEach(() => {
  process.env = { ...savedEnv };
});

const noDb = { execute: () => { throw new Error("a metadata-document client reads no table"); } } as never;

function serving(doc: Record<string, unknown> | null): Fetcher {
  return async (url) => (doc && url === CLIENT_ID ? { ok: true, body: JSON.stringify(doc) } : { ok: false, reason: "status 404" });
}

const document = { client_id: CLIENT_ID, client_name: "Example Client", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" };

function target(overrides: Record<string, string> = {}) {
  return {
    kind: "oauth_authorize",
    params: {
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      state: "s",
      code_challenge: "c".repeat(43),
      code_challenge_method: "S256",
      scope: "read write",
      resource: "https://mcp.example.net/mcp",
      ...overrides,
    },
  };
}

describe("validateReturnTarget with a client ID metadata document client (SSO-G8)", () => {
  it("accepts the client, its registered redirect and an accepted resource, keeping the parameters as sent", async () => {
    const result = await validateReturnTarget(noDb, target(), "1.2.3.4", { fetch: serving(document) });
    expect(result).toEqual({ kind: "oauth_authorize", params: target().params });
  });

  it("refuses what the grant refuses: another redirect, a document that doesn't resolve, a resource elsewhere", async () => {
    expect(await validateReturnTarget(noDb, target({ redirect_uri: "https://client.example.com/other" }), "1.2.3.4", { fetch: serving(document) })).toBeNull();
    resetCimdStateForTests(); // the resolver caches a document it fetched
    expect(await validateReturnTarget(noDb, target(), "1.2.3.4", { fetch: serving(null) })).toBeNull();
    expect(await validateReturnTarget(noDb, target({ resource: "https://elsewhere.example.com" }), "1.2.3.4", { fetch: serving(document) })).toBeNull();
  });
});

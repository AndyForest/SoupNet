/**
 * A fake Google for the Layer 3 suites (organization accounts round 1,
 * streams SSO and Offboarding). Test-only: started once per vitest run by
 * test-google-global-setup.ts when GOOGLE_OIDC_TEST_ISSUER is set, never
 * mounted by the server.
 *
 * The backend under test is started with GOOGLE_OIDC_TEST_ISSUER pointing
 * here (honoured only outside production) and the same client id and secret.
 * It serves what the backend calls:
 *   GET  /certs                         the signing keys (JWKS)
 *   POST /token                         authorization_code (checks the client
 *                                       credentials and the PKCE verifier,
 *                                       redeems each code once), refresh_token,
 *                                       and the JWT-bearer grant for service
 *                                       accounts (checks the assertion's
 *                                       signature against a registered key)
 *   GET  /directory/users/:userKey      the Directory API's users.get
 * and, for test files running in other processes, control routes:
 *   POST /__fake/codes                  { claims, nonce, codeChallenge, refreshToken? } → { code }
 *   PUT  /__fake/directory/:userKey     { suspended?, archived?, httpStatus?, delayMs? }
 *   POST /__fake/service-accounts       { clientEmail, publicKeyPem }
 *   POST /__fake/revoke                 every access and refresh token stops working
 *   GET  /__fake/stats                  { tokenRequests, directoryRequests: { [userKey]: n } }
 */

import http from "node:http";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";

export interface FakeIdClaims {
  sub: string;
  email: string;
  email_verified?: boolean | string;
  hd?: string;
  name?: string;
  [claim: string]: unknown;
}

interface PendingCode {
  claims: FakeIdClaims;
  nonce: string;
  codeChallenge: string;
  refreshToken: string | null;
}

interface DirectoryEntry {
  suspended?: boolean;
  archived?: boolean;
  httpStatus?: number;
  delayMs?: number;
}

const DIRECTORY_SCOPE = "https://www.googleapis.com/auth/admin.directory.user.readonly";

export async function startFakeGoogleIssuer(opts: {
  issuer: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ close(): Promise<void> }> {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = `fake-${crypto.randomBytes(4).toString("hex")}`;
  const jwks = { keys: [{ ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>), kid, alg: "RS256", use: "sig" }] };
  const codes = new Map<string, PendingCode>();
  const refreshTokens = new Set<string>();
  const accessTokens = new Set<string>();
  const serviceAccounts = new Map<string, crypto.KeyObject>();
  const directory = new Map<string, DirectoryEntry>();
  const directoryRequests: Record<string, number> = {};
  let tokenRequests = 0;

  function json(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }

  function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
      req.on("end", () => resolve(body));
    });
  }

  function newAccessToken(): string {
    const token = crypto.randomBytes(24).toString("base64url");
    accessTokens.add(token);
    return token;
  }

  async function token(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    tokenRequests++;
    const form = new URLSearchParams(await readBody(req));
    const grant = form.get("grant_type");
    if (grant === "urn:ietf:params:oauth:grant-type:jwt-bearer") {
      const assertion = form.get("assertion") ?? "";
      const decoded = jwt.decode(assertion) as { iss?: string; scope?: string } | null;
      const key = decoded?.iss ? serviceAccounts.get(decoded.iss) : undefined;
      if (!key) return json(res, 400, { error: "invalid_grant" });
      try {
        jwt.verify(assertion, key, { algorithms: ["RS256"], audience: `${opts.issuer}/token` });
      } catch {
        return json(res, 400, { error: "invalid_grant" });
      }
      if (decoded?.scope !== DIRECTORY_SCOPE) return json(res, 400, { error: "invalid_scope" });
      return json(res, 200, { access_token: newAccessToken(), token_type: "Bearer", expires_in: 3600 });
    }
    if (form.get("client_id") !== opts.clientId || form.get("client_secret") !== opts.clientSecret) return json(res, 401, { error: "invalid_client" });
    if (grant === "refresh_token") {
      if (!refreshTokens.has(form.get("refresh_token") ?? "")) return json(res, 400, { error: "invalid_grant" });
      return json(res, 200, { access_token: newAccessToken(), token_type: "Bearer", expires_in: 3600 });
    }
    if (grant !== "authorization_code") return json(res, 400, { error: "unsupported_grant_type" });
    const code = form.get("code") ?? "";
    const pending = codes.get(code);
    codes.delete(code);
    if (!pending) return json(res, 400, { error: "invalid_grant" });
    const challenge = crypto.createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
    if (challenge !== pending.codeChallenge) return json(res, 400, { error: "invalid_grant" });
    const idToken = jwt.sign(
      { email_verified: true, ...pending.claims, iss: opts.issuer, aud: opts.clientId, nonce: pending.nonce },
      privateKey,
      { algorithm: "RS256", keyid: kid, expiresIn: "5m" },
    );
    if (pending.refreshToken) refreshTokens.add(pending.refreshToken);
    return json(res, 200, {
      id_token: idToken,
      access_token: newAccessToken(),
      token_type: "Bearer",
      expires_in: 3600,
      ...(pending.refreshToken ? { refresh_token: pending.refreshToken } : {}),
    });
  }

  async function directoryUser(req: http.IncomingMessage, res: http.ServerResponse, userKey: string): Promise<void> {
    directoryRequests[userKey] = (directoryRequests[userKey] ?? 0) + 1;
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (!accessTokens.has(bearer)) return json(res, 401, { error: { code: 401, message: "Invalid Credentials" } });
    const entry = directory.get(userKey);
    if (entry?.delayMs) await new Promise((r) => setTimeout(r, entry.delayMs));
    if (entry?.httpStatus) return json(res, entry.httpStatus, { error: { code: entry.httpStatus } });
    if (!entry) return json(res, 404, { error: { code: 404, message: "Resource Not Found: userKey" } });
    return json(res, 200, { kind: "admin#directory#user", primaryEmail: userKey, suspended: !!entry.suspended, archived: !!entry.archived });
  }

  async function control(req: http.IncomingMessage, res: http.ServerResponse, path: string): Promise<void> {
    if (req.method === "POST" && path === "/__fake/codes") {
      const body = JSON.parse(await readBody(req)) as { claims: FakeIdClaims; nonce: string; codeChallenge: string; refreshToken?: string };
      const code = crypto.randomBytes(16).toString("base64url");
      codes.set(code, { claims: body.claims, nonce: body.nonce, codeChallenge: body.codeChallenge, refreshToken: body.refreshToken ?? null });
      return json(res, 200, { code });
    }
    if (req.method === "PUT" && path.startsWith("/__fake/directory/")) {
      directory.set(decodeURIComponent(path.slice("/__fake/directory/".length)), JSON.parse(await readBody(req)) as DirectoryEntry);
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && path === "/__fake/service-accounts") {
      const body = JSON.parse(await readBody(req)) as { clientEmail: string; publicKeyPem: string };
      serviceAccounts.set(body.clientEmail, crypto.createPublicKey(body.publicKeyPem));
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && path === "/__fake/revoke") {
      accessTokens.clear();
      refreshTokens.clear();
      return json(res, 200, { ok: true });
    }
    if (req.method === "GET" && path === "/__fake/stats") {
      return json(res, 200, { tokenRequests, directoryRequests });
    }
    return json(res, 404, {});
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", opts.issuer);
    const path = url.pathname;
    const done = (p: Promise<void>) => void p.catch(() => json(res, 500, {}));
    if (req.method === "GET" && path === "/certs") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "public, max-age=3600" });
      res.end(JSON.stringify(jwks));
      return;
    }
    if (req.method === "POST" && path === "/token") return done(token(req, res));
    if (req.method === "GET" && path.startsWith("/directory/users/")) return done(directoryUser(req, res, decodeURIComponent(path.slice("/directory/users/".length))));
    if (path.startsWith("/__fake/")) return done(control(req, res, path));
    res.writeHead(404);
    res.end();
  });

  const port = Number(new URL(opts.issuer).port);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  return { close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/** The test files' side: drive the fake over HTTP from any process. */
export function fakeGoogle(issuer: string) {
  async function post(path: string, body: unknown, method = "POST"): Promise<unknown> {
    const res = await fetch(`${issuer}${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`fake Google ${path}: ${res.status}`);
    return res.json();
  }
  return {
    async issue(claims: FakeIdClaims, binding: { nonce: string; codeChallenge: string; refreshToken?: string }): Promise<string> {
      return ((await post("/__fake/codes", { claims, ...binding })) as { code: string }).code;
    },
    async setDirectoryUser(userKey: string, entry: DirectoryEntry): Promise<void> {
      await post(`/__fake/directory/${encodeURIComponent(userKey)}`, entry, "PUT");
    },
    async addServiceAccount(clientEmail: string, publicKeyPem: string): Promise<void> {
      await post("/__fake/service-accounts", { clientEmail, publicKeyPem });
    },
    async revokeAll(): Promise<void> {
      await post("/__fake/revoke", {});
    },
    async stats(): Promise<{ tokenRequests: number; directoryRequests: Record<string, number> }> {
      return (await (await fetch(`${issuer}/__fake/stats`)).json()) as { tokenRequests: number; directoryRequests: Record<string, number> };
    },
  };
}

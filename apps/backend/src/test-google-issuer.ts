/**
 * A fake Google for the Layer 3 suite (organization accounts round 1, stream
 * SSO, rubric SSO-G2). Test-only: imported by tests, never mounted by the
 * server.
 *
 * The backend under test is started with GOOGLE_OIDC_TEST_ISSUER pointing at
 * this server (honoured only outside production) and the same client id and
 * secret as the test process. The test starts the backend's flow, reads the
 * state, nonce and PKCE challenge off the authorization URL, registers the
 * claims the next ID token should carry with `issue`, and calls the
 * backend's callback with the returned code. The token endpoint checks the
 * client credentials and the PKCE verifier as Google does, redeems each code
 * once, and signs RS256 with a key it publishes at /certs.
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
}

export interface FakeGoogleIssuer {
  issuer: string;
  /** Register the claims for the next sign-in; returns the authorization code. */
  issue(claims: FakeIdClaims, binding: { nonce: string; codeChallenge: string }): string;
  /** How many token requests reached the fake (replay tests assert none). */
  tokenRequests(): number;
  close(): Promise<void>;
}

export async function startFakeGoogleIssuer(opts: {
  issuer: string;
  clientId: string;
  clientSecret: string;
}): Promise<FakeGoogleIssuer> {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = `fake-${crypto.randomBytes(4).toString("hex")}`;
  const jwks = { keys: [{ ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>), kid, alg: "RS256", use: "sig" }] };
  const codes = new Map<string, PendingCode>();
  let tokenRequests = 0;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", opts.issuer);
    if (req.method === "GET" && url.pathname === "/certs") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "public, max-age=3600" });
      res.end(JSON.stringify(jwks));
      return;
    }
    if (req.method === "POST" && url.pathname === "/token") {
      tokenRequests++;
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
      req.on("end", () => {
        const form = new URLSearchParams(body);
        const fail = (error: string) => {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error }));
        };
        if (form.get("client_id") !== opts.clientId || form.get("client_secret") !== opts.clientSecret) return fail("invalid_client");
        if (form.get("grant_type") !== "authorization_code") return fail("unsupported_grant_type");
        const code = form.get("code") ?? "";
        const pending = codes.get(code);
        codes.delete(code);
        if (!pending) return fail("invalid_grant");
        const verifier = form.get("code_verifier") ?? "";
        const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
        if (challenge !== pending.codeChallenge) return fail("invalid_grant");
        const idToken = jwt.sign(
          { email_verified: true, ...pending.claims, iss: opts.issuer, aud: opts.clientId, nonce: pending.nonce },
          privateKey,
          { algorithm: "RS256", keyid: kid, expiresIn: "5m" },
        );
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id_token: idToken, access_token: "fake-access-token", token_type: "Bearer", expires_in: 3600 }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const port = Number(new URL(opts.issuer).port);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  return {
    issuer: opts.issuer,
    issue(claims, binding) {
      const code = crypto.randomBytes(16).toString("base64url");
      codes.set(code, { claims, nonce: binding.nonce, codeChallenge: binding.codeChallenge });
      return code;
    },
    tokenRequests: () => tokenRequests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

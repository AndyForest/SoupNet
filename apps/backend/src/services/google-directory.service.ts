/**
 * The Google Workspace Directory API, for offboarding (organization accounts
 * round 1, stream Offboarding; rubric docs/planning/org-accounts-build/
 * offboarding.md, OB-M2).
 *
 * Two ways to get an access token, one per connection kind: a refresh token
 * a Workspace admin granted by consenting to the read-only directory scope,
 * or the customer's service-account key signing a JWT-bearer assertion that
 * acts as their admin. Tokens are cached per organization in memory until a
 * minute before they expire. Then `users.get` for one member.
 *
 * The whole check, token included, gets DIRECTORY_TIMEOUT_MS. Nothing here
 * logs a credential or a token; callers log the organization id and Google's
 * error code only.
 */

import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { DIRECTORY_SCOPE, DIRECTORY_TIMEOUT_MS, classifyDirectoryAnswer, parseServiceAccountKey } from "@soupnet/domain";
import type { DirectoryAnswer } from "@soupnet/domain";
import type { FetchLike, GoogleOidcConfig } from "./google-oidc.service";

const DIRECTORY_USERS_ENDPOINT = "https://admin.googleapis.com/admin/directory/v1/users/";

export interface DirectoryCredential {
  organizationId: string;
  kind: "admin_consent" | "service_account";
  adminEmail: string;
  /** The opened credential: a refresh token, or a service-account JSON key. */
  secret: string;
}

/** What one check found. `renamedTo` is a rename the admin should hear about. */
export interface MemberCheck {
  answer: DirectoryAnswer;
  renamedTo: string | null;
}

function usersEndpoint(config: GoogleOidcConfig): string {
  return config.testIssuer ? `${config.issuers[0]}/directory/users/` : DIRECTORY_USERS_ENDPOINT;
}

const tokenCache = new Map<string, { token: string; expiresAt: number; fingerprint: string }>();

/** Forget cached tokens (a connection replaced or removed; tests). */
export function forgetDirectoryTokens(organizationId?: string): void {
  if (organizationId) tokenCache.delete(organizationId);
  else tokenCache.clear();
}

type TokenResult = { ok: true; token: string } | { ok: false; answer: DirectoryAnswer };

async function accessToken(
  config: GoogleOidcConfig,
  credential: DirectoryCredential,
  signal: AbortSignal,
  fetchImpl: FetchLike,
): Promise<TokenResult> {
  const fingerprint = crypto.createHash("sha256").update(credential.secret).digest("base64url");
  const cached = tokenCache.get(credential.organizationId);
  if (cached && cached.fingerprint === fingerprint && cached.expiresAt > Date.now() + 60_000) return { ok: true, token: cached.token };

  let body: URLSearchParams;
  if (credential.kind === "admin_consent") {
    body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credential.secret,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });
  } else {
    const parsed = parseServiceAccountKey(credential.secret);
    if (!parsed.ok) return { ok: false, answer: { kind: "connection_error", code: "bad_service_account_key" } };
    let assertion: string;
    try {
      assertion = jwt.sign(
        { iss: parsed.key.clientEmail, sub: credential.adminEmail, scope: DIRECTORY_SCOPE, aud: config.tokenEndpoint },
        parsed.key.privateKey,
        { algorithm: "RS256", expiresIn: 3600 },
      );
    } catch {
      return { ok: false, answer: { kind: "connection_error", code: "bad_service_account_key" } };
    }
    body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion });
  }

  let res: Response;
  try {
    res = await fetchImpl(config.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: body.toString(),
      signal,
    });
  } catch {
    return { ok: false, answer: { kind: "unreachable" } };
  }
  const json = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown; error?: unknown } | null;
  if (res.status === 429 || res.status >= 500) return { ok: false, answer: { kind: "unreachable" } };
  if (!res.ok || typeof json?.access_token !== "string") {
    const code = typeof json?.error === "string" ? json.error.replace(/[^a-z_]/gi, "").slice(0, 40) : `http_${res.status}`;
    return { ok: false, answer: { kind: "connection_error", code: `token_${code}` } };
  }
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
  tokenCache.set(credential.organizationId, { token: json.access_token, expiresAt: Date.now() + expiresIn * 1000, fingerprint });
  return { ok: true, token: json.access_token };
}

async function usersGet(
  config: GoogleOidcConfig,
  token: string,
  userKey: string,
  signal: AbortSignal,
  fetchImpl: FetchLike,
): Promise<{ httpStatus: number; body: unknown } | null> {
  try {
    const res = await fetchImpl(`${usersEndpoint(config)}${encodeURIComponent(userKey)}?projection=basic&viewType=admin_view`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal,
    });
    return { httpStatus: res.status, body: await res.json().catch(() => null) };
  } catch {
    return null;
  }
}

/**
 * Check one member: by their stored address, and on a 404 once more by their
 * linked Google identity's `sub` when they have one, since a renamed person
 * whose old address isn't kept as an alias reads as unknown by address
 * (planning session, 2026-10-26). Only a 404 on both is `deleted`. A hit by
 * `sub` whose primary address differs is a rename, reported for the admin.
 * The member is the one whose credential is being judged; nothing here takes
 * a key from a request.
 */
export async function checkDirectoryMember(
  config: GoogleOidcConfig,
  credential: DirectoryCredential,
  member: { email: string; googleSubject: string | null },
  fetchImpl: FetchLike = fetch,
): Promise<MemberCheck> {
  const signal = AbortSignal.timeout(DIRECTORY_TIMEOUT_MS);
  const token = await accessToken(config, credential, signal, fetchImpl);
  if (!token.ok) return { answer: token.answer, renamedTo: null };

  const byAddress = await usersGet(config, token.token, member.email, signal, fetchImpl);
  const first = classifyDirectoryAnswer(byAddress);
  if (first.kind === "connection_error" && (byAddress?.httpStatus === 401)) forgetDirectoryTokens(credential.organizationId);
  if (!(first.kind === "status" && first.status === "deleted") || !member.googleSubject) return { answer: first, renamedTo: null };

  const bySubject = await usersGet(config, token.token, member.googleSubject, signal, fetchImpl);
  // A 400 means the directory doesn't take this `sub` as a user id, which is
  // as good as unknown; a 404 is unknown. Anything else that isn't a user
  // (slow, down, our credential refused) leaves the question open, so nobody
  // is switched off on half an answer.
  if (bySubject?.httpStatus === 400 || bySubject?.httpStatus === 404) return { answer: first, renamedTo: null };
  const second = classifyDirectoryAnswer(bySubject);
  if (second.kind !== "status") return { answer: second.kind === "connection_error" ? second : { kind: "unreachable" }, renamedTo: null };
  const primary = (bySubject?.body as { primaryEmail?: unknown } | null)?.primaryEmail;
  const renamedTo = typeof primary === "string" && primary.toLowerCase() !== member.email.toLowerCase() ? primary : null;
  return { answer: second, renamedTo };
}

/**
 * Prove a credential works before storing it (OB-K2, OB-K3): look up the
 * admin it acts as. Returns null when it works, else the answer that says why not.
 */
export async function testDirectoryCredential(
  config: GoogleOidcConfig,
  credential: DirectoryCredential,
  fetchImpl: FetchLike = fetch,
): Promise<DirectoryAnswer | null> {
  forgetDirectoryTokens(credential.organizationId);
  const check = await checkDirectoryMember(config, credential, { email: credential.adminEmail, googleSubject: null }, fetchImpl);
  forgetDirectoryTokens(credential.organizationId);
  return check.answer.kind === "status" && check.answer.status !== "deleted" ? null : check.answer;
}

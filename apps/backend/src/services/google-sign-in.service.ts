/**
 * Sign in with Google: the pending request, the account a verified sign-in
 * belongs to, and the handoff to the SPA (organization accounts round 1,
 * stream SSO; rubric docs/planning/org-accounts-build/sso.md).
 *
 * The round trip, end to end:
 *   1. `beginGoogleSignIn`: the SPA sends the SHA-256 of a secret its tab
 *      keeps, and where to return. The return target is validated here (an
 *      in-app path, or the consent page's parameters checked as the grant
 *      checks them) and stored; a pending record keyed by the hash of an
 *      opaque `state` holds the nonce and PKCE verifier for Google.
 *   2. `completeGoogleSignIn`: Google's redirect consumes the record once
 *      (a replay or an unknown state is the same `expired`), the code is
 *      exchanged and the ID token verified, and the account is resolved,
 *      linked or created in one transaction. The callback mints a 60-second
 *      handoff code, stored hashed.
 *   3. `exchangeHandoff`: the SPA trades the handoff code and its secret for
 *      a session. A wrong secret burns nothing, and every refusal looks the
 *      same, so an attacker's handoff URL is useless in a victim's tab
 *      (recipe 49937af3).
 *
 * Which account: `resolveGoogleSignIn` in @soupnet/domain (recipe 3a943b1c).
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import { isRegisteredRedirectUri } from "@soupnet/contracts/oauth-redirect";
import {
  googleIsAuthoritative,
  googleSessionIdp,
  resolveGoogleSignIn,
  safeAppReturnPath,
} from "@soupnet/domain";
import type { GoogleSessionIdp, GoogleSignInError } from "@soupnet/domain";
import { createAccount } from "../auth";
import type { JwtPayload } from "../auth";
import { normalizeEmail } from "../lib/normalize-email";
import { accountRefusal, invalidateSessions, sessionState, ssoRequiredFor } from "../authz";
import { mayRegister, logSignupCapState } from "./system-settings.service";
import { sendVerificationEmail } from "./email.service";
import { resolveOAuthClient } from "./oauth-cimd.service";
import type { CimdDeps } from "./oauth-cimd.service";
import { normalizeResource } from "../lib/oauth-resource";
import {
  buildGoogleAuthorizationUrl,
  exchangeGoogleCode,
  verifyGoogleIdToken,
  pkceChallenge,
  randomToken,
  GoogleOidcError,
} from "./google-oidc.service";
import type { GoogleOidcConfig, GoogleIdClaims, KeySource, FetchLike } from "./google-oidc.service";

type SqlExecutor = Pick<PostgresJsDatabase, "execute">;
type Tx = Parameters<Parameters<PostgresJsDatabase["transaction"]>[0]>[0];

const REQUEST_TTL_SECONDS = 10 * 60;
const HANDOFF_TTL_SECONDS = 60;
const MAX_PARAM_LENGTH = 2048;

/** SHA-256, base64url: how states, handoff codes and binding secrets are stored. */
function hashToken(token: string): string {
  return pkceChallenge(token);
}

// ── Return targets ───────────────────────────────────────────────────────────

/** The consent page's query parameters, carried through the round trip (SSO-G1). */
export const AUTHORIZE_PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "state",
  "code_challenge",
  "code_challenge_method",
  "scope",
  "resource",
] as const;
export type AuthorizeParams = Record<(typeof AUTHORIZE_PARAMS)[number], string>;

export type ReturnTarget =
  | { kind: "app"; path: string }
  | { kind: "oauth_authorize"; params: AuthorizeParams };

const DEFAULT_RETURN: ReturnTarget = { kind: "app", path: "/app/dashboard" };

/**
 * Would the consent page's grant accept this client, redirect URI and
 * resource? The client through stream O's resolver, as the grant resolves
 * it: a dynamically registered client, or a client ID metadata document
 * fetched under the requester's per-IP cap (ChatGPT's). The redirect URI by
 * the grant's and the page's one rule (F44, F130), and the resource one the
 * grant would bind a token to (RFC 8707; SSO-G8).
 */
async function authorizeTargetAllowed(db: SqlExecutor, params: AuthorizeParams, deps: CimdDeps): Promise<boolean> {
  if (!normalizeResource(params.resource).ok) return false;
  const client = await resolveOAuthClient(db as PostgresJsDatabase, params.client_id, deps);
  return !!client && isRegisteredRedirectUri(params.redirect_uri, client.redirectUris);
}

/**
 * Validate where a sign-in returns to. Absent means the dashboard. Null for
 * anything the server would not send a person to: an off-app path, or
 * authorize parameters the consent page's grant would refuse.
 */
export async function validateReturnTarget(db: SqlExecutor, raw: unknown, ip: string, cimd: Omit<CimdDeps, "ip"> = {}): Promise<ReturnTarget | null> {
  if (raw === undefined || raw === null) return DEFAULT_RETURN;
  if (typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r["kind"] === "app") {
    const path = typeof r["path"] === "string" ? safeAppReturnPath(r["path"]) : null;
    return path && path.startsWith("/app/") ? { kind: "app", path } : null;
  }
  if (r["kind"] !== "oauth_authorize") return null;
  const given = r["params"];
  if (!given || typeof given !== "object") return null;
  const params = {} as AuthorizeParams;
  for (const name of AUTHORIZE_PARAMS) {
    const value = (given as Record<string, unknown>)[name] ?? "";
    if (typeof value !== "string" || value.length > MAX_PARAM_LENGTH) return null;
    params[name] = value;
  }
  if (params.response_type !== "code" || params.code_challenge_method !== "S256") return null;
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(params.code_challenge)) return null;
  if (!params.client_id || !params.redirect_uri) return null;
  if (!(await authorizeTargetAllowed(db, params, { ...cimd, ip }))) return null;
  return { kind: "oauth_authorize", params };
}

/** The SPA path a sign-in lands on. */
export function returnPathOf(target: ReturnTarget): string {
  if (target.kind === "app") return target.path;
  const query = new URLSearchParams();
  for (const name of AUTHORIZE_PARAMS) if (target.params[name]) query.set(name, target.params[name]);
  return `/oauth/authorize?${query.toString()}`;
}

// ── 1. Begin ─────────────────────────────────────────────────────────────────

/** Drop request rows older than a day (on every start, and hourly from the worker). */
export async function sweepSsoLoginRequests(db: SqlExecutor): Promise<void> {
  await db.execute(sql`DELETE FROM claimnet.sso_login_requests WHERE created_at < now() - interval '1 day'`);
}

/** Store a pending sign-in and return Google's authorization URL (SSO-G1). */
export async function beginGoogleSignIn(
  db: SqlExecutor,
  config: GoogleOidcConfig,
  input: { binding: string; target: ReturnTarget },
): Promise<string> {
  await sweepSsoLoginRequests(db);
  const state = randomToken();
  const nonce = randomToken();
  const codeVerifier = randomToken();
  await db.execute(sql`
    INSERT INTO claimnet.sso_login_requests
      (state_hash, nonce, code_verifier, binding_hash, return_kind, return_params, expires_at)
    VALUES (
      ${hashToken(state)}, ${nonce}, ${codeVerifier}, ${input.binding},
      ${input.target.kind}, ${JSON.stringify(input.target.kind === "app" ? { path: input.target.path } : input.target.params)}::jsonb,
      now() + make_interval(secs => ${REQUEST_TTL_SECONDS})
    )
  `);
  return buildGoogleAuthorizationUrl(config, { state, nonce, codeChallenge: pkceChallenge(codeVerifier) });
}

// ── 2. Complete ──────────────────────────────────────────────────────────────

export type JoinHookResult = "joined" | "full" | "none";

/**
 * Stream Domains' hook (rubric SSO-A10): runs inside the transaction that
 * creates or links an account from a Google sign-in, after the account and
 * identity rows exist and before account state is judged. Domains replaces
 * this body with its auto-join on `hd` (`onGoogleSignIn`, PR #158) and
 * touches nothing else here. "full" for a new account rolls the sign-up back
 * with `organization_full`; for an existing account it changes nothing.
 */
export async function afterGoogleSignIn(
  _tx: SqlExecutor,
  _input: { userId: string; email: string; hd: string | null; created: boolean },
): Promise<JoinHookResult> {
  return "none";
}

class Rollback extends Error {
  constructor(readonly outcome: GoogleSignInError) {
    super(outcome);
  }
}

export interface ResolvedAccount {
  userId: string;
  created: boolean;
  /** The sign-up landed on the waitlist (the cap was full). */
  waitlisted: boolean;
  /** Our verification email to send after commit (a non-authoritative sign-up). */
  verificationToken: string | null;
  email: string;
}

/**
 * Find, link or create the account for a verified Google sign-in, in one
 * transaction (SSO-A1 to SSO-A6, SSO-A10).
 */
export async function resolveAccount(
  db: PostgresJsDatabase,
  claims: GoogleIdClaims,
  // The hook is a parameter only so the Layer 3 suite can stand in for
  // Domains' answer; the callback always passes the real one.
  joinHook: typeof afterGoogleSignIn = afterGoogleSignIn,
): Promise<ResolvedAccount | GoogleSignInError> {
  const authoritative = googleIsAuthoritative(claims);
  const email = normalizeEmail(claims.email);
  try {
    return await db.transaction(async (tx) => {
      // The account's row before its identities, in id order if the two differ.
      // Everything that removes an identity holds that row first, and a reset
      // takes it first anyway, so the opposite order here deadlocks with them (F163).
      await tx.execute(sql`
        SELECT u.id FROM claimnet.users u
        WHERE u.email = ${email}
           OR u.id = (SELECT i.user_id FROM claimnet.user_identities i WHERE i.issuer = ${claims.issuer} AND i.subject = ${claims.subject})
        ORDER BY u.id
        FOR UPDATE OF u
      `);

      const identityRows = await tx.execute(sql`
        SELECT user_id FROM claimnet.user_identities
        WHERE issuer = ${claims.issuer} AND subject = ${claims.subject}
        FOR UPDATE
      `);
      const identityUserId = (identityRows as unknown as Array<{ user_id: string }>)[0]?.user_id ?? null;

      const accountRows = await tx.execute(sql`
        SELECT u.id, u.email_verified_at IS NOT NULL AS verified,
               EXISTS (SELECT 1 FROM claimnet.user_identities i
                       WHERE i.user_id = u.id AND i.provider = 'google'
                         AND NOT (i.issuer = ${claims.issuer} AND i.subject = ${claims.subject})) AS other
        FROM claimnet.users u WHERE u.email = ${email}
        FOR UPDATE OF u
      `);
      const account = (accountRows as unknown as Array<{ id: string; verified: boolean; other: boolean }>)[0];

      const decision = resolveGoogleSignIn({
        identityUserId,
        emailAccount: account ? { userId: account.id, verified: account.verified, holdsOtherGoogleIdentity: account.other } : null,
        authoritative,
      });

      let resolved: ResolvedAccount;
      switch (decision.kind) {
        case "refuse":
          throw new Rollback(decision.error);
        case "sign_in": {
          await tx.execute(sql`
            UPDATE claimnet.user_identities
            SET email = ${email}, email_verified = ${claims.emailVerified}, hosted_domain = ${claims.hostedDomain},
                last_sign_in_at = now()
            WHERE issuer = ${claims.issuer} AND subject = ${claims.subject}
          `);
          resolved = { userId: decision.userId, created: false, waitlisted: false, verificationToken: null, email };
          break;
        }
        case "link": {
          if (decision.takeover) {
            // A pre-registration: whoever registered the address never proved
            // it, so every credential they hold goes (SSO-A3, SSO-A3b).
            await tx.execute(sql`
              DELETE FROM claimnet.user_identities WHERE user_id = ${decision.userId}::uuid AND provider = 'google'
            `);
            await tx.execute(sql`
              UPDATE claimnet.users
              SET password_hash = NULL,
                  email_verified_at = now(),
                  email_verification_token = NULL,
                  email_verification_token_created_at = NULL,
                  password_reset_token_hash = NULL,
                  password_reset_token_created_at = NULL,
                  updated_at = now()
              WHERE id = ${decision.userId}::uuid
            `);
            await invalidateSessions(tx as unknown as PostgresJsDatabase, decision.userId);
          }
          await insertIdentity(tx, decision.userId, claims, email, "email_match");
          resolved = { userId: decision.userId, created: false, waitlisted: false, verificationToken: null, email };
          break;
        }
        case "create": {
          resolved = await createGoogleAccount(tx, claims, email, decision.verified);
          break;
        }
      }

      const joined = await joinHook(tx, { userId: resolved.userId, email, hd: claims.hostedDomain, created: resolved.created });
      if (joined === "full" && resolved.created) throw new Rollback("organization_full");
      return resolved;
    });
  } catch (err) {
    if (err instanceof Rollback) return err.outcome;
    // Two sign-ins racing to link or create the same identity: the loser
    // hits a unique index and starts again from the sign-in page.
    console.error("[google-sign-in] account resolution failed:", err);
    return "failed";
  }
}

/**
 * The mailbox is being proved for an account a non-authoritative Google
 * sign-up created (SSO-A4b, F137). Only that sign-up can hold an identity on
 * an unverified account, and nothing yet ties that Google account to the
 * mailbox. It stays only if the click comes from its own session; otherwise
 * the mailbox's owner may not be who signed up, so the identity and its
 * sessions go, leaving the owner free to sign in with Google or set a
 * password.
 *
 * Removing takes `confirmed`: the page asks first, so a mail scanner running
 * the page's script takes nothing away, and someone who signed up on another
 * device can open the link there instead (F146). A sign-up proof, a correct
 * password or a password reset also confirm, since none of them is a scanner,
 * and none is that session either.
 *
 * Run inside the verification's transaction, before it sets
 * `email_verified_at`: a repeat click finds a verified account and removes
 * nothing. On `confirm`, the caller verifies nothing yet.
 */
export async function settleGoogleIdentityOnVerify(tx: Tx, userId: string, session: JwtPayload | null, confirmed: boolean): Promise<"proceed" | "confirm" | "removed"> {
  const rows = await tx.execute(sql`
    SELECT u.id FROM claimnet.users u
    WHERE u.id = ${userId}::uuid
      AND u.email_verified_at IS NULL
      AND EXISTS (SELECT 1 FROM claimnet.user_identities i WHERE i.user_id = u.id AND i.provider = 'google')
    FOR UPDATE OF u
  `);
  if ((rows as unknown as unknown[]).length === 0) return "proceed";

  const db = tx as unknown as PostgresJsDatabase;
  if (session?.sub === userId && session.idp === "google-consumer") {
    const { refusal } = await sessionState(db, userId, session.iat, session.idp);
    if (!refusal) return "proceed";
  }
  if (!confirmed) return "confirm";
  await tx.execute(sql`DELETE FROM claimnet.user_identities WHERE user_id = ${userId}::uuid AND provider = 'google'`);
  await invalidateSessions(db, userId);
  return "removed";
}

async function insertIdentity(tx: SqlExecutor, userId: string, claims: GoogleIdClaims, email: string, linkedVia: "signup" | "email_match"): Promise<void> {
  await tx.execute(sql`
    INSERT INTO claimnet.user_identities
      (user_id, provider, issuer, subject, email, email_verified, hosted_domain, linked_via)
    VALUES (${userId}::uuid, 'google', ${claims.issuer}, ${claims.subject}, ${email}, ${claims.emailVerified}, ${claims.hostedDomain}, ${linkedVia})
  `);
}

/**
 * A Google sign-up: the same cap, waitlist and invitation rules as
 * registration (SSO-A6, recipe 16899267). An invitation for the address
 * counts only when Google is authoritative for it, since that is what proves
 * the mailbox here; a non-authoritative sign-up proves nothing yet and gets
 * our verification email (SSO-A4).
 */
export async function createGoogleAccount(tx: Tx, claims: GoogleIdClaims, email: string, verified: boolean): Promise<ResolvedAccount> {
  let invitation: { id: string; groupId: string | null; bypassCap: boolean } | null = null;
  if (verified) {
    const rows = await tx.execute(sql`
      SELECT id, group_id AS "groupId", bypass_cap AS "bypassCap" FROM claimnet.invitations
      WHERE email = ${email} AND accepted_at IS NULL AND declined_at IS NULL AND expires_at > now()
      ORDER BY bypass_cap DESC, created_at ASC
      LIMIT 1
    `);
    invitation = (rows as unknown as Array<{ id: string; groupId: string | null; bypassCap: boolean }>)[0] ?? null;
  }
  const waitlisted = !(await mayRegister(tx as unknown as PostgresJsDatabase, invitation));

  const user = await createAccount(tx as unknown as PostgresJsDatabase, { email, passwordHash: null, waitlisted });
  const verificationToken = verified ? null : crypto.randomBytes(32).toString("hex");
  await tx.execute(sql`
    UPDATE claimnet.users
    SET tos_accepted_at = now(),
        email_verified_at = ${verified ? sql`now()` : sql`NULL`},
        email_verification_token = ${verificationToken},
        email_verification_token_created_at = ${verificationToken ? sql`now()` : sql`NULL`}
    WHERE id = ${user.id}::uuid
  `);
  // A groupless invitation (the admin's cap bypass) has done its job.
  if (invitation && !invitation.groupId) {
    await tx.execute(sql`UPDATE claimnet.invitations SET accepted_at = now() WHERE id = ${invitation.id}::uuid`);
  }
  await insertIdentity(tx, user.id, claims, email, "signup");
  return { userId: user.id, created: true, waitlisted, verificationToken, email };
}

export type CallbackOutcome = { ok: true; handoff: string } | { ok: false; error: GoogleSignInError };

/**
 * Google's redirect back (SSO-G3 to SSO-G5, SSO-A7, SSO-R4). Every failure is
 * one code from the closed list; nothing from the request is echoed.
 */
export async function completeGoogleSignIn(
  db: PostgresJsDatabase,
  config: GoogleOidcConfig,
  keys: KeySource,
  input: { state: string | undefined; code: string | undefined; googleError: string | undefined },
  fetchImpl?: FetchLike,
): Promise<CallbackOutcome> {
  if (!input.state) return { ok: false, error: "expired" };
  // Consume first: a replayed or unknown state never reaches Google (SSO-G3b).
  const consumed = await db.execute(sql`
    UPDATE claimnet.sso_login_requests SET consumed_at = now()
    WHERE state_hash = ${hashToken(input.state)} AND consumed_at IS NULL AND expires_at > now()
    RETURNING id, nonce, code_verifier
  `);
  const request = (consumed as unknown as Array<{ id: string; nonce: string; code_verifier: string }>)[0];
  if (!request) return { ok: false, error: "expired" };
  if (input.googleError) return { ok: false, error: input.googleError === "access_denied" ? "cancelled" : "failed" };
  if (!input.code) return { ok: false, error: "failed" };

  let claims: GoogleIdClaims;
  try {
    const idToken = await exchangeGoogleCode(config, { code: input.code, codeVerifier: request.code_verifier }, fetchImpl);
    claims = await verifyGoogleIdToken(config, idToken, request.nonce, keys);
  } catch (err) {
    console.error("[google-sign-in] Google leg failed:", err instanceof GoogleOidcError ? err.message : err);
    return { ok: false, error: "failed" };
  }

  const resolved = await resolveAccount(db, claims);
  if (typeof resolved === "string") return { ok: false, error: resolved };

  if (resolved.verificationToken) {
    void sendVerificationEmail(resolved.email, resolved.verificationToken, { waitlisted: resolved.waitlisted }).catch((err) => {
      console.error("[google-sign-in] Failed to send verification email:", err);
    });
  }
  if (resolved.created) void logSignupCapState(db, { waitlisted: resolved.waitlisted });

  const idp = googleSessionIdp(claims.hostedDomain);
  const refusal = await sessionRefusal(db, resolved.userId, idp);
  if (refusal) return { ok: false, error: refusal };

  const handoff = await issueHandoff(db, { requestId: request.id, userId: resolved.userId, claims, idp });
  if (!handoff) return { ok: false, error: "failed" };
  return { ok: true, handoff };
}

/**
 * Issue the handoff code, if this Google identity still holds the account
 * (F143): it may have been removed or taken over since the sign-in resolved.
 * The share lock orders this against `invalidateSessions`, which cancels codes
 * under the row's update lock: either the identity is already gone here, or this code is
 * committed for that cancellation to find. The identity is read in a later
 * statement than the lock, so it sees whatever the lock waited for.
 */
export async function issueHandoff(
  db: PostgresJsDatabase,
  input: { requestId: string; userId: string; claims: GoogleIdClaims; idp: GoogleSessionIdp },
): Promise<string | null> {
  const handoff = randomToken();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM claimnet.users WHERE id = ${input.userId}::uuid FOR SHARE`);
    const identity = await tx.execute(sql`
      SELECT 1 FROM claimnet.user_identities
      WHERE user_id = ${input.userId}::uuid AND issuer = ${input.claims.issuer} AND subject = ${input.claims.subject}
    `);
    if ((identity as unknown as unknown[]).length === 0) return null;
    await tx.execute(sql`
      UPDATE claimnet.sso_login_requests
      SET user_id = ${input.userId}::uuid,
          session_idp = ${input.idp},
          handoff_hash = ${hashToken(handoff)},
          handoff_expires_at = now() + make_interval(secs => ${HANDOFF_TTL_SECONDS})
      WHERE id = ${input.requestId}::uuid
    `);
    return handoff;
  });
}

/** May this account get a session from this Google sign-in? (SSO-A7, SSO-R4) */
async function sessionRefusal(db: SqlExecutor, userId: string, idp: GoogleSessionIdp): Promise<GoogleSignInError | null> {
  const rows = await db.execute(sql`SELECT waitlisted_at IS NOT NULL AS waitlisted FROM claimnet.users WHERE id = ${userId}::uuid`);
  if ((rows as unknown as Array<{ waitlisted: boolean }>)[0]?.waitlisted) return "waitlisted";
  const disabled = await accountRefusal(db as PostgresJsDatabase, userId);
  if (disabled === "suspended") return "account_suspended";
  if (disabled === "org_disabled") return "account_disabled";
  if (idp !== "google" && (await ssoRequiredFor(db, userId))) return "sso_required_workspace";
  return null;
}

// ── 3. Exchange ──────────────────────────────────────────────────────────────

export type HandoffResult =
  | { ok: true; userId: string; idp: GoogleSessionIdp; target: ReturnTarget; issuedAt: number }
  | { ok: false; error: GoogleSignInError | "invalid_handoff" };

/**
 * Trade a handoff code and the tab's secret for the signed-in account
 * (SSO-G5). One statement: the code, its expiry, its single use and the
 * secret's hash are all in the WHERE, so a wrong secret consumes nothing and
 * every kind of refusal is the same `invalid_handoff`.
 *
 * `issuedAt` is what the session is to be dated. Taken before the statement,
 * which also reads the account's session cut-off: a new owner whose takeover
 * set one a moment ago gets a session dated at it, or it would be refused, while
 * a code that wins the race against a later cut-off doesn't see it and is dated
 * before it (F145, F147).
 */
export async function exchangeHandoff(db: PostgresJsDatabase, input: { handoff: string; secret: string }): Promise<HandoffResult> {
  const startedAt = Math.floor(Date.now() / 1000);
  const rows = await db.execute(sql`
    UPDATE claimnet.sso_login_requests SET handoff_consumed_at = now()
    WHERE handoff_hash = ${hashToken(input.handoff)}
      AND binding_hash = ${hashToken(input.secret)}
      AND handoff_consumed_at IS NULL
      AND handoff_expires_at > now()
      AND user_id IS NOT NULL
    RETURNING user_id, session_idp, return_kind, return_params,
      (SELECT floor(extract(epoch FROM u.sessions_valid_after))::bigint FROM claimnet.users u WHERE u.id = user_id) AS not_before
  `);
  const row = (rows as unknown as Array<{ user_id: string; session_idp: string; return_kind: string; return_params: unknown; not_before: string | number | null }>)[0];
  if (!row) return { ok: false, error: "invalid_handoff" };
  // The account could have been switched off in the seconds since the callback.
  const idp: GoogleSessionIdp = row.session_idp === "google" ? "google" : "google-consumer";
  const refusal = await sessionRefusal(db, row.user_id, idp);
  if (refusal) return { ok: false, error: refusal };
  const params = (row.return_params ?? {}) as Record<string, unknown>;
  const target: ReturnTarget =
    row.return_kind === "oauth_authorize"
      ? { kind: "oauth_authorize", params: params as unknown as AuthorizeParams }
      : { kind: "app", path: typeof params["path"] === "string" ? params["path"] : "/app/dashboard" };
  return { ok: true, userId: row.user_id, idp, target, issuedAt: Math.max(startedAt, Number(row.not_before ?? 0)) };
}

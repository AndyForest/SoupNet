/**
 * Connecting a company's Google Workspace directory, and the server's half of
 * the lazy check (organization accounts round 1, stream Offboarding; rubric
 * docs/planning/org-accounts-build/offboarding.md, OB-K1 to OB-K6, OB-C8).
 *
 * Two ways in (recipe 1a22971a):
 *   - admin consent: an org owner or admin who signs in with Google starts a
 *     second kind of pending request on stream SSO's round trip (the read-only
 *     directory scope, offline access, consent forced, the domain as a hint);
 *     the shared callback hands it here before any account resolution;
 *   - a service account: the customer's JSON key and the admin it acts as.
 * Either way the credential is tested against the directory before it is
 * stored, sealed, by the authz module.
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { domainToUnicode } from "node:url";
import {
  DIRECTORY_SCOPE,
  DIRECTORY_WARNING_HOURS,
  directoryWarningEmail,
  normalizeDomain,
  parseServiceAccountKey,
} from "@soupnet/domain";
import type { GoogleSignInError } from "@soupnet/domain";
import {
  installDirectoryChecker,
  saveDirectoryConnection,
  directoryManagersOf,
  domainClaimCurrentFor,
} from "../authz";
import { secretBoxKey } from "../lib/secret-box";
import { checkDirectoryMember, testDirectoryCredential } from "./google-directory.service";
import { sendOrganizationDirectoryEmail } from "./email.service";
import { writeAudit } from "./audit-log.service";
import {
  buildGoogleAuthorizationUrl,
  exchangeGoogleCodeForTokens,
  verifyGoogleIdToken,
  pkceChallenge,
  randomToken,
  googleOidcConfig,
  GoogleOidcError,
} from "./google-oidc.service";
import type { GoogleOidcConfig, KeySource, FetchLike } from "./google-oidc.service";

type SqlExecutor = Pick<PostgresJsDatabase, "execute">;

/**
 * At startup: install the directory check when both the key and Google are
 * configured. A set but malformed DIRECTORY_CREDENTIALS_KEY throws, stopping
 * startup rather than every connection later.
 */
export function installDirectoryChecking(): "on" | "off" {
  const key = secretBoxKey();
  const config = googleOidcConfig();
  if (!key || !config) return "off";
  installDirectoryChecker(
    key,
    (input) => checkDirectoryMember(config, { organizationId: input.organizationId, kind: input.kind, adminEmail: input.adminEmail, secret: input.secret }, input.member),
    (organizationId) => warnOrganization(organizationId),
  );
  return "on";
}

/** Whether connecting is possible on this deployment (OB-K5). */
export function directoryConnectAvailable(): boolean {
  return secretBoxKey() !== null && googleOidcConfig() !== null;
}

async function warnOrganization(organizationId: string): Promise<void> {
  const { getDb } = await import("../db");
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT COALESCE(last_success_at, connected_at) AS since FROM claimnet.organization_directory_connections
    WHERE organization_id = ${organizationId}::uuid
  `)) as unknown as Array<{ since: string }>;
  if (!rows[0]) return;
  const managers = await directoryManagersOf(db, organizationId);
  const mail = directoryWarningEmail(managers.name || "your organization", new Date(rows[0].since));
  for (const email of managers.emails) {
    await sendOrganizationDirectoryEmail(email, mail).catch(() => undefined);
  }
  console.warn(`[directory] org ${organizationId}: warned ${managers.emails.length} managers after ${DIRECTORY_WARNING_HOURS}h`);
}

/** A domain this organization's claim is current for, normalized; else null. */
async function claimedDomain(db: SqlExecutor, organizationId: string, raw: unknown): Promise<string | null> {
  const normalized = normalizeDomain(raw);
  if (!normalized.ok) return null;
  const rows = (await db.execute(sql`SELECT ${domainClaimCurrentFor(organizationId, normalized.domain)} AS current`)) as unknown as Array<{ current: boolean }>;
  return rows[0]?.current ? normalized.domain : null;
}

export type ConnectRefusal =
  | { status: 400; error: "invalid_domain"; message: string }
  | { status: 400; error: "google_identity_required"; message: string }
  | { status: 400; error: "invalid_key"; message: string }
  | { status: 422; error: "directory_refused"; message: string };

const DOMAIN_REFUSAL: ConnectRefusal = {
  status: 400,
  error: "invalid_domain",
  message: "Choose a domain your organization has verified in Soup.net.",
};

/** Start the admin-consent round trip (OB-K1). */
export async function startDirectoryConnect(
  db: PostgresJsDatabase,
  input: { organizationId: string; userId: string; domain: unknown; binding: string },
): Promise<{ url: string } | ConnectRefusal> {
  const config = googleOidcConfig();
  if (!config) throw new Error("Google sign-in is not configured");
  const domain = await claimedDomain(db, input.organizationId, input.domain);
  if (!domain) return DOMAIN_REFUSAL;
  const identity = (await db.execute(sql`
    SELECT 1 FROM claimnet.user_identities WHERE user_id = ${input.userId}::uuid AND provider = 'google'
  `)) as unknown as unknown[];
  if (identity.length === 0) {
    return { status: 400, error: "google_identity_required", message: "Sign in with Google once before connecting the directory." };
  }
  const state = randomToken();
  const nonce = randomToken();
  const codeVerifier = randomToken();
  await db.execute(sql`
    INSERT INTO claimnet.sso_login_requests
      (state_hash, nonce, code_verifier, binding_hash, return_kind, return_params, expires_at)
    VALUES (${pkceChallenge(state)}, ${nonce}, ${codeVerifier}, ${input.binding}, 'directory_connect',
      ${JSON.stringify({ organizationId: input.organizationId, domain, userId: input.userId })}::jsonb,
      now() + interval '10 minutes')
  `);
  return {
    url: buildGoogleAuthorizationUrl(config, { state, nonce, codeChallenge: pkceChallenge(codeVerifier) }, { scope: DIRECTORY_SCOPE, hostedDomain: domain }),
  };
}

/**
 * The callback's second branch (OB-K2), reached before any account
 * resolution: no session is issued and no identity linked here. Completes
 * the connection only for the Google account linked to the person who
 * started, on the requested domain, with a refresh token that reads the
 * directory.
 */
export async function completeDirectoryConnect(
  db: PostgresJsDatabase,
  config: GoogleOidcConfig,
  keys: KeySource,
  request: { nonce: string; codeVerifier: string; params: { organizationId?: unknown; domain?: unknown; userId?: unknown } },
  code: string,
  fetchImpl?: FetchLike,
): Promise<{ ok: true } | { ok: false; error: GoogleSignInError }> {
  const organizationId = typeof request.params.organizationId === "string" ? request.params.organizationId : "";
  const domain = typeof request.params.domain === "string" ? request.params.domain : "";
  const userId = typeof request.params.userId === "string" ? request.params.userId : "";
  const key = secretBoxKey();
  if (!organizationId || !domain || !userId || !key) return { ok: false, error: "failed" };

  let tokens: { idToken: string; refreshToken: string | null };
  let claims: Awaited<ReturnType<typeof verifyGoogleIdToken>>;
  try {
    tokens = await exchangeGoogleCodeForTokens(config, { code, codeVerifier: request.codeVerifier }, fetchImpl);
    claims = await verifyGoogleIdToken(config, tokens.idToken, request.nonce, keys);
  } catch (err) {
    console.error("[directory] connect: Google leg failed:", err instanceof GoogleOidcError ? err.message : "error");
    return { ok: false, error: "failed" };
  }

  const linked = (await db.execute(sql`
    SELECT 1 FROM claimnet.user_identities
    WHERE user_id = ${userId}::uuid AND provider = 'google' AND issuer = ${claims.issuer} AND subject = ${claims.subject}
  `)) as unknown as unknown[];
  const fail = async (error: GoogleSignInError) => {
    await writeAudit(db, { actorUserId: userId, action: "organization.directory_connect_failed", targetType: "organization", targetId: organizationId, metadata: { kind: "admin_consent", domain, reason: error } });
    return { ok: false as const, error };
  };
  if (linked.length === 0) return fail("directory_wrong_account");
  if (claims.hostedDomain !== domain) return fail("directory_wrong_domain");
  if (!tokens.refreshToken) return fail("directory_no_refresh_token");
  // The claim may have lapsed during the round trip.
  if (!(await claimedDomain(db, organizationId, domain))) return fail("directory_wrong_domain");

  const credential = { organizationId, kind: "admin_consent" as const, adminEmail: claims.email.toLowerCase(), secret: tokens.refreshToken };
  if (await testDirectoryCredential(config, credential, fetchImpl)) return fail("directory_not_admin");

  await saveDirectoryConnection(db, key, {
    organizationId,
    kind: "admin_consent",
    domain,
    domainUnicode: domainToUnicode(domain) || domain,
    adminEmail: credential.adminEmail,
    serviceAccountEmail: null,
    secret: tokens.refreshToken,
    connectedBy: userId,
  });
  await writeAudit(db, { actorUserId: userId, action: "organization.directory_connected", targetType: "organization", targetId: organizationId, metadata: { kind: "admin_consent", domain } });
  return { ok: true };
}

/** Connect with the customer's own service account (OB-K3). */
export async function connectServiceAccount(
  db: PostgresJsDatabase,
  input: { organizationId: string; userId: string; key: unknown; adminEmail: unknown },
  fetchImpl?: FetchLike,
): Promise<ConnectRefusal | null> {
  const config = googleOidcConfig();
  const boxKey = secretBoxKey();
  if (!config || !boxKey) throw new Error("directory connections are not configured");
  const parsed = parseServiceAccountKey(input.key);
  if (!parsed.ok) return { status: 400, error: "invalid_key", message: parsed.message };
  const adminEmail = typeof input.adminEmail === "string" ? input.adminEmail.trim().toLowerCase() : "";
  const at = adminEmail.lastIndexOf("@");
  const domain = at > 0 ? await claimedDomain(db, input.organizationId, adminEmail.slice(at + 1)) : null;
  if (!domain) return { ...DOMAIN_REFUSAL, message: "The admin address must be on a domain your organization has verified in Soup.net." };

  const secret = JSON.stringify({ type: "service_account", client_email: parsed.key.clientEmail, private_key: parsed.key.privateKey });
  const credential = { organizationId: input.organizationId, kind: "service_account" as const, adminEmail, secret };
  const refused = await testDirectoryCredential(config, credential, fetchImpl);
  if (refused) {
    await writeAudit(db, { actorUserId: input.userId, action: "organization.directory_connect_failed", targetType: "organization", targetId: input.organizationId, metadata: { kind: "service_account", domain, reason: refused.kind === "connection_error" ? refused.code : refused.kind } });
    return {
      status: 422,
      error: "directory_refused",
      message: "Google wouldn't let this service account read the directory as that admin. Check its domain-wide delegation for the read-only directory scope.",
    };
  }
  await saveDirectoryConnection(db, boxKey, {
    organizationId: input.organizationId,
    kind: "service_account",
    domain,
    domainUnicode: domainToUnicode(domain) || domain,
    adminEmail,
    serviceAccountEmail: parsed.key.clientEmail,
    secret,
    connectedBy: input.userId,
  });
  await writeAudit(db, { actorUserId: input.userId, action: "organization.directory_connected", targetType: "organization", targetId: input.organizationId, metadata: { kind: "service_account", domain } });
  return null;
}

/**
 * Sign in with Google: the pure rules (organization accounts round 1, stream
 * SSO; rubric docs/planning/org-accounts-build/sso.md, SSO-M3).
 *
 * The backend verifies the ID token and looks the account up; these
 * functions decide what the facts mean:
 *   - when Google can vouch for an email address (the authoritative test);
 *   - which account a sign-in belongs to, and whether it links, takes over a
 *     pre-registration, creates an account, or is refused (recipe 3a943b1c,
 *     superseding 5219c09d);
 *   - the closed list of outcomes the callback may name to the SPA, with the
 *     copy a person reads.
 */

/** What the verified ID token says about the address. */
export interface GoogleAddressClaims {
  email: string;
  emailVerified: boolean;
  /** The `hd` claim: the Workspace domain, or null for a consumer account. */
  hostedDomain: string | null;
}

/**
 * Is Google authoritative for this address? Google's own two cases: an
 * `@gmail.com` address, or `email_verified` with `hd` set. For any other
 * address Google "is not authoritative" (its ID-token verification guide),
 * since the third-party mailbox may have changed hands since Google checked it.
 */
export function googleIsAuthoritative(claims: GoogleAddressClaims): boolean {
  if (claims.email.toLowerCase().endsWith("@gmail.com")) return true;
  return claims.emailVerified && !!claims.hostedDomain;
}

/**
 * The `idp` a Google-issued session carries: `google` for a Workspace identity
 * (hd set), `google-consumer` otherwise. Only `google` satisfies an
 * organization's require_sso (rubric SSO-A8, SSO-R4); a password session
 * carries no idp.
 */
export type GoogleSessionIdp = "google" | "google-consumer";

export function googleSessionIdp(hostedDomain: string | null): GoogleSessionIdp {
  return hostedDomain ? "google" : "google-consumer";
}

/** The facts the backend looked up, for one verified sign-in. */
export interface GoogleResolutionInput {
  /** The account an identity with this issuer and sub is linked to, if any. */
  identityUserId: string | null;
  /** The account holding the token's email address, if any. */
  emailAccount: {
    userId: string;
    verified: boolean;
    /** It already holds a Google identity with a different sub. */
    holdsOtherGoogleIdentity: boolean;
  } | null;
  authoritative: boolean;
}

export type GoogleResolution =
  /** A linked identity: sign in to its account. */
  | { kind: "sign_in"; userId: string }
  /**
   * Link this identity to the email's account. `takeover` means the account
   * was never verified, so it is a pre-registration: its password and any
   * other Google identity are discarded, its tokens cleared, it is marked
   * verified, and its sessions are cut.
   */
  | { kind: "link"; userId: string; takeover: boolean }
  /** No account holds the address: create one, verified only when authoritative. */
  | { kind: "create"; verified: boolean }
  | { kind: "refuse"; error: GoogleSignInError };

/**
 * Which account a Google sign-in belongs to. In order:
 *   1. an identity linked by issuer and sub wins;
 *   2. no account holds the email: create one;
 *   3. Google isn't authoritative: link nothing;
 *   4. a verified account holding another Google sub is refused, never
 *      relinked by email (the lapsed-domain case);
 *   5. otherwise link, taking over an unverified account.
 */
export function resolveGoogleSignIn(input: GoogleResolutionInput): GoogleResolution {
  if (input.identityUserId) return { kind: "sign_in", userId: input.identityUserId };
  const account = input.emailAccount;
  if (!account) return { kind: "create", verified: input.authoritative };
  if (!input.authoritative) return { kind: "refuse", error: "not_authoritative" };
  if (account.verified && account.holdsOtherGoogleIdentity) return { kind: "refuse", error: "different_google_account" };
  return { kind: "link", userId: account.userId, takeover: !account.verified };
}

/**
 * Every outcome the Google callback may name in the SPA's fragment. Nothing
 * outside this list is ever put in a redirect (rubric SSO-G4).
 */
export const GOOGLE_SIGN_IN_ERRORS = [
  "expired",
  "cancelled",
  "not_authoritative",
  "different_google_account",
  "sso_required_workspace",
  "waitlisted",
  "organization_full",
  "account_disabled",
  "account_suspended",
  "reauthenticate",
  "failed",
] as const;

export type GoogleSignInError = (typeof GOOGLE_SIGN_IN_ERRORS)[number];

export function isGoogleSignInError(value: unknown): value is GoogleSignInError {
  return typeof value === "string" && (GOOGLE_SIGN_IN_ERRORS as readonly string[]).includes(value);
}

const MESSAGES: Record<GoogleSignInError, string> = {
  expired: "That sign-in link has expired or was already used. Start again from the sign-in page.",
  cancelled: "Google sign-in was cancelled. You can try again, or sign in with a password.",
  not_authoritative: "Google can't confirm this address for us. Sign in with your password.",
  different_google_account: "This Soup.net account is linked to a different Google account. Sign in with that one.",
  sso_required_workspace: "Your organization signs in with its Google Workspace account. Sign in with that one.",
  waitlisted: "You're on the waitlist and your place is held. We'll email you the moment a spot opens.",
  organization_full: "This organization has no free seats. Ask one of its admins.",
  account_disabled: "Your organization has disabled this account. Ask one of its admins to turn it back on.",
  account_suspended: "This account is suspended. Contact Soup.net support.",
  reauthenticate: "Sign in with Google again to confirm.",
  failed: "Google sign-in didn't work this time. Try again in a moment.",
};

export function googleSignInErrorMessage(code: GoogleSignInError): string {
  return MESSAGES[code] ?? MESSAGES.failed;
}

const RETURN_BASE = "https://soup.invalid";

/**
 * Where a sign-in may return to: the server's copy of the SPA's audited rule
 * (`apps/frontend/src/lib/return-target.ts`, drafts slice 3, S3-L5), so a
 * stored return path is checked on both sides. Same-origin paths under
 * `/app/`, plus exactly `/oauth/authorize` with its query, so a signed-out
 * person returns to the consent page (recipe 607dc974). Null for anything
 * else.
 */
export function safeAppReturnPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f\s]/.test(raw)) return null;
  const pathPart = raw.split(/[?#]/, 1)[0] ?? "";
  if (/%(2f|5c|2e|25)/i.test(pathPart)) return null;
  let url: URL;
  try {
    url = new URL(raw, RETURN_BASE);
  } catch {
    return null;
  }
  if (url.origin !== RETURN_BASE) return null;
  // The normalized path must be the one written: "/oauth/authorize/../x"
  // normalizes to "/oauth/x", which the prefix test below would refuse anyway.
  if (url.pathname !== pathPart) return null;
  if (!url.pathname.startsWith("/app/") && url.pathname !== "/oauth/authorize") return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Sign in with Google, the SPA's half (organization accounts round 1, stream
 * SSO; rubric docs/planning/org-accounts-build/sso.md, SSO-U1 to SSO-U3).
 *
 * The tab that starts the flow keeps a random secret in sessionStorage and
 * sends only its SHA-256 to the backend. Google redirects to the backend,
 * which redirects to /auth/google/complete with a single-use handoff code in
 * the fragment; that page exchanges the code together with the secret. A
 * handoff URL for someone else's sign-in is useless in a tab that doesn't
 * hold its secret (recipe 49937af3), and the fragment never reaches a server
 * or a Referer.
 */

import { API_BASE } from "../auth.js";
import { safeReturnTarget } from "./return-target.js";

const SECRET_KEY = "soupnet:google-sign-in-secret";

/** The consent page's parameters the backend stores and hands back. */
const AUTHORIZE_PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "state",
  "code_challenge",
  "code_challenge_method",
  "scope",
  "resource",
] as const;

export type GoogleReturnTarget =
  | { kind: "app"; path: string }
  | { kind: "oauth_authorize"; params: Record<string, string> };

function base64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 32 random bytes, base64url: the tab's secret. */
export function newTabSecret(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** SHA-256 of a string, base64url, as the backend stores the binding. */
export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

/**
 * Where a sign-in started from `next` returns to: the consent page with its
 * parameters, an in-app path, or (null) the dashboard. Uses the same audited
 * rule as password sign-in.
 */
export function returnTargetFor(next: string | null | undefined): GoogleReturnTarget | null {
  const safe = safeReturnTarget(next);
  if (!safe) return null;
  const url = new URL(safe, "https://spa.invalid");
  if (url.pathname === "/oauth/authorize") return authorizeTargetFrom(url.search);
  return { kind: "app", path: safe };
}

/** The consent page's own query, as a return target. */
export function authorizeTargetFrom(search: string): GoogleReturnTarget {
  const query = new URLSearchParams(search);
  const params: Record<string, string> = {};
  for (const name of AUTHORIZE_PARAMS) params[name] = query.get(name) ?? "";
  return { kind: "oauth_authorize", params };
}

/** What /auth/google/complete found in its fragment. */
export type CompleteFragment = { handoff: string } | { error: string } | null;

export function readCompleteFragment(hash: string): CompleteFragment {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const handoff = params.get("handoff");
  if (handoff && /^[A-Za-z0-9_-]{43}$/.test(handoff)) return { handoff };
  const error = params.get("error");
  if (error && /^[a-z_]{1,40}$/.test(error)) return { error };
  return null;
}

export function storeTabSecret(secret: string): void {
  sessionStorage.setItem(SECRET_KEY, secret);
}

/** Read and forget the tab's secret (it is single-use). */
export function takeTabSecret(): string | null {
  const secret = sessionStorage.getItem(SECRET_KEY);
  sessionStorage.removeItem(SECRET_KEY);
  return secret;
}

/** Start the flow; resolves to Google's URL, or throws with the server's message. */
export async function startGoogleSignIn(target: GoogleReturnTarget | null): Promise<string> {
  const secret = newTabSecret();
  storeTabSecret(secret);
  const res = await fetch(`${API_BASE}/auth/google/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ binding: await sha256Base64Url(secret), ...(target ? { return: target } : {}) }),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: { url?: string }; message?: string } | null;
  if (!res.ok || !body?.data?.url) throw new Error(body?.message ?? "Google sign-in isn't available right now.");
  return body.data.url;
}

/** The copy for each outcome the callback can name (mirrors @soupnet/domain). */
const MESSAGES: Record<string, string> = {
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

export function googleSignInMessage(code: string): string {
  return MESSAGES[code] ?? MESSAGES["failed"]!;
}

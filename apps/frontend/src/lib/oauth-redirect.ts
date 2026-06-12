/**
 * F44 (security-audit-2026-06-11): the consent screen must never navigate the
 * browser to a redirect_uri that is not exactly registered for the client.
 * The Authorize path is validated server-side at /oauth/authorize/grant; this
 * covers the client-side Cancel path (and lets the page refuse up front).
 *
 * Exact string match, deliberately: no origin-only comparison, no prefix
 * match, no trailing-slash forgiveness — same contract as the server's
 * redirect_uri check (RFC 6749 §3.1.2.3 simple string comparison).
 */
export function isRegisteredRedirectUri(redirectUri: string, registered: string[]): boolean {
  if (!redirectUri) return false;
  return registered.includes(redirectUri);
}

/**
 * One-line notices the sign-in page shows depending on how it was reached.
 * Account deletion navigates to `/auth/login?account=deleted`; the notice is
 * fixed text, so the flag carries nothing about any account.
 */
export const ACCOUNT_DELETED_SEARCH = "account=deleted";

/**
 * Why the person was signed out, by the server's code (stream SSO, SSO-U4).
 * The sentences are the backend's word for word (@soupnet/domain; the
 * backend's suite checks them). An unknown code shows nothing.
 */
const SIGNED_OUT_NOTICES: Record<string, string> = {
  session_expired: "This session has ended. Sign in again.",
  account_disabled: "Your organization has disabled this account. Ask one of its admins to turn it back on.",
  account_suspended: "This account is suspended. Contact Soup.net support.",
  sso_required: "Your organization signs in with Google. Sign in with Google to continue.",
};

/** Where to land after the server ended the session: sign-in, with the reason when it is a known one. */
export function loginPathAfterSignOut(reason: string | null): string {
  return reason && Object.hasOwn(SIGNED_OUT_NOTICES, reason) ? `/auth/login?signedOut=${encodeURIComponent(reason)}` : "/auth/login";
}

export function loginNoticeFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.get("account") === "deleted") return "Your account has been deleted.";
  const signedOut = params.get("signedOut");
  if (signedOut && Object.hasOwn(SIGNED_OUT_NOTICES, signedOut)) return SIGNED_OUT_NOTICES[signedOut] ?? null;
  return null;
}

/**
 * The search string with the notice flag removed and every other parameter
 * kept (e.g. an invite token). The page applies it with a replace navigation
 * when the form is submitted, so the notice can't sit beside a sign-in error
 * and a refresh doesn't bring it back.
 */
export function searchWithoutLoginNotice(search: string): string {
  const params = new URLSearchParams(search);
  if (!params.has("account") && !params.has("signedOut")) return search;
  params.delete("account");
  params.delete("signedOut");
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

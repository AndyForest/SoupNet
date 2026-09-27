/**
 * One-line notices the sign-in page shows depending on how it was reached.
 * Account deletion navigates to `/auth/login?account=deleted`; the notice is
 * fixed text, so the flag carries nothing about any account.
 */
export const ACCOUNT_DELETED_SEARCH = "account=deleted";

export function loginNoticeFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.get("account") === "deleted") return "Your account has been deleted.";
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
  if (!params.has("account")) return search;
  params.delete("account");
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

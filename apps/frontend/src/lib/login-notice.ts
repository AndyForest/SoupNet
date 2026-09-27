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

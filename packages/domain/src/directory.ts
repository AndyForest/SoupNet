/**
 * Offboarding through the company's Google Workspace directory: the pure
 * rules (organization accounts round 1, stream Offboarding; rubric
 * docs/planning/org-accounts-build/offboarding.md, OB-M3).
 *
 * The backend asks the Directory API about one member at a time, lazily, at
 * most hourly, at the moment their credential is used (recipe 3650aed9).
 * These functions decide what an answer means, when a check is due or
 * stale, and the copy a switched-off person reads. Who is checked is one SQL
 * fragment, `checkedUnder` in the backend's authz/directory-sql.ts.
 */

/** A member's directory status is checked again after this long. */
export const DIRECTORY_CHECK_INTERVAL_MINUTES = 60;
/** With no successful check for this long, a checked member is switched off. */
export const DIRECTORY_STALE_HOURS = 24;
/** How long the Directory API gets per check. */
export const DIRECTORY_TIMEOUT_MS = 2_000;
/** A claim on a check older than this may be taken over (the task holding it died). */
export const DIRECTORY_CLAIM_SECONDS = 30;
/** A connection failing this long warns the organization's owners and admins once. */
export const DIRECTORY_WARNING_HOURS = 6;

export const DIRECTORY_SCOPE = "https://www.googleapis.com/auth/admin.directory.user.readonly";

export type DirectoryStatus = "active" | "suspended" | "archived" | "deleted";

export type DirectoryAnswer =
  /** The directory said something about the member. */
  | { kind: "status"; status: DirectoryStatus }
  /** Google refused our credential: the connection's problem, never the member's. */
  | { kind: "connection_error"; code: string }
  /** Slow, down, or rate-limited: keep the last status. */
  | { kind: "unreachable" };

/**
 * What a `users.get` answer means (OB-C1 to OB-C8). `null` is a request that
 * never got an answer (timeout, network). A 404 is a member the directory
 * doesn't know, which is deleted (recipe 88b1b328).
 */
export function classifyDirectoryAnswer(answer: { httpStatus: number; body: unknown } | null): DirectoryAnswer {
  if (!answer) return { kind: "unreachable" };
  const { httpStatus, body } = answer;
  if (httpStatus === 200) {
    const user = (body && typeof body === "object" ? body : {}) as { suspended?: unknown; archived?: unknown };
    if (user.suspended === true) return { kind: "status", status: "suspended" };
    if (user.archived === true) return { kind: "status", status: "archived" };
    return { kind: "status", status: "active" };
  }
  if (httpStatus === 404) return { kind: "status", status: "deleted" };
  if (httpStatus === 429 || httpStatus >= 500) return { kind: "unreachable" };
  return { kind: "connection_error", code: `http_${httpStatus}` };
}

/** Does a status switch the member off? */
export function directoryStatusRefuses(status: DirectoryStatus | null): boolean {
  return status === "suspended" || status === "archived" || status === "deleted";
}

export type DirectoryDisabledReason = "directory_inactive" | "directory_unconfirmed";

export const DIRECTORY_INACTIVE_MESSAGE =
  "Your organization's Google Workspace doesn't list this account as active. Ask one of your organization's admins.";
export const DIRECTORY_UNCONFIRMED_MESSAGE =
  "Soup.net couldn't confirm this account with your organization's Google Workspace. Ask one of your organization's admins to check the directory connection.";

/** The copy for each directory reason (recipe efa4bbca). */
export function directoryDisabledMessage(reason: DirectoryDisabledReason): string {
  return reason === "directory_inactive" ? DIRECTORY_INACTIVE_MESSAGE : DIRECTORY_UNCONFIRMED_MESSAGE;
}

export type ServiceAccountKey = { clientEmail: string; privateKey: string };

/**
 * Read a Google service-account JSON key (OB-K3). The refusal says what is
 * wrong and never repeats the key.
 */
export function parseServiceAccountKey(raw: unknown): { ok: true; key: ServiceAccountKey } | { ok: false; message: string } {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, message: "The key isn't valid JSON. Paste the whole key file Google gave you." };
    }
  }
  if (!value || typeof value !== "object") return { ok: false, message: "The key must be a Google service-account JSON key." };
  const v = value as Record<string, unknown>;
  if (v["type"] !== "service_account") return { ok: false, message: "The key's type must be service_account." };
  const clientEmail = v["client_email"];
  const privateKey = v["private_key"];
  if (typeof clientEmail !== "string" || !clientEmail.includes("@")) return { ok: false, message: "The key has no client_email." };
  if (typeof privateKey !== "string" || !privateKey.includes("PRIVATE KEY")) return { ok: false, message: "The key has no private_key." };
  return { ok: true, key: { clientEmail, privateKey } };
}

/**
 * The one warning an organization's owners and admins get when a check fails
 * and the connection's last success is over DIRECTORY_WARNING_HOURS old
 * (draft 47f9620f): when the last check succeeded, the stale rule, the hour
 * everyone on the domain is signed out by, and the fix. Names no credential.
 *
 * The copy says only what the timestamps show. A quiet spell also ages the
 * last success, so it doesn't claim hours of failure; and each member goes
 * stale a day after their own last check, so the hour named is the latest
 * anyone keeps access, not the first (verification O1, O2).
 */
export function directoryWarningEmail(organizationName: string, lastSuccessAt: Date): { subject: string; text: string } {
  const utc = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const everyoneBy = new Date(lastSuccessAt.getTime() + DIRECTORY_STALE_HOURS * 3600_000);
  return {
    subject: `Soup.net can't reach ${organizationName}'s Google Workspace directory`,
    text:
      `Soup.net just failed to check one of ${organizationName}'s members against your Google Workspace directory, and its last successful check was at ${utc(lastSuccessAt)}. ` +
      `A member whose status hasn't been confirmed for ${DIRECTORY_STALE_HOURS} hours is signed out of Soup.net, and their agents' keys stop working until a check succeeds. ` +
      `Members who haven't used Soup.net recently may be signed out already, and unless a check succeeds, everyone on your domain will be by ${utc(everyoneBy)}. ` +
      `To fix it, an owner or admin can reconnect the directory from your organization's console in Soup.net (or switch to a service account). ` +
      `If nobody in your organization can sign in any more, contact Soup.net support.`,
  };
}

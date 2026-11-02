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
/** With nothing but no answers from Google for this long, the owners and admins are warned once. Google refusing the credential warns at once. */
export const DIRECTORY_WARNING_HOURS = 6;
/** How long a disconnect or a replacement waits, once the owners and admins have been warned, when the directory can't answer about the person doing it. */
export const DIRECTORY_HOLD_HOURS = 6;

export const DIRECTORY_SCOPE = "https://www.googleapis.com/auth/admin.directory.user.readonly";

export type DirectoryStatus = "active" | "suspended" | "archived" | "deleted";

export type DirectoryAnswer =
  /** The directory said something about the member. */
  | { kind: "status"; status: DirectoryStatus }
  /**
   * Google refused our credential, or what came back can't be trusted: the
   * connection's problem, never the member's. The last status stands and the
   * admins see the code.
   */
  | { kind: "connection_error"; code: string }
  /** Slow, down, or rate-limited: keep the last status. */
  | { kind: "unreachable" };

/** Whom a `users.get` asked about: by the address held here, or by the Google `sub`. */
export type DirectoryLookup = { email: string } | { id: string };

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Is this user record the one asked for? An address may be its primary, or an alias of it. */
function isAbout(user: Record<string, unknown>, asked: DirectoryLookup): boolean {
  if ("id" in asked) return user["id"] === asked.id;
  const wanted = asked.email.toLowerCase();
  const addresses = [
    user["primaryEmail"],
    ...listOf(user["aliases"]),
    ...listOf(user["nonEditableAliases"]),
    ...listOf(user["emails"]).map((e) => (e && typeof e === "object" ? (e as { address?: unknown }).address : null)),
  ];
  return addresses.some((a) => typeof a === "string" && a.toLowerCase() === wanted);
}

/** Is this body Google's own error, with this code? Google's API errors say so in `error.code`. */
export function isGoogleError(body: unknown, code: number): boolean {
  const error = body && typeof body === "object" ? (body as { error?: unknown }).error : null;
  return !!error && typeof error === "object" && (error as { code?: unknown }).code === code;
}

/** Google's own "no such user": its 404 with the reason `notFound`, or the newer `status` form. */
function isGoogleNotFound(body: unknown): boolean {
  if (!isGoogleError(body, 404)) return false;
  const error = (body as { error: { errors?: unknown; status?: unknown } }).error;
  return error.status === "NOT_FOUND" || listOf(error.errors).some((e) => !!e && typeof e === "object" && (e as { reason?: unknown }).reason === "notFound");
}

/**
 * What a `users.get` answer means (OB-C1 to OB-C8). `null` is a request that
 * never got a whole answer (timeout, network, a body that stalled). Google's
 * own not-found is a member the directory doesn't know, which is deleted
 * (recipe 88b1b328); a 404 in any other shape came from something else on the
 * way (a proxy, a gateway) and says nothing about them (F184).
 *
 * A 200 counts only as a complete record of the person asked about: it can
 * lift a refusal, so an empty body, an error object, a string where a flag
 * belongs or someone else's record says nothing about them (recipe 6214370b:
 * only authoritative signals move a status).
 */
export function classifyDirectoryAnswer(answer: { httpStatus: number; body: unknown } | null, asked: DirectoryLookup): DirectoryAnswer {
  if (!answer) return { kind: "unreachable" };
  const { httpStatus, body } = answer;
  if (httpStatus === 200) {
    const user = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
    const complete = typeof user["primaryEmail"] === "string" && typeof user["suspended"] === "boolean" && typeof user["archived"] === "boolean";
    if (!complete || !isAbout(user, asked)) return { kind: "connection_error", code: "bad_answer" };
    if (user["suspended"]) return { kind: "status", status: "suspended" };
    if (user["archived"]) return { kind: "status", status: "archived" };
    return { kind: "status", status: "active" };
  }
  if (httpStatus === 404) return isGoogleNotFound(body) ? { kind: "status", status: "deleted" } : { kind: "connection_error", code: "bad_404" };
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
 * What stops a server starting with the check off while companies are
 * connected (F186), or null when none are. With no check there is no warning
 * either: every member on those domains would just be refused a day after their
 * last check. A failed deploy says so at once, with the old tasks still serving.
 * Names the organizations, so the operator needn't go to SQL to find them.
 */
export function directoryOffProblem(connected: Array<{ id: string; name: string }>): string | null {
  if (connected.length === 0) return null;
  const SHOWN = 10;
  const names = connected.slice(0, SHOWN).map((o) => `${JSON.stringify(o.name)} (${o.id})`).join(", ");
  const more = connected.length > SHOWN ? `, and ${connected.length - SHOWN} more` : "";
  return (
    `The Workspace directory check is off (DIRECTORY_CREDENTIALS_KEY or Google sign-in isn't configured), but ${connected.length === 1 ? "this organization has" : "these organizations have"} a directory connection: ${names}${more}. ` +
    `Started like this, every member on those domains would be refused ${DIRECTORY_STALE_HOURS} hours after their last check, owners included, with no warning. ` +
    `Restore the configuration. To turn the check off for good, first remove each connection (DELETE /admin/organizations/:id/directory) while it is still configured. ` +
    `If the key itself is lost, start with a new 32-byte key: the server runs, the stored credentials can't be read, each organization's owners and admins are warned at their next failed check, and the same DELETE still works, so each company can then reconnect.`
  );
}

/** This many members found removed from the directory within the hour tells the owners and admins, without delaying any of them. */
export const DIRECTORY_DELETION_BURST = 3;

/**
 * Several members were switched off as removed from the directory within the
 * hour. A layoff looks just like this, and so does something answering 404 in
 * Google's shape for everyone but the admin, so they are refused at once and the
 * people who can tell the two apart hear about it (F184).
 */
export function directoryDeletionsEmail(organizationName: string, count: number): { subject: string; text: string } {
  return {
    subject: `${count} ${organizationName} members were just removed by your Google Workspace directory`,
    text:
      `In the last hour, your Google Workspace directory told Soup.net that ${count} of ${organizationName}'s members no longer exist, so they can't use Soup.net now. More may follow. ` +
      `If people have just left, there's nothing to do. If not, something may be answering for Google wrongly: check your organization's members in Soup.net, and contact Soup.net support if the list looks wrong.`,
  };
}

/** "2 people", "1 person", "nobody", for the emails below. */
function peopleCount(n: number): string {
  return n === 0 ? "nobody" : n === 1 ? "1 person" : `${n} people`;
}

/**
 * Tells an organization's other owners and admins that someone removed or
 * replaced its directory connection, so ending offboarding is never quiet
 * (F185). `liftedRefusals` is how many members the directory had switched off
 * and who work again because of it.
 */
export function directoryChangedEmail(
  organizationName: string,
  change: "disconnected" | "replaced",
  by: string,
  liftedRefusals: number,
): { subject: string; text: string } {
  const lifted = liftedRefusals === 0 ? "" : ` ${peopleCount(liftedRefusals)} the directory had switched off can use Soup.net again${change === "replaced" ? " until their next check" : ""}.`;
  const unexpected = "If you didn't expect this, an owner or admin can reconnect the directory from your organization's console, and your organization's activity shows what happened.";
  if (change === "disconnected") {
    return {
      subject: `${organizationName}'s Google Workspace directory was disconnected from Soup.net`,
      text: `${by} disconnected ${organizationName}'s Google Workspace directory from Soup.net, so Soup.net has stopped checking members against it.${lifted} ${unexpected}`,
    };
  }
  return {
    subject: `${organizationName}'s Google Workspace directory connection was replaced`,
    text: `${by} replaced ${organizationName}'s Google Workspace directory connection in Soup.net. Members are checked through the new connection from now on.${lifted} ${unexpected}`,
  };
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
export function directoryWarningEmail(organizationName: string, lastSuccessAt: Date, memberEmail: string): { subject: string; text: string } {
  const utc = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const everyoneBy = new Date(lastSuccessAt.getTime() + DIRECTORY_STALE_HOURS * 3600_000);
  return {
    subject: `Soup.net can't reach ${organizationName}'s Google Workspace directory`,
    text:
      `Soup.net just failed to check ${memberEmail} against your Google Workspace directory, and its last successful check of anyone was at ${utc(lastSuccessAt)}. ` +
      `A member whose status hasn't been confirmed for ${DIRECTORY_STALE_HOURS} hours is signed out of Soup.net, and their agents' keys stop working until a check succeeds. ` +
      `Members who haven't used Soup.net recently may be signed out already, and unless a check succeeds, everyone on your domain will be by ${utc(everyoneBy)}. ` +
      `To fix it, an owner or admin can reconnect the directory from your organization's console in Soup.net (or switch to a service account). ` +
      `While the directory can't answer, an owner or admin can disconnect it ${DIRECTORY_HOLD_HOURS} hours after this email, which stops the checks and lets back in anyone it had switched off, so if you aren't expecting that, reconnect it first. ` +
      `If nobody in your organization can sign in any more, contact Soup.net support.`,
  };
}

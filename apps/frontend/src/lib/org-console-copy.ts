import type { DomainClaimStatus } from "@soupnet/domain/browser";

/** A domain's state on the Domains page, naming what it means for joining. */
export const DOMAIN_STATUS_LABELS: Record<DomainClaimStatus, string> = {
  pending: "Waiting for the DNS record",
  verified: "Verified",
  failing: "Record missing, automatic joining paused",
  expired: "Verification code expired",
};

/** What a migration run did, as the page reports it right after a check or the switch. */
export function migrationSummaryMessage(summary: { joined: number; awaitingSeat: number; failed: number; stopped?: true }): string | null {
  const accounts = (n: number) => (n === 1 ? "1 account" : `${n} accounts`);
  const parts: string[] = [];
  if (summary.joined > 0) parts.push(`${accounts(summary.joined)} joined.`);
  if (summary.awaitingSeat > 0) parts.push(`${accounts(summary.awaitingSeat)} couldn't join because there are no free seats.`);
  if (summary.failed > 0) parts.push(`${accounts(summary.failed)} couldn't join on this try.`);
  if (summary.stopped) parts.push("This run stopped early.");
  if (parts.length === 0) return null;
  if (summary.failed > 0 || summary.stopped) parts.push("We try again every day, and you don't need to do anything.");
  return parts.join(" ");
}

/** The accounts waiting on a verified domain: a count, never a list (OD-X4). */
export function accountsAwaitingMessage(accounts: number, autoJoin: boolean): string {
  const who = accounts === 1 ? "1 verified account" : `${accounts} verified accounts`;
  const on = accounts === 1 ? "is" : "are";
  return autoJoin
    ? `${who} on this domain ${on} waiting to join. We try every day, and each needs a free seat.`
    : `${who} on this domain would join if you turned automatic joining on.`;
}

/**
 * The directory connection's last error, as a code and never what came with
 * it: a stored rename names two addresses, and anything that isn't a plain
 * code shows as unknown, so a Google response body can't reach the page.
 */
export function directoryLastErrorLabel(lastError: string): string {
  if (lastError.startsWith("renamed:")) return "A member's address changed in Google Workspace (renamed)";
  const http = /^http_(\d{3})$/.exec(lastError);
  if (http) return http[1] === "401" || http[1] === "403" ? `Google refused the connection (${lastError})` : `Google answered with an error (${lastError})`;
  return /^[a-z0-9_]{1,64}$/.test(lastError) ? lastError : "Unknown error";
}

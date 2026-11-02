import type { DomainClaimStatus } from "@soupnet/domain/browser";

/**
 * "What your organization's admins can see" (/app/settings/organization). This
 * page is the promise to employees, so each sentence has to hold for every kind
 * of book. The private-book line is enforced by the org console's reads, and the
 * org-wide line follows from those books being open to every member. Change it
 * only with the code that makes it true; org-console-copy.test.ts pins the text.
 */
export const MEMBER_PAGE_COPY = {
  canSeeOrgWide: "The names of the organization's org-wide recipe books and how many people belong to each. Like everyone in the organization, they can also read the published recipes in those books.",
  cannotSee: [
    "Your private recipe books' names, or the recipes in them, unless you share a book with them.",
    "What you and your agents search for.",
    "Your API keys themselves, their names, or which books they reach.",
    "Your sign-in history or how you sign in. They see only the latest time you signed in or a key was used, as listed above.",
  ],
  orgWide: "An org-wide recipe book, including the organization's default book, is open to everyone in the organization, admins included. A recipe you or your agent checks into one is logged there, and anyone in the organization can read it and see that it's yours once it's published. To keep a recipe private, check it into a private book.",
  oneWayIn: "Your organization can get to your private books by taking over this account. Because it controls your work email and, if you sign in with Google, your company Google account, it can reset your sign-in and sign in as you. Soup.net doesn't let admins browse private books, so unless you share a book with them, that is the only path to it, and it shows up below as a sign-in you didn't make.",
} as const;

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
  if (summary.failed > 0 || summary.stopped) parts.push("We try again every day. If this keeps happening, contact Soup.net support.");
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

/** What the stored codes mean. `token_…` and `http_…` carry a variable part, so they are matched below. */
const DIRECTORY_ERROR_LABELS: Record<string, string> = {
  member_renamed: "A member's address changed in Google Workspace",
  bad_answer: "Google's answer wasn't a complete record of the person",
  bad_404: "Google answered with an unexpected not-found",
  admin_not_found: "Google Workspace can't find the admin behind this connection",
  bad_service_account_key: "The service account's key wasn't usable",
  decrypt_failed: "Soup.net couldn't read the saved credential",
};

/**
 * What turning automatic joining on will do, asked before it happens: it moves
 * people's existing accounts, and neither they nor the switch can undo that.
 * `accounts` is undefined until the domain is verified: the count is behind DNS
 * proof (OD-X4).
 */
export function autoJoinConfirmMessage(domain: string, accounts: number | undefined): string {
  const lasting = "Turning this off later won't return anyone who has joined, and the organization manages their accounts from then on, so they can't delete them themselves.";
  if (accounts === undefined) return `Once ${domain} is verified, existing verified accounts on it move into your organization, each as a seat is free, and so does anyone who verifies an address on it later. ${lasting}`;
  const moving = accounts === 0
    ? `No existing accounts on ${domain} are waiting to move in right now.`
    : `${accounts === 1 ? "1 existing account" : `${accounts} existing accounts`} on ${domain} will move into your organization, each as a seat is free.`;
  return `${moving} Anyone who verifies an address on it later joins too. ${lasting}`;
}

/**
 * The directory connection's last error, as a label and its code and never
 * what came with it: anything that isn't a plain code shows as unknown, so a
 * Google response body can't reach the page.
 */
export function directoryLastErrorLabel(lastError: string): string {
  const known = Object.prototype.hasOwnProperty.call(DIRECTORY_ERROR_LABELS, lastError) ? DIRECTORY_ERROR_LABELS[lastError] : undefined;
  if (known) return `${known} (${lastError})`;
  if (/^token_[A-Za-z0-9_]{1,48}$/.test(lastError)) return `Google refused the connection's credential (${lastError})`;
  const http = /^http_(\d{3})$/.exec(lastError);
  if (http) return http[1] === "401" || http[1] === "403" ? `Google refused the connection (${lastError})` : `Google answered with an error (${lastError})`;
  return /^[a-z0-9_]{1,64}$/.test(lastError) ? lastError : "Unknown error";
}

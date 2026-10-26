/**
 * Verified domains for company organizations (organization accounts round 1,
 * stream Domains; rubric docs/planning/org-accounts-build/domains.md): the
 * pure rules and the copy. No I/O.
 *
 * A company proves it controls an email domain by publishing a DNS TXT record
 * at `_soupnet-challenge.<domain>` (recipe 4d5b5b81). The record must stay:
 * a daily re-check freezes automatic joining the moment it goes missing, and
 * fourteen days of failed checks turns the domain unverified, without ever
 * touching a member or a book (recipe b79cc790). Whether joins may happen on
 * a domain's authority is decided in SQL by the authz module's
 * `domainVerifiedFor`; `isDomainCaptured` states the same rule for tests and
 * display.
 */

export const DOMAIN_CHALLENGE_LABEL = "_soupnet-challenge";
export const DOMAIN_RECORD_PREFIX = "soupnet-domain-verification=";
/** A claim that has never been verified must be within this many days of its token. */
export const DOMAIN_CHALLENGE_TTL_DAYS = 7;
/** How often the scheduled job re-checks a verified claim (published, IETF draft). */
export const DOMAIN_RECHECK_HOURS = 24;
/** A claim not successfully checked within this long grants no joins, so a stopped job freezes them. */
export const DOMAIN_FRESHNESS_HOURS = 48;
/** How long a verified claim may fail before it lapses (published, IETF draft; Atlassian's number). */
export const DOMAIN_GRACE_DAYS = 14;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// ── Normalization ────────────────────────────────────────────────────────────

export type DomainRefusal = "invalid_domain" | "public_email_domain" | "domain_taken" | "challenge_expired";

export type NormalizedDomain =
  | { ok: true; domain: string }
  | { ok: false; refusal: "invalid_domain" | "public_email_domain" };

// Characters that mean the input is a URL, an address or a host:port rather
// than a bare name. Rejected before parsing, so the URL parser can't quietly
// keep only part of what was typed.
const NOT_A_BARE_NAME = /[\s/\\?#@:[\]%]/;
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * A host name in its stored form (lowercase ASCII, punycode for an
 * internationalized label, no trailing dot), or null when the input isn't a
 * plain name of two or more labels. IP literals are refused: the WHATWG URL
 * parser turns any IPv4 spelling into dotted decimal, whose last label is
 * numeric, and IPv6 needs brackets, which are refused outright.
 */
function toAsciiHost(raw: string): string | null {
  let text = raw.trim();
  if (text.endsWith(".")) text = text.slice(0, -1);
  if (!text || NOT_A_BARE_NAME.test(text)) return null;
  let host: string;
  try {
    host = new URL(`http://${text}`).hostname;
  } catch {
    return null;
  }
  if (host.length > 253) return null;
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null;
  if (/^[0-9]+$/.test(labels[labels.length - 1]!)) return null;
  return host;
}

/**
 * The domain an org admin typed, in the form a claim is stored and compared
 * in, or the reason it can't be claimed (rubric OD-V1, OD-V2).
 */
export function normalizeDomain(raw: unknown): NormalizedDomain {
  if (typeof raw !== "string") return { ok: false, refusal: "invalid_domain" };
  const domain = toAsciiHost(raw);
  if (!domain) return { ok: false, refusal: "invalid_domain" };
  if (isPublicEmailDomain(domain)) return { ok: false, refusal: "public_email_domain" };
  return { ok: true, domain };
}

// Public and hosted-mail providers (recipe ddb90531, audit at rubric stage).
// The DNS proof can't be met under these zones anyway; the list is for a plain
// message at the form.
const PUBLIC_EXACT = new Set([
  "gmail.com", "googlemail.com",
  "icloud.com", "me.com", "mac.com",
  "proton.me", "protonmail.com", "protonmail.ch", "pm.me",
  "aol.com", "aim.com",
  "mail.com", "email.com",
  "zoho.com", "zohomail.com",
  "fastmail.com", "fastmail.fm",
  "hey.com",
  "tutanota.com", "tuta.io", "tuta.com",
  "mail.ru", "web.de", "t-online.de",
  "qq.com", "163.com", "126.com", "naver.com", "daum.net",
  "rocketmail.com", "inbox.com", "hushmail.com",
]);
// Hosted tenants: anything at or under these.
const PUBLIC_SUFFIXES = ["onmicrosoft.com"];
// Brands that register many country domains: the brand label followed by a
// one-label ending (yahoo.com, gmx.de) or a two-label one whose first label is
// a short registry level (yahoo.co.uk, hotmail.com.br).
const PUBLIC_BRANDS = new Set(["yahoo", "hotmail", "live", "outlook", "gmx", "msn", "ymail", "yandex"]);

/** Is `domain` (already normalized) a public or hosted-mail provider's? */
export function isPublicEmailDomain(domain: string): boolean {
  if (PUBLIC_EXACT.has(domain)) return true;
  if (PUBLIC_SUFFIXES.some((suffix) => domain === suffix || domain.endsWith(`.${suffix}`))) return true;
  const [brand, ...ending] = domain.split(".");
  if (!PUBLIC_BRANDS.has(brand!)) return false;
  return ending.length === 1 || (ending.length === 2 && ending[0]!.length <= 3);
}

// ── Addresses ────────────────────────────────────────────────────────────────

/**
 * The domain part of an email address, normalized exactly as a claim is
 * (OD-J8), or "" when it isn't a plain host name. Never refused for being a
 * public provider: this answers "which domain is the address on".
 */
export function addressDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return toAsciiHost(email.slice(at + 1)) ?? "";
}

/** Is the address on exactly this domain? Equality, never a suffix: subdomains are claimed separately. */
export function isAddressOnDomain(email: string, domain: string): boolean {
  const own = addressDomain(email);
  return own !== "" && own === domain;
}

/**
 * Does a Google sign-in's `hd` claim put this address on this claimed domain?
 * `hd` must equal both (OD-J3): the Workspace's domain and the address's.
 */
export function googleHdMatches(hd: string | null | undefined, email: string, domain: string): boolean {
  if (!hd) return false;
  return toAsciiHost(hd) === domain && isAddressOnDomain(email, domain);
}

// ── The record ───────────────────────────────────────────────────────────────

export interface DomainChallengeRecord {
  name: string;
  value: string;
}

export function domainChallengeRecord(domain: string, token: string): DomainChallengeRecord {
  return { name: `${DOMAIN_CHALLENGE_LABEL}.${domain}`, value: `${DOMAIN_RECORD_PREFIX}${token}` };
}

/**
 * Does a TXT answer (one array of character-strings per record) hold the
 * expected value exactly? A record's strings are joined first (RFC 7208 §3.3
 * splits long values that way); a value inside a longer one doesn't count
 * (OD-V5).
 */
export function txtAnswerMatches(answer: string[][], expected: string): boolean {
  if (!expected) return false;
  return answer.some((record) => record.join("") === expected);
}

// ── The claim's state ────────────────────────────────────────────────────────

export interface DomainClaimState {
  verifiedAt: Date | null;
  failingSince: Date | null;
  lastCheckedAt: Date | null;
  lastFoundAt: Date | null;
  tokenIssuedAt: Date;
}

export type DomainCheckOutcome = "found" | "absent" | "error";

export type DomainCheckEvent =
  | "verified"
  | "still_pending"
  | "expired"
  | "still_verified"
  | "failing"
  | "still_failing"
  | "recovered"
  | "lapsed";

export interface DomainCheckResult {
  next: DomainClaimState;
  event: DomainCheckEvent;
  /** The claim lapsed: the caller issues a new token (next.tokenIssuedAt is already now). */
  rotateToken: boolean;
}

export function challengeExpiresAt(state: Pick<DomainClaimState, "tokenIssuedAt">): Date {
  return new Date(state.tokenIssuedAt.getTime() + DOMAIN_CHALLENGE_TTL_DAYS * DAY_MS);
}

function challengeExpired(state: DomainClaimState, now: Date): boolean {
  return state.verifiedAt === null && now.getTime() > challengeExpiresAt(state).getTime();
}

/**
 * Apply one DNS check to a claim. A failed check is any check that didn't
 * find the record, an error included: freezing is cheap, so the claim fails
 * closed (OD-R2). Every failure is measured from the first one, and the
 * fourteenth day lapses the claim (OD-R4).
 */
export function applyDomainCheck(state: DomainClaimState, outcome: DomainCheckOutcome, now: Date): DomainCheckResult {
  if (challengeExpired(state, now)) return { next: state, event: "expired", rotateToken: false };
  const found = outcome === "found";

  if (state.verifiedAt === null) {
    if (!found) return { next: { ...state, lastCheckedAt: now }, event: "still_pending", rotateToken: false };
    return {
      next: { ...state, verifiedAt: now, failingSince: null, lastCheckedAt: now, lastFoundAt: now },
      event: "verified",
      rotateToken: false,
    };
  }

  if (found) {
    return {
      next: { ...state, failingSince: null, lastCheckedAt: now, lastFoundAt: now },
      event: state.failingSince ? "recovered" : "still_verified",
      rotateToken: false,
    };
  }

  const failingSince = state.failingSince ?? now;
  if (now.getTime() - failingSince.getTime() >= DOMAIN_GRACE_DAYS * DAY_MS) {
    return {
      next: { ...state, verifiedAt: null, failingSince: null, lastCheckedAt: now, tokenIssuedAt: now },
      event: "lapsed",
      rotateToken: true,
    };
  }
  return {
    next: { ...state, failingSince, lastCheckedAt: now },
    event: state.failingSince ? "still_failing" : "failing",
    rotateToken: false,
  };
}

export type DomainClaimStatus = "pending" | "expired" | "verified" | "failing";

export function domainClaimStatus(state: DomainClaimState, now: Date): DomainClaimStatus {
  if (state.verifiedAt === null) return challengeExpired(state, now) ? "expired" : "pending";
  return state.failingSince ? "failing" : "verified";
}

/** When a failing claim lapses, or null when it isn't failing. */
export function domainLapsesAt(state: Pick<DomainClaimState, "failingSince">): Date | null {
  return state.failingSince ? new Date(state.failingSince.getTime() + DOMAIN_GRACE_DAYS * DAY_MS) : null;
}

/**
 * The rule `domainVerifiedFor` (authz) states in SQL: verified, checked
 * recently, not failing, and switched on (OD-R6).
 */
export function isDomainCaptured(state: DomainClaimState & { autoJoin: boolean }, now: Date): boolean {
  if (!state.lastCheckedAt || now.getTime() - state.lastCheckedAt.getTime() > DOMAIN_FRESHNESS_HOURS * HOUR_MS) return false;
  return state.verifiedAt !== null && state.failingSince === null && state.autoJoin;
}

// ── Copy ─────────────────────────────────────────────────────────────────────

const REFUSALS: Record<DomainRefusal, string> = {
  invalid_domain: "Enter a domain name such as example.com, without http://, a path or an email address.",
  public_email_domain: "This is a public email provider's domain. Only a domain your organization controls can be verified.",
  domain_taken: "This domain is already verified by another organization. Contact Soup.net support.",
  challenge_expired: "This verification code has expired. Add the domain again to get a new one; codes last seven days.",
};

export function domainRefusalMessage(refusal: DomainRefusal): string {
  return REFUSALS[refusal];
}

/** What an org admin is told to publish, and what we do with it (OD-D2). */
export function domainInstructions(record: DomainChallengeRecord): string {
  return [
    `Add a TXT record named ${record.name} with the value ${record.value} at your DNS provider.`,
    "DNS changes usually appear within minutes but can take up to 72 hours.",
    "This code expires in seven days if we haven't found the record by then.",
    "Keep the record in place after verification: we re-check every day, and if it's missing, automatic joining pauses at once and the domain becomes unverified after fourteen days. Nobody's account or books are affected either way.",
    "To revoke the claim, remove the record or delete the domain here.",
    "Subdomains are verified separately: a claim on example.com doesn't cover mail.example.com.",
    "Before your organization gives up this domain, delete it here, or whoever takes the domain over could keep the claim alive.",
  ].join(" ");
}

/** "Check now" found no matching record; names where we looked and nothing we saw (OD-V3). */
export function domainNotFoundMessage(recordName: string): string {
  return `No matching record was found at ${recordName}. DNS changes can take up to 72 hours to appear.`;
}

/** The verification email and verify page, for an address on a captured domain (recipe 43b6aac9). */
export function domainJoinNotice(organizationName: string): string {
  return `Confirming this address adds your account to ${organizationName} on Soup.net. ${organizationName}'s admins will manage it.`;
}

/** The verify page after the click joined (OD-J1). */
export function domainJoinedNotice(organizationName: string): string {
  return `Your account now belongs to ${organizationName} on Soup.net. ${organizationName}'s admins manage it.`;
}

/** The verify page when the organization had no free seat (OD-C1). */
export const DOMAIN_JOIN_FULL_RETRY =
  "Your address isn't verified yet. This same link works for 24 hours once a seat is free, or sign in later to get a new one.";

export interface DomainEmail {
  subject: string;
  text: string;
}

/** To an organization's active owners and admins when a verified claim starts failing (OD-R2). Names the record, never a token. */
export function domainFailingEmail(input: { organizationName: string; domain: string; recordName: string; lapsesAt: Date }): DomainEmail {
  const { organizationName, domain, recordName, lapsesAt } = input;
  const date = lapsesAt.toISOString().slice(0, 10);
  return {
    subject: `Soup.net: the verification record for ${domain} is missing`,
    text: [
      `We couldn't find the TXT record at ${recordName} that verifies ${domain} for ${organizationName} on Soup.net.`,
      `Automatic joining on ${domain} is paused until the record is back.`,
      `If it's still missing on ${date}, ${domain} becomes unverified and will need to be verified again.`,
      "Nobody's account or books change.",
      "To fix it, put the record back as shown on your organization's Domains page.",
    ].join(" "),
  };
}

/** To the same people when the claim lapses (OD-R4). Names no token. */
export function domainLapsedEmail(input: { organizationName: string; domain: string }): DomainEmail {
  const { organizationName, domain } = input;
  return {
    subject: `Soup.net: ${domain} is no longer verified for ${organizationName}`,
    text: [
      `${domain} is no longer verified for ${organizationName} on Soup.net, because its TXT record was missing for fourteen days.`,
      "Automatic joining on it has stopped.",
      "Nobody's account or books changed.",
      "To verify it again, publish the new record shown on your organization's Domains page.",
    ].join(" "),
  };
}

/**
 * The one DNS lookup behind domain verification (organization accounts
 * round 1, stream Domains; rubric OD-M2). It asks for the TXT records at a
 * claim's `_soupnet-challenge.<domain>` name and says whether the exact value
 * is there. Callers turn the outcome into the claim's next state with
 * `applyDomainCheck` from @soupnet/domain.
 *
 * Outcomes:
 *   - found:  a record's joined strings equal the value exactly;
 *   - absent: the name doesn't exist (ENOTFOUND), holds no TXT (ENODATA), or
 *             holds no matching value;
 *   - error:  anything else (timeout, SERVFAIL, refused). A verified claim
 *             treats an error like an absence and fails closed.
 *
 * The resolver is injected so tests run offline; production uses the
 * system's configured resolver with a short timeout. Nothing seen in DNS is
 * ever returned to a caller beyond the outcome, so the route can't be used
 * to read other people's TXT records.
 */

import { Resolver } from "node:dns/promises";
import { DOMAIN_CHALLENGE_LABEL, txtAnswerMatches, type DomainChallengeRecord, type DomainCheckOutcome } from "@soupnet/domain";

export type TxtLookup = (name: string) => Promise<string[][]>;

export interface DomainRecordCheck {
  outcome: DomainCheckOutcome;
  /** The resolver's error code, for the log; never shown to an org admin. */
  code?: string;
}

const ABSENT_CODES = new Set(["ENOTFOUND", "ENODATA"]);

/** The system resolver: 5 seconds per try, two tries. */
export function systemTxtLookup(): TxtLookup {
  const resolver = new Resolver({ timeout: 5000, tries: 2 });
  return (name) => resolver.resolveTxt(name);
}

export async function checkDomainRecord(record: DomainChallengeRecord, lookup: TxtLookup = systemTxtLookup()): Promise<DomainRecordCheck> {
  // Only ever query a challenge label, whatever a caller passes.
  if (!record.name.startsWith(`${DOMAIN_CHALLENGE_LABEL}.`)) return { outcome: "error", code: "bad_record_name" };
  try {
    const answer = await lookup(record.name);
    return { outcome: txtAnswerMatches(answer, record.value) ? "found" : "absent" };
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && ABSENT_CODES.has(code)) return { outcome: "absent", code };
    return { outcome: "error", code: typeof code === "string" ? code : "unknown" };
  }
}

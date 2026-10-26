/**
 * The directory check's SQL fragments (organization accounts round 1, stream
 * Offboarding; rubric docs/planning/org-accounts-build/offboarding.md).
 *
 * A member is CHECKED when their organization has a directory connection on
 * a domain whose claim is current (stream Domains' freshness), and their
 * address, or their linked Google identity's `hd`, is on exactly that domain
 * (recipe 88b1b328; Domains' exact-domain rule, OD-J8). This SQL is the one
 * statement of the rule.
 *   - INACTIVE: the directory said suspended, archived, or unknown (deleted).
 *     A recorded refusal holds while the organization has a connection,
 *     whatever state the domain claim is in (audit F113): a failed DNS
 *     re-check, a removed TXT record or a stalled re-check job stops new
 *     checks, never brings a switched-off member back. Reconnecting or
 *     disconnecting clears the recorded statuses.
 * For a checked member:
 *   - UNCONFIRMED: no successful check for DIRECTORY_STALE_HOURS (a
 *     never-checked member counts from when the directory was connected);
 *   - DUE: no successful check for DIRECTORY_CHECK_INTERVAL_MINUTES, and no
 *     live claim on the next one (a claim older than DIRECTORY_CLAIM_SECONDS
 *     doesn't count: its task died).
 *
 * INACTIVE and UNCONFIRMED land in `orgMembershipDisabled()` (account-state.ts),
 * so the same join as an admin's disable refuses every credential (recipe
 * 92b866ee). Every time compared here was written by the database's clock.
 * Written against an `organization_members` row aliased `om`.
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  DIRECTORY_CHECK_INTERVAL_MINUTES,
  DIRECTORY_CLAIM_SECONDS,
  DIRECTORY_STALE_HOURS,
} from "@soupnet/domain";
import { domainClaimCurrentAt } from "./domain-authority";

/**
 * The connection `dc` under which the member in `om` is checked, as a WHERE
 * body for a statement that has `dc` (organization_directory_connections) and
 * `du` (the member's users row) in scope.
 */
export function checkedUnder(): SQL {
  return sql`(dc.organization_id = om.organization_id
    AND ${domainClaimCurrentAt(sql`dc.organization_id`, sql`dc.domain`)}
    AND (lower(substring(du.email from '@([^@]+)$')) IN (dc.domain, dc.domain_unicode)
      OR EXISTS (
        SELECT 1 FROM claimnet.user_identities di
        WHERE di.user_id = om.user_id AND di.provider = 'google' AND lower(di.hosted_domain) IN (dc.domain, dc.domain_unicode)
      )))`;
}

function whenChecked(condition: SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM claimnet.organization_directory_connections dc
    JOIN claimnet.users du ON du.id = om.user_id
    WHERE ${checkedUnder()} AND ${condition}
  )`;
}

/** The directory said this member isn't active (F113: not gated on the claim). */
export function directoryInactive(): SQL {
  return sql`(om.directory_status IN ('suspended', 'archived', 'deleted') AND EXISTS (
    SELECT 1 FROM claimnet.organization_directory_connections dc WHERE dc.organization_id = om.organization_id
  ))`;
}

/** No successful check for a day: fail closed until one succeeds. */
export function directoryUnconfirmed(): SQL {
  return whenChecked(sql`COALESCE(om.directory_checked_at, dc.connected_at) < NOW() - make_interval(hours => ${DIRECTORY_STALE_HOURS})`);
}

/** Due for a check, with no live claim on it. */
export function directoryCheckDue(): SQL {
  return whenChecked(sql`(om.directory_checked_at IS NULL
      OR om.directory_checked_at < NOW() - make_interval(mins => ${DIRECTORY_CHECK_INTERVAL_MINUTES}))
    AND (om.directory_check_claimed_at IS NULL
      OR om.directory_check_claimed_at < NOW() - make_interval(secs => ${DIRECTORY_CLAIM_SECONDS}))`);
}

/** Is the account in `userIdColumn` due a directory check? For the validation statements. */
export function directoryCheckDueFor(userIdColumn: SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM claimnet.organization_members om
    WHERE om.user_id = ${userIdColumn} AND ${directoryCheckDue()}
  )`;
}

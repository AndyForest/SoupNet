/**
 * Domain authority for the organization join (organizations.ts).
 *
 * A join under a domain's authority moves an existing account's books into
 * the company, so it is allowed only when the organization has verified that
 * domain now (program §3.2: DNS TXT, re-verified, with a grace period that
 * freezes auto-join). Stream Domains owns the verification table and fills
 * this one fragment; it is the only change Domains makes in this module.
 *
 * Stream Domains filled it (rubric docs/planning/org-accounts-build/domains.md,
 * OD-R6): a claim in `organization_domains` for exactly this organization and
 * domain, successfully checked within the freshness window (so a stopped
 * re-check job freezes joins within two days instead of trusting a stale
 * claim), verified, not failing, and with automatic joining switched on.
 * The table's writer is services/org-domains.service.ts; this is its only
 * other reader.
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { DOMAIN_FRESHNESS_HOURS } from "@soupnet/domain";

/**
 * Does `organizationId` hold a current claim on `domain` (lowercase ASCII):
 * successfully checked within the freshness window, verified, and not
 * failing? The automatic-joining switch is not part of it. For Core's bounded
 * operator join (OC-F1), which shouldn't depend on that switch. A boolean SQL
 * expression.
 */
export function domainClaimCurrentFor(organizationId: string, domain: string): SQL {
  return claimExists(sql`${organizationId}::uuid`, sql`${domain}`, sql``);
}

/**
 * The same test against columns of the enclosing statement, for stream
 * Offboarding's directory check: a connection's checks run only while its
 * domain claim is current, so a lapsed claim stops them rather than
 * switching anyone off (offboarding.md OB-C9).
 */
export function domainClaimCurrentAt(organizationIdColumn: SQL, domainColumn: SQL): SQL {
  return claimExists(organizationIdColumn, domainColumn, sql``);
}

/**
 * Has `organizationId` verified `domain` (lowercase ASCII), currently and
 * outside any auto-join freeze, with auto-join switched on? The switch is
 * inside the fragment so no caller can join on a domain's authority with it
 * off. The authority for every automatic join. A boolean SQL expression.
 */
export function domainVerifiedFor(organizationId: string, domain: string): SQL {
  return claimExists(sql`${organizationId}::uuid`, sql`${domain}`, sql` AND d.auto_join`);
}

// The freshness clause leads: it is what makes a daily re-check safe.
function claimExists(organizationId: SQL, domain: SQL, extra: SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM claimnet.organization_domains d
    WHERE d.organization_id = ${organizationId}
      AND d.domain = ${domain}
      AND d.last_checked_at > NOW() - make_interval(hours => ${DOMAIN_FRESHNESS_HOURS})
      AND d.verified_at IS NOT NULL
      AND d.failing_since IS NULL${extra}
  )`;
}

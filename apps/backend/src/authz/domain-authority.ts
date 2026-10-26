/**
 * Domain authority for the organization join (organizations.ts).
 *
 * A join under a domain's authority moves an existing account's books into
 * the company, so it is allowed only when the organization has verified that
 * domain now (program §3.2: DNS TXT, re-verified, with a grace period that
 * freezes auto-join). Stream Domains owns the verification table and fills
 * this one fragment; it is the only change Domains makes in this module.
 *
 * Until then it is FALSE: no join can fire on a domain's authority, so the
 * only way into an organization is the site operator.
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

/**
 * Has `organizationId` verified `domain` (lowercase), currently and outside
 * any auto-join freeze, with auto-join switched on? The switch is inside the
 * fragment so no caller can join on a domain's authority with it off. A
 * boolean SQL expression.
 */
export function domainVerifiedFor(_organizationId: string, _domain: string): SQL {
  return sql`FALSE`;
}

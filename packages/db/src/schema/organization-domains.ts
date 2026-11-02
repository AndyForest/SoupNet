/**
 * Organization domains — a company organization's claim on an email domain
 * (organization accounts round 1, stream Domains; rubric
 * docs/planning/org-accounts-build/domains.md, OD-S1).
 *
 * A claim is proved by a DNS TXT record at `_soupnet-challenge.<domain>`
 * whose value carries `challenge_token`, and must stay proved: a daily job
 * re-checks it, `failing_since` freezes automatic joining from the first
 * failed check, and fourteen days of failure clear `verified_at` (the claim
 * lapses, its token is rotated, and the unique index below releases the
 * domain). Members and books are never touched by any of this.
 *
 * `auto_join` is the one switch for every automatic join on the domain.
 * Whether a join may happen on a claim's authority is decided by
 * `domainVerifiedFor` in apps/backend/src/authz/domain-authority.ts, the only
 * reader outside services/org-domains.service.ts, which is the only writer.
 */

import { uuid, text, boolean, timestamp, index, unique, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { claimnetSchema } from "./traces";
import { organizations } from "./organizations";

export const organizationDomains = claimnetSchema.table(
  "organization_domains",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    // Lowercase ASCII (punycode for an internationalized name), no trailing
    // dot: normalizeDomain in @soupnet/domain. Subdomains are separate claims.
    domain: text("domain").notNull(),

    challengeToken: text("challenge_token").notNull(),
    tokenIssuedAt: timestamp("token_issued_at", { withTimezone: true }).notNull(),

    // Null while pending, and again after a lapse.
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastFoundAt: timestamp("last_found_at", { withTimezone: true }),
    // The first failed check since the record was last found; null when it
    // isn't failing.
    failingSince: timestamp("failing_since", { withTimezone: true }),

    autoJoin: boolean("auto_join").notNull().default(false),

    // Who added the claim. No foreign key, like audit_log.actor_user_id.
    addedBy: uuid("added_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("organization_domains_org_domain_unique").on(t.organizationId, t.domain),
    // One verified claim per domain across the site; pending claims by
    // several organizations may coexist.
    uniqueIndex("organization_domains_verified_domain_unique").on(t.domain).where(sql`${t.verifiedAt} IS NOT NULL`),
    index("organization_domains_domain_idx").on(t.domain),
    check("organization_domains_domain_lowercase", sql`${t.domain} = lower(${t.domain})`),
  ]
);

export type OrganizationDomain = typeof organizationDomains.$inferSelect;
export type NewOrganizationDomain = typeof organizationDomains.$inferInsert;

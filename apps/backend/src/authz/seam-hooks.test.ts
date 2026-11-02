import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { domainVerifiedFor, domainClaimCurrentFor } from "./domain-authority";
import { ssoRequired } from "./sso-policy";
import { sharingPolicyAllows } from "./sharing-policy";
import { accountIsManaged } from "./organizations";
import { orgMembershipDisabled } from "./account-state";

// Layer 1 — the one-body hooks other streams fill (organization accounts
// round 1). These pin what each answers until its stream fills it: nothing
// joins on a domain's authority, and no membership grant is refused by a
// sharing policy. SSO's row pins the filled policy instead, and Domains' row
// its filled domain authority. A stream that fills a body updates its row
// here in the same change (Console owns sharing-policy.ts whole, and its row).

const dialect = new PgDialect();

describe("the hooks' answers before their streams fill them", () => {
  it("domainVerifiedFor, filled by stream Domains: fresh, verified, not failing, switched on (OD-R6)", () => {
    const q = dialect.sqlToQuery(domainVerifiedFor("11111111-1111-4111-8111-111111111111", "acme.example"));
    expect(q.sql).toContain("FROM claimnet.organization_domains d");
    // The freshness clause first: it is what makes the daily schedule safe.
    expect(q.sql.indexOf("d.last_checked_at >")).toBeLessThan(q.sql.indexOf("d.verified_at IS NOT NULL"));
    for (const clause of ["d.organization_id = $1::uuid", "d.domain = $2", "d.verified_at IS NOT NULL", "d.failing_since IS NULL", "d.auto_join"]) {
      expect(q.sql).toContain(clause);
    }
    expect(q.params).toEqual(["11111111-1111-4111-8111-111111111111", "acme.example", 48]);
  });

  it("domainClaimCurrentFor is the same claim test without the switch (Core's bounded operator join, OC-F1)", () => {
    const current = dialect.sqlToQuery(domainClaimCurrentFor("11111111-1111-4111-8111-111111111111", "acme.example"));
    const verified = dialect.sqlToQuery(domainVerifiedFor("11111111-1111-4111-8111-111111111111", "acme.example"));
    expect(current.sql).not.toContain("auto_join");
    expect(verified.sql.replace(" AND d.auto_join", "")).toBe(current.sql);
    expect(current.params).toEqual(verified.params);
  });

  it("ssoRequired holds for an active member of an organization requiring SSO (stream SSO, filled)", () => {
    const text = dialect.sqlToQuery(ssoRequired()).sql.replace(/\s+/g, " ");
    expect(text).toContain("FROM claimnet.organization_members om JOIN claimnet.organizations o ON o.id = om.organization_id");
    expect(text).toContain("om.user_id = u.id AND o.require_sso AND NOT ((om.disabled_at IS NOT NULL OR (");
  });

  it("sharingPolicyAllows is true (stream Console)", async () => {
    const neverCalled = { execute: () => { throw new Error("the stub reads nothing"); } } as never;
    expect(await sharingPolicyAllows(neverCalled, { bookId: "b", userId: "u", actorUserId: "a" })).toBe(true);
  });

  it("orgMembershipDisabled is the org admin's switch or the Workspace directory's (stream Offboarding, filled)", () => {
    const text = dialect.sqlToQuery(orgMembershipDisabled()).sql.replace(/\s+/g, " ");
    // A recorded refusal needs only a connection, never a current domain claim (F113).
    expect(text.startsWith(
      "(om.disabled_at IS NOT NULL OR (om.directory_status IN ('suspended', 'archived', 'deleted') AND EXISTS ( SELECT 1 FROM claimnet.organization_directory_connections dc WHERE dc.organization_id = om.organization_id )) OR EXISTS (",
    )).toBe(true);
    // The stale rule runs only while the connection's domain claim is current.
    expect(text).toContain("FROM claimnet.organization_domains d");
    expect(text).toContain("COALESCE(om.directory_checked_at, dc.connected_at) < NOW() - make_interval(hours => $");
  });

  it("accountIsManaged is an EXISTS over the caller's column, binding nothing", () => {
    const q = dialect.sqlToQuery(accountIsManaged(sql`u.id`));
    expect(q.sql).toBe("EXISTS (SELECT 1 FROM claimnet.organization_members managed_om WHERE managed_om.user_id = u.id)");
    expect(q.params).toEqual([]);
  });
});

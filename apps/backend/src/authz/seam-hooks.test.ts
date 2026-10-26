import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { domainVerifiedFor } from "./domain-authority";
import { ssoRequired } from "./sso-policy";
import { sharingPolicyAllows } from "./sharing-policy";
import { accountIsManaged } from "./organizations";
import { orgMembershipDisabled } from "./account-state";

// Layer 1 — the one-body hooks other streams fill (organization accounts
// round 1). These pin what each answers until its stream fills it: nothing
// joins on a domain's authority, and no membership grant is refused by a
// sharing policy. SSO's row pins the filled policy instead. A stream that
// fills a body updates its row here in the same change.

const dialect = new PgDialect();

describe("the hooks' answers before their streams fill them", () => {
  it("domainVerifiedFor is FALSE (stream Domains)", () => {
    expect(dialect.sqlToQuery(domainVerifiedFor("11111111-1111-4111-8111-111111111111", "acme.example")).sql).toBe("FALSE");
  });

  it("ssoRequired holds for an active member of an organization requiring SSO (stream SSO, filled)", () => {
    const text = dialect.sqlToQuery(ssoRequired()).sql.replace(/\s+/g, " ");
    expect(text).toContain("FROM claimnet.organization_members om JOIN claimnet.organizations o ON o.id = om.organization_id");
    expect(text).toContain("om.user_id = u.id AND o.require_sso AND NOT (om.disabled_at IS NOT NULL)");
  });

  it("sharingPolicyAllows is true (stream Console)", async () => {
    const neverCalled = { execute: () => { throw new Error("the stub reads nothing"); } } as never;
    expect(await sharingPolicyAllows(neverCalled, { bookId: "b", userId: "u" })).toBe(true);
  });

  it("orgMembershipDisabled is the org admin's switch (stream Offboarding extends it)", () => {
    expect(dialect.sqlToQuery(orgMembershipDisabled()).sql).toBe("om.disabled_at IS NOT NULL");
  });

  it("accountIsManaged is an EXISTS over the caller's column, binding nothing", () => {
    const q = dialect.sqlToQuery(accountIsManaged(sql`u.id`));
    expect(q.sql).toBe("EXISTS (SELECT 1 FROM claimnet.organization_members om WHERE om.user_id = u.id)");
    expect(q.params).toEqual([]);
  });
});

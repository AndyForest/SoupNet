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
// joins on a domain's authority, no session is refused for how it signed in,
// no membership grant is refused by a sharing policy. A stream that fills a
// body updates its row here in the same change (Console owns
// sharing-policy.ts whole, and its row).

const dialect = new PgDialect();

describe("the hooks' answers before their streams fill them", () => {
  it("domainVerifiedFor is FALSE (stream Domains)", () => {
    expect(dialect.sqlToQuery(domainVerifiedFor("11111111-1111-4111-8111-111111111111", "acme.example")).sql).toBe("FALSE");
  });

  it("ssoRequired is FALSE (stream SSO)", () => {
    expect(dialect.sqlToQuery(ssoRequired()).sql).toBe("FALSE");
  });

  it("sharingPolicyAllows is true (stream Console)", async () => {
    const neverCalled = { execute: () => { throw new Error("the stub reads nothing"); } } as never;
    expect(await sharingPolicyAllows(neverCalled, { bookId: "b", userId: "u", actorUserId: "a" })).toBe(true);
  });

  it("orgMembershipDisabled is the org admin's switch (stream Offboarding extends it)", () => {
    expect(dialect.sqlToQuery(orgMembershipDisabled()).sql).toBe("om.disabled_at IS NOT NULL");
  });

  it("accountIsManaged is an EXISTS over the caller's column, binding nothing", () => {
    const q = dialect.sqlToQuery(accountIsManaged(sql`u.id`));
    expect(q.sql).toBe("EXISTS (SELECT 1 FROM claimnet.organization_members managed_om WHERE managed_om.user_id = u.id)");
    expect(q.params).toEqual([]);
  });
});

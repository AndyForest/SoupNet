/**
 * Verified-domain re-check (organization accounts round 1, stream Domains;
 * rubric OD-R1, OD-X1, OD-X3) — runs once a day.
 *
 * Re-checks the DNS record of every verified claim (a missing one freezes
 * automatic joining and emails the organization's managers; fourteen days of
 * failure lapses the claim), then migrates every captured claim's eligible
 * accounts, which continues a migration a request left unfinished and seats
 * accounts that waited for a seat. The published frequency is
 * DOMAIN_RECHECK_HOURS in @soupnet/domain.
 *
 * Safe if it stops: domainVerifiedFor requires a successful check within 48
 * hours, so a worker that is off (EMBEDDING_WORKER_ENABLED=false) or failing
 * freezes joins rather than trusting a stale claim.
 */
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { recheckDomains } from "../../services/org-domains.service";

export async function handleOrgDomainsRecheck(db: PostgresJsDatabase): Promise<void> {
  const { checked, events, failedChecks, migration } = await recheckDomains(db);
  if (failedChecks > 0 || migration.failed > 0 || migration.stopped) {
    console.error(
      `[org-domains] this run left work for the next one: ${failedChecks} re-check(s) failed, ${migration.failed} account(s) couldn't join${migration.stopped ? ", and a migration stopped early" : ""}`,
    );
  }
  if (checked > 0 || migration.joined > 0 || migration.awaitingSeat > 0) {
    console.warn(
      `[org-domains] re-checked ${checked} claim(s) ${JSON.stringify(events)}; migrated ${migration.joined}, ${migration.awaitingSeat} waiting for a seat`,
    );
  }
}

/**
 * Organization joins with their notice: the entry point every caller of the
 * join uses (the site operator's routes now, stream Domains' auto-join next).
 *
 * The join itself (authz/organizations.ts) records in its transaction that a
 * notice is owed. This sends it after commit through the logged sender, so
 * the outcome is an email_log row ('sent' or 'failed'), and a failure is
 * logged, never dropped. A failed send doesn't undo the join: the notice is a
 * courtesy, and the audit row is the record (rubric OC-J4). The send isn't
 * awaited, like every other mail the backend sends from a request, so a slow
 * mail server never holds the request open.
 */

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { createOrganization, joinOrganization } from "../authz";
import type { CreateOrganizationInput, CreateOrganizationResult, JoinInput, JoinResult } from "../authz";
import { sendOrganizationJoinNotice } from "./email.service";

export async function joinOrganizationAndNotify(db: PostgresJsDatabase, input: JoinInput): Promise<JoinResult> {
  const result = await joinOrganization(db, input);
  if (result.ok) notify(result);
  return result;
}

export async function createOrganizationAndNotify(db: PostgresJsDatabase, input: CreateOrganizationInput): Promise<CreateOrganizationResult> {
  const result = await createOrganization(db, input);
  if (result.ok) notify(result.join);
  return result;
}

function notify(join: Extract<JoinResult, { ok: true }>): void {
  if (!join.noticeOwed) return;
  void sendOrganizationJoinNotice(join.email, join.organizationName, join.movedBooks).catch((err) => {
    console.error("[organizations] join notice failed to send (the email_log row records it):", err);
  });
}

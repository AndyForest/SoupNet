/**
 * The caller's own account profile, for the MCP `get_profile` tool (OpenAI
 * plugin directory item 13): a client connected to more than one Soup.net
 * account tells them apart by `id`.
 *
 * `id` is the user's id: stable, never reassigned, and the same for every key
 * and OAuth grant the person holds, which a key id would not be. It is read
 * only for the principal's own user, never for an id from the request.
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export interface AccountProfile {
  id: string;
  email: string;
  displayName: string | null;
}

export async function ownAccountProfile(db: PostgresJsDatabase, userId: string): Promise<AccountProfile | null> {
  const rows = await db.execute(sql`
    SELECT id, email, display_name FROM claimnet.users WHERE id = ${userId}::uuid
  `);
  const row = (rows as unknown as Array<{ id: string; email: string; display_name: string | null }>)[0];
  return row ? { id: row.id, email: row.email, displayName: row.display_name?.trim() || null } : null;
}

/** The profile as text, for clients that read only the content block. */
export function renderAccountProfile(p: AccountProfile): string {
  return [`Account id: ${p.id}`, `Email: ${p.email}`, `Display name: ${p.displayName ?? "(none set)"}`].join("\n");
}

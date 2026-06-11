import { describe, it, expect } from "vitest";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { mayRegister } from "./system-settings.service";

/**
 * Layer 1 unit tests for the registration cap decision.
 *
 * Invite semantics (operator decision, 2026-06-11): a member invitation puts
 * the invitee at the TOP of the waitlist, it does not bypass it. The
 * invitation reserves a slot; at register time the cap IS consulted, but the
 * invitee's own pending invitation is excluded from the count so the
 * reservation doesn't block its own holder. Admin invitations (bypassCap)
 * skip the cap entirely.
 *
 * The exploding-db stub proves which branches touch the database:
 *   - bypass invite  → must NOT consult the cap (resolves true, no db access)
 *   - member invite  → MUST consult the cap (db access → stub throws)
 *   - no invite      → MUST consult the cap (db access → stub throws)
 * The live cap math (reservation exclusion, registered-email exclusion) is
 * covered by the waitlist.test.ts integration suite.
 */

function explodingDb(): PostgresJsDatabase {
  return new Proxy({} as PostgresJsDatabase, {
    get(_target, prop) {
      throw new Error(`db access (.${String(prop)})`);
    },
  });
}

describe("mayRegister", () => {
  it("admin bypass invitation registers without consulting the cap", async () => {
    await expect(
      mayRegister(explodingDb(), { id: "00000000-0000-0000-0000-000000000001", bypassCap: true }),
    ).resolves.toBe(true);
  });

  it("member invitation consults the cap (top of the waitlist, not a bypass)", async () => {
    await expect(
      mayRegister(explodingDb(), { id: "00000000-0000-0000-0000-000000000002", bypassCap: false }),
    ).rejects.toThrow(/db access/);
  });

  it("uninvited registration consults the cap", async () => {
    await expect(mayRegister(explodingDb(), null)).rejects.toThrow(/db access/);
  });
});

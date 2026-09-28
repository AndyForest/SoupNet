/**
 * Fast verified test users for integration-test setup hooks.
 *
 * Why this exists: the gate runs ~48 integration files in parallel against
 * one backend, and each used to create its users over HTTP (register →
 * verify → login). The backend hashes with bcryptjs at 12 rounds, which is
 * pure JavaScript on its single event-loop thread and costs about 190 ms per
 * hash or compare. Measured 2026-09-28: ~170 users per gate run kept the
 * backend at ~100% of one core for ~100 s, and the setup hooks that register
 * three users back to back timed out at 30 s on both baseline runs.
 *
 * `seedVerifiedUser` creates the user with the product's own `registerUser`
 * (so the personal org, Personal book, and owner membership match a real
 * signup), running in the test worker instead of the backend. It then marks
 * the account verified and ToS-accepted, as `/auth/register` + `/auth/verify`
 * would, and swaps the stored hash for a 4-round hash of the same password.
 * bcrypt reads the cost from the hash, so the HTTP login it finishes with, and
 * any later login a test makes with that password, costs the backend ~1 ms.
 *
 * Use it for setup. Tests that exercise signup, verification, the waitlist or
 * invite-on-register keep going through HTTP.
 *
 * Needs the backend's JWT_SECRET in the test env (`registerUser` signs a
 * token), plus the database env the backend uses.
 */

import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { registerUser } from "./auth";
import { getDb } from "./db";

const BASE = process.env["BACKEND_URL"] ?? "http://localhost:3101";

/** bcrypt's minimum cost. Test passwords only; never used by the product. */
const TEST_HASH_ROUNDS = 4;

/**
 * Create a verified, ToS-accepted user, then log in over HTTP. Returns the
 * `/auth/login` response, so a setup helper that used to end with that call
 * reads the token (and user) from it exactly as before.
 */
export async function seedVerifiedUser(email: string, password: string): Promise<Response> {
  const db = getDb();
  const { user } = await registerUser(db, email, password);
  const cheapHash = await bcrypt.hash(password, TEST_HASH_ROUNDS);
  await db.execute(sql`
    UPDATE claimnet.users
    SET password_hash = ${cheapHash},
        email_verified_at = now(),
        tos_accepted_at = now()
    WHERE id = ${user.id}::uuid
  `);
  return fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password }),
  });
}

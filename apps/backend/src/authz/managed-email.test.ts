import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Layer 1, static (organization accounts round 1, OC-R6; program §3.4):
// a managed account can't change its email away from its organization's
// domain. No route changes an account's email today. This fails the day one
// does, until that file is listed below, which is the moment to make the
// route ask `emailChangeAllowed` (@soupnet/domain) with the account's
// managed state (`managedOrganizationOf`) and refuse with
// MANAGED_EMAIL_CHANGE_MESSAGE.

const SRC = fileURLToPath(new URL("..", import.meta.url));

/** Files that change users.email, each with the reason it may. Empty: an
 *  address is only ever inserted, by registration (auth.ts registerUser). */
const EMAIL_WRITERS: Record<string, string> = {};

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}

describe("a managed account's email stays on its domain", () => {
  it("no file outside the register writes users.email", () => {
    // An UPDATE of claimnet.users that sets email, or a Drizzle update of
    // the users table whose set() names email.
    const sqlWrite = /UPDATE\s+claimnet\.users\s+SET[^`]*?(?<![_\w])email\s*=/i;
    const drizzleWrite = /\.update\(\s*users\s*\)\s*\.set\(\s*\{[^}]*\bemail\s*:/;
    const writers = sources(SRC)
      .filter((file) => {
        const text = readFileSync(file, "utf-8");
        return sqlWrite.test(text) || drizzleWrite.test(text);
      })
      .map((file) => relative(SRC, file).split(sep).join("/"));
    expect(writers.filter((file) => !(file in EMAIL_WRITERS))).toEqual([]);
  });

  it("the pattern catches a planted email change", () => {
    const sqlWrite = /UPDATE\s+claimnet\.users\s+SET[^`]*?(?<![_\w])email\s*=/i;
    expect(sqlWrite.test("UPDATE claimnet.users SET email = ${next} WHERE id = ${id}")).toBe(true);
    expect(sqlWrite.test("UPDATE claimnet.users SET email_verified_at = NOW() WHERE id = ${id}")).toBe(false);
  });
});

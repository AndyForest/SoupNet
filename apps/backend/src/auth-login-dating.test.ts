import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { hashPassword, loginUser } from "./auth";

/**
 * F145, F147, F166: a password login dates its session from before the read
 * that checked the password, with the cut-off that read saw. A login that won
 * the race against a reset must stay behind the reset's cut-off, so nothing
 * after the check may move the date. No database: the read moves the clock and
 * any later read finds a cut-off, the two things a slow password check allows.
 */

const START_MS = 1_000_000_000_000;
const START = START_MS / 1000;

beforeEach(() => {
  vi.stubEnv("JWT_SECRET", "a".repeat(64));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function loginDb(passwordHash: string, cutOffAtRead: Date | null) {
  let reads = 0;
  vi.useFakeTimers({ toFake: ["Date"], now: START_MS });
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            reads += 1;
            vi.setSystemTime(START_MS + 3000);
            const sessionsValidAfter = reads === 1 ? cutOffAtRead : new Date(START_MS + 8000);
            return [{ id: "00000000-0000-0000-0000-000000000000", email: "a@example.com", role: "tenant", passwordHash, waitlistedAt: null, sessionsValidAfter }];
          },
        }),
      }),
    }),
    execute: async () => [{ disabled: null, required: false }],
  } as unknown as PostgresJsDatabase;
}

async function loggedInAt(db: PostgresJsDatabase): Promise<number | undefined> {
  const result = await loginUser(db, "a@example.com", "the-password");
  return (jwt.decode(result?.token ?? "") as { iat?: number } | null)?.iat;
}

describe("loginUser's date for the session (F145, F147, F166)", () => {
  it("dates it from before the check, so a cut-off landing after the check still ends it", async () => {
    const passwordHash = await hashPassword("the-password");
    expect(await loggedInAt(loginDb(passwordHash, null))).toBe(START);
  });

  it("dates it no earlier than a cut-off its read saw, so a sign-in after a reset isn't refused", async () => {
    const passwordHash = await hashPassword("the-password");
    expect(await loggedInAt(loginDb(passwordHash, new Date(START_MS + 5000)))).toBe(START + 5);
  });
});

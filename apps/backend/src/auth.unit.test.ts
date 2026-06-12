import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { autoSetup } from "./auth";

/**
 * F49 (security-audit-2026-06-11) — unit tests for the autoSetup production
 * gate. The old gate checked env-var PRESENCE, so ALLOW_AUTO_SETUP=false
 * *enabled* auto-setup in production. The gate must be a strict === "true".
 *
 * The blocked branch returns before any database access, so a throwing stub
 * db proves the block; a counting stub proves the allowed branch proceeds.
 */

function throwingDb(): PostgresJsDatabase {
  return {
    execute: () => {
      throw new Error("autoSetup touched the database despite the production block");
    },
  } as unknown as PostgresJsDatabase;
}

function countingDb(calls: { n: number }): PostgresJsDatabase {
  return {
    execute: async () => {
      calls.n += 1;
      return [{ total: 1 }]; // non-empty users table → no user creation
    },
    // getSetting (signupCap branch) uses the drizzle select chain; return a
    // non-zero cap so autoSetup doesn't try to write one.
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [{ value: 5 }] }) }),
    }),
  } as unknown as PostgresJsDatabase;
}

describe("autoSetup production gate (F3/F49)", () => {
  const saved = {
    NODE_ENV: process.env["NODE_ENV"],
    ALLOW_AUTO_SETUP: process.env["ALLOW_AUTO_SETUP"],
    DEV_USERNAME: process.env["DEV_USERNAME"],
    DEV_PASSWORD: process.env["DEV_PASSWORD"],
    TEST_USERNAME: process.env["TEST_USERNAME"],
    TEST_PASSWORD: process.env["TEST_PASSWORD"],
  };

  beforeEach(() => {
    process.env["NODE_ENV"] = "production";
    delete process.env["ALLOW_AUTO_SETUP"];
    process.env["DEV_USERNAME"] = "dev@test.local";
    process.env["DEV_PASSWORD"] = "dev-password-123";
    delete process.env["TEST_USERNAME"];
    delete process.env["TEST_PASSWORD"];
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
    vi.restoreAllMocks();
  });

  it("blocks in production when ALLOW_AUTO_SETUP is unset", async () => {
    await expect(autoSetup(throwingDb())).resolves.toBeUndefined();
  });

  it("blocks in production when ALLOW_AUTO_SETUP=false (the F49 regression)", async () => {
    process.env["ALLOW_AUTO_SETUP"] = "false";
    await expect(autoSetup(throwingDb())).resolves.toBeUndefined();
  });

  it("blocks in production for any value other than the exact string 'true'", async () => {
    for (const value of ["1", "yes", "TRUE", "True", " true"]) {
      process.env["ALLOW_AUTO_SETUP"] = value;
      await expect(autoSetup(throwingDb())).resolves.toBeUndefined();
    }
  });

  it("proceeds in production when ALLOW_AUTO_SETUP=true", async () => {
    process.env["ALLOW_AUTO_SETUP"] = "true";
    const calls = { n: 0 };
    await autoSetup(countingDb(calls));
    expect(calls.n).toBeGreaterThan(0); // got past the gate to the count query
  });
});

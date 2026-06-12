import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePgSsl } from "./db";

// F48 (security-audit-2026-06-11): TLS config for Postgres connections.
// PGSSLMODE=require alone must not silently verify nothing without at least
// warning; PGSSLROOTCERT enables real certificate verification.
describe("resolvePgSsl (F48)", () => {
  const saved = {
    PGSSLMODE: process.env["PGSSLMODE"],
    PGSSLROOTCERT: process.env["PGSSLROOTCERT"],
  };
  let tmpDir: string;

  beforeEach(() => {
    delete process.env["PGSSLMODE"];
    delete process.env["PGSSLROOTCERT"];
    tmpDir = mkdtempSync(join(tmpdir(), "f48-"));
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns false when PGSSLMODE is not 'require'", () => {
    expect(resolvePgSsl()).toBe(false);
    process.env["PGSSLMODE"] = "disable";
    expect(resolvePgSsl()).toBe(false);
  });

  it("verifies with the CA bundle when PGSSLROOTCERT is set", () => {
    const caPath = join(tmpDir, "ca.pem");
    writeFileSync(caPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n");
    process.env["PGSSLMODE"] = "require";
    process.env["PGSSLROOTCERT"] = caPath;

    const ssl = resolvePgSsl();
    expect(ssl).not.toBe(false);
    if (ssl === false) return;
    expect(ssl.rejectUnauthorized).toBe(true);
    expect("ca" in ssl && ssl.ca).toContain("BEGIN CERTIFICATE");
  });

  it("falls back to encrypt-only WITH a warning when PGSSLROOTCERT is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env["PGSSLMODE"] = "require";

    const ssl = resolvePgSsl();
    expect(ssl).toEqual({ rejectUnauthorized: false });
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain("NOT verified");
  });

  it("throws (fails closed) when PGSSLROOTCERT points at a missing file", () => {
    process.env["PGSSLMODE"] = "require";
    process.env["PGSSLROOTCERT"] = join(tmpDir, "does-not-exist.pem");
    expect(() => resolvePgSsl()).toThrow();
  });
});

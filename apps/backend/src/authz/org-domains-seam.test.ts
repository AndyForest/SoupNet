import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Static guard for verified domains (organization accounts round 1, stream
 * Domains; rubric OD-M3). Whoever can make a domain claim count as verified
 * can move every account on that domain, with its books, into a company, so
 * the claims table has one writer (services/org-domains.service.ts) and one
 * other reader (the authz module's domain authority). Every file that names
 * the table, quoted or not, is registered here with its reason; a new
 * mention fails until someone reads it and adds it.
 */

const backendSrc = fileURLToPath(new URL("..", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") && !full.endsWith(".test.ts") ? [full] : [];
  });
}

const files = walk(backendSrc).map((f) => ({ path: relative(backendSrc, f).split(sep).join("/"), text: readFileSync(f, "utf8") }));

const TABLE = /"?\borganization_domains\b"?/g;

const REGISTER: Readonly<Record<string, string>> = {
  "authz/domain-authority.ts": "domainVerifiedFor and domainClaimCurrentFor: the only reads outside the service (OD-R6)",
  "services/org-domains.service.ts": "the one writer, and its own reads (OD-M3)",
};

export function mentionsOf(text: string): number {
  return [...text.matchAll(TABLE)].length;
}

describe("organization_domains has one writer and one other reader (OD-M3)", () => {
  it("every backend file naming the table is registered", () => {
    const naming = files.filter((f) => mentionsOf(f.text) > 0).map((f) => f.path).sort();
    expect(naming, "a file names organization_domains: read it, then register it with a reason").toEqual(Object.keys(REGISTER).sort());
  });

  it("the domain authority only reads it", () => {
    const text = files.find((f) => f.path === "authz/domain-authority.ts")!.text;
    expect(text).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b[^`]*organization_domains/i);
  });

  it("the guard sees a planted mention, quoted or not", () => {
    expect(mentionsOf("SELECT 1 FROM claimnet.organization_domains")).toBe(1);
    expect(mentionsOf('UPDATE "claimnet"."organization_domains" SET')).toBe(1);
    expect(mentionsOf("organization_domains_idx organization_domainsx")).toBe(0);
  });
});

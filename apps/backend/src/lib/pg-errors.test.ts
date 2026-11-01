import { describe, it, expect } from "vitest";
import { isUniqueViolationOn } from "./pg-errors";

const SLUG = "groups_org_slug_unique";
const violation = { code: "23505", constraint_name: SLUG };

describe("isUniqueViolationOn", () => {
  it("finds the violation on the error itself", () => {
    expect(isUniqueViolationOn(violation, SLUG)).toBe(true);
  });

  it("finds it on a wrapped driver error", () => {
    expect(isUniqueViolationOn(new Error("Failed query", { cause: violation }), SLUG)).toBe(true);
  });

  it("refuses another constraint's unique violation", () => {
    expect(isUniqueViolationOn({ code: "23505", constraint_name: "groups_one_org_default_idx" }, SLUG)).toBe(false);
  });

  it("refuses another error on the same constraint name", () => {
    expect(isUniqueViolationOn({ code: "23503", constraint_name: SLUG }, SLUG)).toBe(false);
  });

  it("refuses errors with no driver error, and non-errors", () => {
    expect(isUniqueViolationOn(new Error("connection lost"), SLUG)).toBe(false);
    expect(isUniqueViolationOn(null, SLUG)).toBe(false);
    expect(isUniqueViolationOn("23505", SLUG)).toBe(false);
  });

  it("stops at a bounded depth on a cycle", () => {
    const cycle: { cause?: unknown } = {};
    cycle.cause = cycle;
    expect(isUniqueViolationOn(cycle, SLUG)).toBe(false);
  });
});

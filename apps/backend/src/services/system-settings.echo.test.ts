import { describe, it, expect } from "vitest";
import { parseEchoSuppressOverride } from "./system-settings.service";

/**
 * Pure unit tests for the per-request echo-suppression override parser (the
 * A/B toggle). The resolver's DB-backed merge is covered by the integration
 * suite; the tri-state parsing is pure and worth locking here.
 */
describe("parseEchoSuppressOverride", () => {
  it("maps truthy synonyms to 'on'", () => {
    for (const v of ["on", "true", "1", "yes", "ON", "True", " on "]) {
      expect(parseEchoSuppressOverride(v)).toBe("on");
    }
  });

  it("maps falsy synonyms to 'off'", () => {
    for (const v of ["off", "false", "0", "no", "OFF", "False", " off "]) {
      expect(parseEchoSuppressOverride(v)).toBe("off");
    }
  });

  it("treats absent or unrecognized values as undefined (use global default)", () => {
    expect(parseEchoSuppressOverride(undefined)).toBeUndefined();
    expect(parseEchoSuppressOverride("")).toBeUndefined();
    expect(parseEchoSuppressOverride("maybe")).toBeUndefined();
  });
});

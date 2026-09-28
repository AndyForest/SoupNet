import { describe, it, expect } from "vitest";
import { signupCapLogLine } from "./system-settings.service";

/**
 * The operator's signup-cap alerts key on these log lines (a CloudWatch
 * metric filter on "[signup-cap] near" and "[signup-cap] reached" in the
 * hosted deployment; any log-based alerting works the same way). The exact
 * prefixes are the contract.
 */
describe("signupCapLogLine", () => {
  it("says nothing while the cap has plenty of room", () => {
    expect(signupCapLogLine({ used: 50, cap: 100 }, { waitlisted: false })).toBeNull();
    expect(signupCapLogLine({ used: 89, cap: 100 }, { waitlisted: false })).toBeNull();
  });

  it("warns once the cap is 90% used", () => {
    expect(signupCapLogLine({ used: 90, cap: 100 }, { waitlisted: false })).toBe("[signup-cap] near used=90 cap=100");
    // 90% of a small cap rounds up, so a cap of 5 warns at 5, not at 4.5.
    expect(signupCapLogLine({ used: 4, cap: 5 }, { waitlisted: false }), "4 of 5 is 80%").toBeNull();
    expect(signupCapLogLine({ used: 5, cap: 5 }, { waitlisted: false })).toBe("[signup-cap] near used=5 cap=5");
  });

  it("reports reached when a registration lands on the waitlist", () => {
    expect(signupCapLogLine({ used: 100, cap: 100 }, { waitlisted: true })).toBe("[signup-cap] reached used=100 cap=100");
  });

  it("reports reached when self-signups are closed (cap 0) and someone registers", () => {
    expect(signupCapLogLine({ used: 7, cap: 0 }, { waitlisted: true })).toBe("[signup-cap] reached used=7 cap=0");
    expect(signupCapLogLine({ used: 7, cap: 0 }, { waitlisted: false }), "cap 0 with no waitlisting (e.g. a verification) is not 'near'").toBeNull();
  });
});

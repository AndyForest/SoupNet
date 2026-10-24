import { describe, it, expect } from "vitest";
import { shortIntentId, lineageLabel } from "./intent-link.js";

describe("shortIntentId", () => {
  it("keeps int_ and the first eight characters", () => {
    expect(shortIntentId("int_vc465vtmHo1AwpjPBGwQ3lSS")).toBe("int_vc465vtm…");
  });
  it("leaves anything else as it is", () => {
    expect(shortIntentId("abc")).toBe("abc");
    expect(shortIntentId("int_short")).toBe("int_short");
  });
});

describe("lineageLabel", () => {
  it("names each entry type", () => {
    expect(lineageLabel("shown")).toBe("Recipe shown");
    expect(lineageLabel("feedback")).toBe("Feedback");
    expect(lineageLabel("deposit", null)).toBe("Recipe deposited");
    expect(lineageLabel("deposit", "verified")).toBe("Recipe deposited");
    expect(lineageLabel("deposit", "unverified")).toBe("Draft deposited");
  });
});

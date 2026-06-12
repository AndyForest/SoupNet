import { describe, expect, it } from "vitest";
import { sesHeaders } from "./email.service";

describe("sesHeaders (SES configuration-set tagging)", () => {
  it("returns the X-SES-CONFIGURATION-SET header when a set name is configured", () => {
    expect(sesHeaders("soupnet-dev-transactional")).toEqual({
      "X-SES-CONFIGURATION-SET": "soupnet-dev-transactional",
    });
  });

  it("returns no headers when unset — local Mailpit and self-hosters without SES", () => {
    expect(sesHeaders(undefined)).toEqual({});
    expect(sesHeaders("")).toEqual({});
  });
});

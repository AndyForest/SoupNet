import { describe, it, expect } from "vitest";
import { consentIdentityCopy } from "./consent-identity";

const whole = (c: { lead: string; detail: string; closing: string }) => `${c.lead} ${c.detail} ${c.closing}`;

describe("consentIdentityCopy on an http loopback redirect (F129)", () => {
  const loopbacks = ["http://127.0.0.1:57687/callback", "http://127.0.0.1/callback", "http://localhost:57687/callback", "http://[::1]:57687/callback"];

  it.each(loopbacks)("doesn't vouch for a metadata-document client on %s", (uri) => {
    const copy = consentIdentityCopy("chatgpt.com", uri);
    expect(whole(copy)).not.toContain("Published by");
    expect(copy.lead).toBe("This sign-in finishes in an app on this computer.");
    expect(copy.detail).toContain("comes from a document on chatgpt.com");
    expect(copy.detail).toContain("can't confirm which app");
  });

  it.each(loopbacks)("keeps Unverified app for a dynamically registered client on %s", (uri) => {
    const copy = consentIdentityCopy(null, uri);
    expect(copy.lead).toBe("Unverified app.");
    expect(copy.detail).toContain("self-reported");
    expect(copy.detail).toContain("finishes in an app on this computer");
    expect(copy.detail).toContain("can't confirm which one");
  });

  it.each([["chatgpt.com"], [null]])("warns against copying the next page's address (domain %s)", (domain) => {
    const { closing } = consentIdentityCopy(domain, "http://127.0.0.1:57687/callback");
    expect(closing).toContain("Continue only if you just started this yourself.");
    expect(closing).toContain("Never copy the address of the next page into anything");
  });
});

describe("consentIdentityCopy on any other redirect stays as it was", () => {
  it("names the publisher of a metadata-document client", () => {
    expect(consentIdentityCopy("chatgpt.com", "https://chatgpt.com/connector_platform_oauth_redirect")).toEqual({
      lead: "Published by chatgpt.com.",
      detail: "The name above comes from a document on chatgpt.com. After you authorize (or cancel), your browser will be sent to:",
      closing: "Only continue if you started this connection yourself from that app.",
    });
  });

  it("calls a dynamically registered client unverified", () => {
    expect(consentIdentityCopy(null, "https://claude.ai/api/mcp/auth_callback")).toEqual({
      lead: "Unverified app.",
      detail: "The name above is self-reported by the connector, not verified by Soup.net. After you authorize (or cancel), your browser will be sent to:",
      closing: "Only continue if you started this connection yourself from that app.",
    });
  });

  it("treats https on a loopback host as an ordinary redirect", () => {
    expect(consentIdentityCopy("example.com", "https://127.0.0.1:8443/cb").lead).toBe("Published by example.com.");
  });
});

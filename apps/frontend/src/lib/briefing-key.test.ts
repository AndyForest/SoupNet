import { describe, it, expect } from "vitest";
import { BRIEFING_KEY_PLACEHOLDER, substituteBriefingKey } from "./briefing-key";

/**
 * The copy-briefing invariant, frontend half: the backend serves briefings
 * with only the placeholder (its integration tests assert no raw key in any
 * briefing response); this helper is what makes the HUMAN-pasted artifact
 * carry a real key again, so the pasted-briefing UX for web-only agents is
 * unchanged. If the placeholder literal ever drifts from the domain
 * template's BRIEFING_KEY_PLACEHOLDER, these tests plus the backend's
 * placeholder-presence assertions fail together.
 */

const FAKE_KEY = "cn_d_FAKEKEYFORTESTSONLY0000000000";

describe("substituteBriefingKey", () => {
  it("pins the exact placeholder literal the backend renders", () => {
    expect(BRIEFING_KEY_PLACEHOLDER).toBe("YOUR_API_KEY");
  });

  it("composes an artifact that carries the raw key everywhere the placeholder appeared", () => {
    const briefing = [
      "## Your API key",
      "YOUR_API_KEY",
      "",
      "Setup: https://mcp.example.test/check?key=YOUR_API_KEY",
      'headers: { "Authorization": "Bearer YOUR_API_KEY" }',
      "Docs: https://mcp.example.test/docs/mcp-setup?key=YOUR_API_KEY",
    ].join("\n");

    const composed = substituteBriefingKey(briefing, FAKE_KEY);

    expect(composed).not.toContain(BRIEFING_KEY_PLACEHOLDER);
    expect(composed).toContain(`\n${FAKE_KEY}\n`);
    expect(composed).toContain(`?key=${FAKE_KEY}`);
    expect(composed).toContain(`Bearer ${FAKE_KEY}`);
    // Every placeholder occurrence was substituted, none skipped.
    expect(composed.split(FAKE_KEY).length - 1).toBe(4);
  });

  it("leaves text without placeholders untouched (OAuth-mode briefings)", () => {
    const oauthBriefing = "## Your connection\nYou're connected via OAuth.";
    expect(substituteBriefingKey(oauthBriefing, FAKE_KEY)).toBe(oauthBriefing);
  });
});

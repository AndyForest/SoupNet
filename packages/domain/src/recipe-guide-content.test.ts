import { describe, it, expect } from "vitest";
import { BRIEFING, buildCorpusContextSection } from "./recipe-guide-content";
import type { BriefingBuildInput, BriefingGroup } from "./recipe-guide-content";

/**
 * Briefing template tests — the OAuth-connection branch.
 *
 * An OAuth access token (api_keys.key_type = 'oauth') expires within the hour
 * and is refreshed automatically by the connecting client. Rendering it in the
 * "## Your API key" section (or embedding it as ?key= in setup URLs) is false
 * and alarming — a claude.ai agent warned its user about a "leaked key"
 * (2026-07-06). These tests pin the two contracts:
 *   1. oauthConnection: true → NO raw credential, NO key-embedded URL, even
 *      when the caller (wrongly) passes the raw token as apiKey.
 *   2. non-OAuth (flag omitted or false) → byte-identical legacy output with
 *      the pasteable key stated plainly and embedded in every URL.
 */

const FAKE_KEY = "cn_s_FAKEKEYFORTESTSONLY0000000000";
const BACKEND = "https://mcp.example.test";
const FRONTEND = "https://www.example.test";

const groups: BriefingGroup[] = [
  {
    slug: "personal",
    name: "Personal",
    description: "Catch-all personal book",
    canWrite: true,
    isDefault: true,
  },
  {
    slug: "project-x",
    name: "Project X",
    description: "Shared project book",
    canWrite: false,
    isDefault: false,
    members: [
      { email: "a@example.test", displayName: "A" },
      { email: "b@example.test", displayName: null },
    ],
  },
];

function buildInput(overrides: Partial<BriefingBuildInput> = {}): BriefingBuildInput {
  return {
    user: { displayName: "Test User", email: "user@example.test" },
    apiKey: FAKE_KEY,
    backendUrl: BACKEND,
    frontendUrl: FRONTEND,
    checkUrl: `${BACKEND}/check?key=${FAKE_KEY}`,
    groups,
    exemplarsSection: "## Context from all your recipe books\n\n(exemplars)",
    ...overrides,
  };
}

describe("BRIEFING.build — non-OAuth (daily/scoped) keys", () => {
  it("states the pasteable key plainly and embeds it in setup URLs", () => {
    const text = BRIEFING.build(buildInput());
    expect(text).toContain("## Your API key");
    expect(text).toContain(`\n${FAKE_KEY}\n`);
    expect(text).toContain(`?key=${FAKE_KEY}`);
    expect(text).toContain(`Bearer ${FAKE_KEY}`);
    expect(text).toContain("## Setup — MCP-capable agents");
    expect(text).toContain("## Setup — web-only agents");
    expect(text).toContain("## Formatting recipe-check links — for web agents that hand URLs back to the user");
    expect(text).not.toContain("## Your connection");
  });

  it("is byte-identical whether oauthConnection is omitted or false", () => {
    const omitted = BRIEFING.build(buildInput());
    const explicitFalse = BRIEFING.build(buildInput({ oauthConnection: false }));
    expect(explicitFalse).toBe(omitted);
  });
});

describe("BRIEFING.build — OAuth connections", () => {
  // Deliberately pass the raw token as apiKey: the template branch itself must
  // guarantee the credential never renders, independent of the caller's
  // defense-in-depth (composeBriefing additionally passes apiKey: "" and a
  // keyless checkUrl for oauth keys).
  const oauthText = BRIEFING.build(buildInput({ oauthConnection: true }));

  it("renders no raw credential and no key-embedded URL", () => {
    expect(oauthText).not.toContain(FAKE_KEY);
    expect(oauthText).not.toContain("cn_s_");
    expect(oauthText).not.toContain("cn_d_");
    expect(oauthText).not.toContain("?key=");
    expect(oauthText).not.toContain("&key=");
  });

  it("replaces the key section with a truthful OAuth connection note", () => {
    expect(oauthText).toContain("## Your connection");
    expect(oauthText).not.toContain("## Your API key");
    expect(oauthText).toContain("connected via OAuth");
    expect(oauthText).toContain("refreshes automatically");
    expect(oauthText).toContain("no key to copy, paste, or protect");
  });

  it("replaces the MCP setup section with an already-connected line", () => {
    expect(oauthText).toContain("## Setup — MCP-capable agents");
    expect(oauthText).toContain("You're already connected");
    expect(oauthText).toContain(`${FRONTEND}/info/connect`);
    // The per-client config snippets are gone.
    expect(oauthText).not.toContain("bearer_token_env_var");
    expect(oauthText).not.toContain("mcpServers");
    expect(oauthText).not.toContain("claude mcp add");
  });

  it("replaces the web-only setup with a keyless note pointing the human at the frontend", () => {
    expect(oauthText).toContain("## Setup — web-only agents");
    expect(oauthText).toContain("mint a pasteable API key");
    expect(oauthText).toContain(FRONTEND);
    expect(oauthText).not.toContain("URL_ENCODED_RECIPE");
  });

  it("keeps the link-formatting heading (divergent-checks cross-reference) but drops the key-URL example", () => {
    expect(oauthText).toContain("## Formatting recipe-check links — for web agents that hand URLs back to the user");
    expect(oauthText).toContain("Not applicable to this OAuth connection");
    expect(oauthText).not.toContain("[Check this recipe](");
    // The divergent-checks pointer it anchors still exists.
    expect(oauthText).toContain("see the link-formatting guidance below");
  });

  it("keeps the credential-free sections intact (principles, format, feedback, corpus)", () => {
    for (const heading of [
      "## Principles",
      "## When to check",
      "## Recipe format",
      "## How to check",
      "## Closing the loop — feedback",
      "## Annotating creative output",
      "## Divergent recipe checks",
      "## When the user copies JSON results back",
    ]) {
      expect(oauthText).toContain(heading);
    }
  });
});

describe("buildCorpusContextSection", () => {
  it("takes no credential input and renders none (list_my_recipe_books surface)", () => {
    const text = buildCorpusContextSection({
      user: { displayName: "Test User", email: "user@example.test" },
      groups,
      exemplarsSection: "## Context from all your recipe books\n\n(exemplars)",
    });
    expect(text).not.toContain("?key=");
    expect(text).not.toContain("cn_s_");
    expect(text).not.toContain("cn_d_");
    expect(text).toContain("## Your recipe books");
  });
});

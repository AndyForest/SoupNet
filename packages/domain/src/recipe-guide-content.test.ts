import { describe, it, expect } from "vitest";
import { BRIEFING, BRIEFING_KEY_PLACEHOLDER, buildCorpusContextSection } from "./recipe-guide-content";
import type { BriefingBuildInput, BriefingGroup } from "./recipe-guide-content";

/**
 * Briefing template tests — the no-raw-credential invariant.
 *
 * BRIEFING.build takes NO key input: a raw credential physically cannot
 * appear in composed output. Two modes exist:
 *   1. Placeholder mode (every non-OAuth composition): the literal
 *      BRIEFING_KEY_PLACEHOLDER renders wherever a key belongs. Every Bearer
 *      consumer already holds the real key (they authenticated with it);
 *      the human copy-briefing flow substitutes the placeholder client-side
 *      (apps/frontend/src/lib/briefing-key.ts — the literals must match).
 *   2. OAuth mode: credential-free connection notes — no placeholder-in-URL
 *      sections at all, because a 1h access token is not a pasteable key
 *      (a claude.ai agent warned its user about a "leaked key" when the raw
 *      token rendered here, 2026-07-06).
 */

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
    backendUrl: BACKEND,
    frontendUrl: FRONTEND,
    groups,
    exemplarsSection: "## Context from all your recipe books\n\n(exemplars)",
    ...overrides,
  };
}

/** A raw key can only look like cn_d_/cn_s_ + base62 — assert none renders. */
function expectNoRawKey(text: string) {
  expect(text).not.toMatch(/cn_[sd]_[A-Za-z0-9]+/);
}

describe("BRIEFING.build — placeholder mode (daily/scoped keys)", () => {
  const text = BRIEFING.build(buildInput());

  it("renders the literal placeholder in the key section and every key-bearing URL/config", () => {
    expect(text).toContain("## Your API key");
    expect(text).toContain(`\n${BRIEFING_KEY_PLACEHOLDER}\n`);
    expect(text).toContain(`/check?key=${BRIEFING_KEY_PLACEHOLDER}`);
    expect(text).toContain(`/docs/recipe-check-guide?key=${BRIEFING_KEY_PLACEHOLDER}`);
    expect(text).toContain(`/docs/mcp-setup?key=${BRIEFING_KEY_PLACEHOLDER}`);
    expect(text).toContain(`Bearer ${BRIEFING_KEY_PLACEHOLDER}`);
    expect(text).toContain(`SOUPNET_API_KEY=${BRIEFING_KEY_PLACEHOLDER}`);
    expect(text).not.toContain("## Your connection");
  });

  it("never renders anything shaped like a raw key", () => {
    expectNoRawKey(text);
  });

  it("explains both artifact states truthfully (pre- and post-substitution)", () => {
    // Pre-substitution reader (Bearer agent, incl. stdio-proxy consumers):
    expect(text).toContain("the same Bearer token this briefing was fetched with");
    // Post-substitution reader (human-pasted artifact):
    expect(text).toContain("it was filled in for you");
  });

  it("keeps prose free of the placeholder literal outside key positions, so replaceAll cannot mangle a sentence", () => {
    // Every occurrence must sit in a key position: directly after "?key=",
    // "Bearer ", "SOUPNET_API_KEY=", or at the start of a line (the key
    // section's value line). Prose like "substitute YOUR_API_KEY here" would
    // get a raw key spliced mid-sentence by the frontend's replaceAll.
    const allowedBefore = ["?key=", "Bearer ", "SOUPNET_API_KEY=", "\n"];
    let idx = text.indexOf(BRIEFING_KEY_PLACEHOLDER);
    expect(idx).toBeGreaterThan(-1);
    while (idx !== -1) {
      const ok = allowedBefore.some((prefix) => text.slice(Math.max(0, idx - prefix.length), idx) === prefix);
      expect(ok, `placeholder at index ${idx} preceded by ${JSON.stringify(text.slice(Math.max(0, idx - 20), idx))}`).toBe(true);
      idx = text.indexOf(BRIEFING_KEY_PLACEHOLDER, idx + 1);
    }
  });

  it("is byte-identical whether oauthConnection is omitted or false", () => {
    const explicitFalse = BRIEFING.build(buildInput({ oauthConnection: false }));
    expect(explicitFalse).toBe(text);
  });
});

describe("BRIEFING.build — OAuth connections", () => {
  const oauthText = BRIEFING.build(buildInput({ oauthConnection: true }));

  it("renders no raw credential and no key-embedded URL", () => {
    expectNoRawKey(oauthText);
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
    expectNoRawKey(text);
    expect(text).not.toContain("?key=");
    expect(text).toContain("## Your recipe books");
  });
});

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

/** Thin-profile input: mcp surface, no exemplars section (the server skips
 *  exemplar fetching entirely at the MCP default k=0). Omission — not an
 *  explicit undefined — because exactOptionalPropertyTypes distinguishes them. */
function thinInput(overrides: Partial<BriefingBuildInput> = {}): BriefingBuildInput {
  const { exemplarsSection: _omit, ...base } = buildInput();
  return { ...base, surface: "mcp", ...overrides };
}

describe("BRIEFING.build — surface profiles (cold-start v2 Phase B)", () => {
  const fullText = BRIEFING.build(buildInput());
  const mcpText = BRIEFING.build(thinInput());

  it("full profile is byte-identical whether surface is omitted or 'full'", () => {
    expect(BRIEFING.build(buildInput({ surface: "full" }))).toBe(fullText);
  });

  it("mcp profile drops the setup cluster, link formatting, and pasted-JSON sections", () => {
    for (const heading of [
      "## Setup — MCP-capable agents",
      "## Setup — web-only agents",
      "## Formatting recipe-check links",
      "## When the user copies JSON results back",
    ]) {
      expect(mcpText).not.toContain(heading);
      expect(fullText).toContain(heading); // the guard proving full keeps them
    }
    // Setup payloads gone with their headings.
    expect(mcpText).not.toContain("bearer_token_env_var");
    expect(mcpText).not.toContain("URL_ENCODED_RECIPE");
    expect(mcpText).not.toContain("fenced code block with the");
  });

  it("mcp profile keeps the norms: principles, format, when/how-to-check, feedback, divergence", () => {
    for (const heading of [
      "## Principles",
      "## When to check",
      "## Recipe format",
      "## Your user",
      "## Your recipe books",
      "## How to check",
      "## Closing the loop — feedback",
      "## Annotating creative output",
      "## Divergent recipe checks",
    ]) {
      expect(mcpText).toContain(heading);
    }
    // The divergent section keeps the MCP guidance but drops the web-only
    // link-emission paragraph (its cross-reference target is gone).
    expect(mcpText).toContain("MCP-capable agents: present the options as text");
    expect(mcpText).not.toContain("see the link-formatting guidance below");
  });

  it("mcp profile shrinks the key section to a truthful note, placeholder in key position", () => {
    expect(mcpText).toContain("## Your API key");
    expect(mcpText).toContain(`\n${BRIEFING_KEY_PLACEHOLDER}\n`);
    expect(mcpText).toContain("this session's tools already authenticate with");
    expect(mcpText).toContain(`${FRONTEND}/info/connect`);
    expectNoRawKey(mcpText);
  });

  it("mcp + OAuth composes: connection note wins the key section, setup still dropped", () => {
    const text = BRIEFING.build(thinInput({ oauthConnection: true }));
    expect(text).toContain("## Your connection");
    expect(text).not.toContain("## Your API key");
    expect(text).not.toContain("## Setup — MCP-capable agents");
    expectNoRawKey(text);
  });

  it("holds the thin briefing under its size ceiling (fixed fixture, no exemplars)", () => {
    // The point of the profile: the always-pushed layer stays an index.
    // Fixture floor measured ~16.5KB at introduction; ceiling leaves modest
    // headroom — growth past it should be a deliberate, dated raise, exactly
    // like the tool-description budget.
    expect(mcpText.length).toBeLessThanOrEqual(18_000);
    expect(mcpText.length).toBeLessThan(fullText.length);
  });

  it("renders per-book index stats when provided, and none otherwise", () => {
    const statGroups: BriefingGroup[] = [
      {
        ...groups[0]!,
        stats: {
          recipeCount: 128,
          newestJudgment: "2026-08-21",
          lastLogged: "2026-08-22",
          authorCount: 2,
          feedbackCount: 12,
          feedbackFulfilled: 9,
          reactionsStillTrue: 3,
          reactionsStale: 1,
        },
      },
      groups[1]!,
    ];
    const text = BRIEFING.build(thinInput({ groups: statGroups }));
    expect(text).toContain("    Index: 128 recipes · newest judgment 2026-08-21 · last logged 2026-08-22 · 2 authors · 12 feedback rows (9 fulfilled) · reactions: 3 still-true / 1 stale");
    // The stat-less book renders exactly as before — no Index line.
    const projectLine = text.split("\n").find((l) => l.includes("project-x"));
    expect(projectLine).toBeTruthy();
    expect(mcpText).not.toContain("    Index: ");
  });

  it("omits zero-value stat parts and singularizes counts", () => {
    const statGroups: BriefingGroup[] = [
      { ...groups[0]!, stats: { recipeCount: 1, authorCount: 1, newestJudgment: "2026-08-23", lastLogged: "2026-08-23" } },
    ];
    const text = BRIEFING.build(thinInput({ groups: statGroups }));
    // Same-day lastLogged collapses; solo author and zero feedback add
    // nothing — the whole line is exactly the two surviving parts.
    const indexLine = text.split("\n").find((l) => l.startsWith("    Index: "));
    expect(indexLine).toBe("    Index: 1 recipe · newest judgment 2026-08-23");
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

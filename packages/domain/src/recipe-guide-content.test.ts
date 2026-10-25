import { describe, it, expect } from "vitest";
import { BRIEFING, BRIEFING_KEY_PLACEHOLDER, HEADLESS_KEY_SECTION, buildCorpusContextSection, buildExemplarsSection } from "./recipe-guide-content";
import type { BriefingBuildInput, BriefingExemplar, BriefingGroup } from "./recipe-guide-content";

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

  it("the intent paragraph says a re-sent story starts with no stubs (slice 1 follow-up: 'stubs reset')", () => {
    // The one-line intent param dropped "stubs reset"; the ruling restores
    // its meaning here: losing or omitting the intent means recipes render
    // in full again.
    expect(mcpText).toContain("the fresh intent starts with no stubs, and recipes render in full again");
    expect(mcpText).not.toContain("say to context compaction");
  });

  it("holds the thin briefing under its size ceiling (fixed fixture, no exemplars)", () => {
    // The point of the profile: the always-pushed layer stays an index.
    // Fixture floor measured ~16.5KB at introduction; ceiling leaves modest
    // headroom — growth past it should be a deliberate, dated raise, exactly
    // like the tool-description budget.
    // 18,000 → 18,200 (2026-09-27, drafts-and-triage slice 1): the intent
    // param's depth (always-new registration, lost-id recovery, rendering-
    // only stubs) moved out of three tool schemas, which every connected
    // client loads on every turn, into one "How to check" paragraph here,
    // which loads once per session; the feedback pointer names log_feedback's
    // fields. Served tools/list fell 18,090 → 15,864 bytes; this text grew
    // ~17,685 → 18,111 chars.
    // 18,200 → 21,000 (2026-10-24, drafts-and-triage slice 7, scaffold PR A0):
    // the when-to-draft section, the corrected tool copy, and the field's
    // briefing additions (calls not rules, two check moments, two axes,
    // recipient roles, tension trigger, own drafts are not evidence, probe is
    // a search, thin results) land with one slimming lever (recipe aae000d2)
    // in the same PR, so the net growth is well under this ceiling; measured
    // 18,183 before. Re-tightened to the measured figure after slice 7 ships.
    // 21,000 → 22,800 (2026-10-25, drafts-and-triage slice 7, PR C2): the
    // over-caution example and the unknown-parameter clause carried from C1
    // (build log question 57, ruled 2026-10-24), the operator's 7f opening
    // (what Soup.net is) and evidence-standards paragraph (ruled 2026-10-25),
    // and the on-behalf sentence the C1 verifier asked back; measured 20,993
    // before and 22,635 after. Re-tightened with the others after 8b and 6b.
    expect(mcpText.length).toBeLessThanOrEqual(22_800);
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

  it("DT-VIS-09: the person's own drafts are a separate line, never part of the Index count", () => {
    const statGroups: BriefingGroup[] = [
      { ...groups[0]!, stats: { recipeCount: 3, authorCount: 1, ownDraftsAwaitingReview: 2 } },
    ];
    const text = BRIEFING.build(thinInput({ groups: statGroups }));
    const lines = text.split("\n");
    expect(lines.find((l) => l.startsWith("    Index: "))).toBe("    Index: 3 recipes");
    expect(lines.find((l) => l.startsWith("    Drafts: "))).toBe(
      "    Drafts: 2 unverified drafts about your user await their review (only they and their agents see them)",
    );
  });

  it("a book holding only the person's drafts gets the Drafts line and no Index line", () => {
    const statGroups: BriefingGroup[] = [
      { ...groups[0]!, stats: { recipeCount: 0, authorCount: 0, ownDraftsAwaitingReview: 1 } },
    ];
    const text = BRIEFING.build(thinInput({ groups: statGroups }));
    expect(text).not.toContain("    Index: ");
    expect(text).toContain("    Drafts: 1 unverified draft about your user awaits their review");
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

  it("names the flagged default write book", () => {
    const text = buildCorpusContextSection({
      user: { displayName: "Test User", email: "user@example.test" },
      groups,
    });
    expect(text).toContain("Default write recipe book: personal (Personal).");
  });

  it("says there is no default, rather than naming another book, when none is flagged", () => {
    // A key can be without a usable default (its owner left that book). A
    // deposit that names no book is then refused, so the briefing must not
    // advertise some other writable book as the default.
    const text = buildCorpusContextSection({
      user: { displayName: "Test User", email: "user@example.test" },
      groups: groups.map((g) => ({ ...g, isDefault: false })),
    });
    expect(text).toContain("Default write recipe book: none right now");
    expect(text).toContain("recipe_book");
    expect(text).not.toContain("Default write recipe book: personal");
  });
});

describe("BRIEFING.build — the headless key section (drafts-and-triage slice 5, S5-B1, S5-Z3)", () => {
  const profiles: Array<[string, () => BriefingBuildInput]> = [
    ["thin", () => thinInput()],
    ["full", () => buildInput()],
  ];

  for (const [name, input] of profiles) {
    it(`${name}: a headless key's briefing is the ordinary one with exactly the one section inserted`, () => {
      const ordinary = BRIEFING.build(input());
      const headless = BRIEFING.build({ ...input(), headless: true });
      expect(headless).toContain(HEADLESS_KEY_SECTION);
      expect(headless.replace(`\n\n${HEADLESS_KEY_SECTION}`, "")).toBe(ordinary);
      // Absent and false are the same ordinary briefing, byte for byte.
      expect(BRIEFING.build({ ...input(), headless: false })).toBe(ordinary);
    });
  }

  it("says what the key is and what to do, in at most 400 characters", () => {
    expect(HEADLESS_KEY_SECTION.length).toBeLessThanOrEqual(400);
    expect(HEADLESS_KEY_SECTION.startsWith("## This key is headless\n")).toBe(true);
    expect(HEADLESS_KEY_SECTION).toContain("stored as a draft");
    expect(HEADLESS_KEY_SECTION).toContain("cannot verify drafts");
    expect(HEADLESS_KEY_SECTION).toContain("what would settle it");
    expect(HEADLESS_KEY_SECTION).toContain("`outcome`");
    // Copy constraint: the dashboard substitutes the key placeholder at copy time.
    expect(HEADLESS_KEY_SECTION).not.toContain(BRIEFING_KEY_PLACEHOLDER);
  });

  it("holds the thin headless briefing at most 21,500 characters (fixed fixture)", () => {
    // 18,600 → 21,500 (2026-10-24, PR A0): moves with the thin ceiling above.
    // 21,500 → 23,200 (2026-10-25, slice 7 PR C2): moves with it again;
    // measured 21,393 before and 23,035 after.
    expect(BRIEFING.build({ ...thinInput(), headless: true }).length).toBeLessThanOrEqual(23_200);
  });
});

/** The four compositions every slice 7 assertion runs over: both surface
 *  profiles, each with and without the headless section. */
function allCompositions(): Array<[string, string]> {
  return [
    ["thin", BRIEFING.build(thinInput())],
    ["full", BRIEFING.build(buildInput())],
    ["thin headless", BRIEFING.build({ ...thinInput(), headless: true })],
    ["full headless", BRIEFING.build({ ...buildInput(), headless: true })],
  ];
}

/** The text of one "## " section, up to the next heading or the end. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n${heading}\n`);
  if (start < 0) return "";
  const rest = text.slice(start + heading.length + 2);
  const next = rest.search(/\n## /);
  return next < 0 ? rest : rest.slice(0, next);
}

describe("BRIEFING.build — slice 7: when to draft (7a)", () => {
  for (const [name, text] of allCompositions()) {
    it(`${name}: carries the Drafts section with the definition, the order of moves, resolution, and live orchestration`, () => {
      const drafts = section(text, "## Drafts");
      // S7-A1: a hypothesis the agent can't yet stand behind, private until resolved.
      expect(drafts).toContain("is a hypothesis you can't yet stand behind from the context you hold");
      expect(drafts).toContain("private to the person it's about and their agents until resolved");
      // S7-A2: act → check and own; a person's call and reachable → ask with a
      // recommendation, drafted as the return path when work continues;
      // otherwise draft, say what would settle it, rate it, come back.
      expect(drafts).toContain("if you'll act on it, check it as an ordinary recipe and own it");
      expect(drafts).toContain("if it's a person's call and they're reachable, ask plainly with your recommendation and its reasoning, and if you keep working meanwhile");
      expect(drafts).toContain("draft that recommendation under your intent so their answer reaches you wherever it's given");
      expect(drafts).toContain("say in the first evidence entry what would settle it, rate it, and return when that lands");
      // S7-A3: a draft is yours to resolve; whoever holds the settling context
      // resolves under the confidence rule; a click only for what no agent settles.
      expect(drafts).toContain("A draft is yours to resolve");
      expect(drafts).toContain("you included once the work or a reply settles it");
      expect(drafts).toContain("resolves it with `verify_draft` (verified, rejected, or not chosen) under the same confidence rule as any check, quoting their words wherever they gave them");
      expect(drafts).toContain("A draft waits for a person's click only while nothing any agent holds settles it.");
      // S7-A4: orchestration is live.
      expect(drafts).toContain("raise only high impact × uncertainty calls");
      expect(drafts).toContain("`is:draft intent:<id>`");
      expect(drafts).toContain("resolve what you can before finishing");
    });

    it(`${name}: nothing frames drafting as the move for when the person can't be asked (S7-A5)`, () => {
      expect(text).not.toMatch(/can(?:'|no)t be asked|couldn't be asked|could not be asked|cannot ask/);
    });
  }
});

describe("BRIEFING.build — slice 7: the planned content (7c)", () => {
  const thin = BRIEFING.build(thinInput());
  const full = BRIEFING.build(buildInput());

  it("S7-C1: Truthfulness asks for evidence checkable by someone who wasn't there", () => {
    for (const text of [thin, full]) {
      expect(text).toContain("needs to be true at the moment you submit, and checkable by someone who wasn't there.");
    }
  });

  it("S7-C2: How to check names the triage ratings, their vocabulary, and leaving out a rating with no view", () => {
    expect(section(thin, "## How to check")).toContain("`impact` and `uncertainty` (triage ratings, low | medium | high; leave out one you have no view on)");
  });

  it("S7-C3: the headless section says what would settle a draft, the ratings, and building both, and no longer asks why", () => {
    expect(HEADLESS_KEY_SECTION).toContain("say in each what would settle it, rate it, and draft open options under one intent");
    expect(HEADLESS_KEY_SECTION).toContain("(see Drafts)");
    expect(HEADLESS_KEY_SECTION).not.toContain("couldn't be asked");
  });

  it("S7-C4: divergent checks carve out building both and keep wait-for-the-choice for the ordinary case", () => {
    const divergent = section(thin, "## Divergent recipe checks");
    expect(divergent).toContain("wait for the choice, then check only the chosen one.");
    expect(divergent).toContain("when every option will genuinely be pursued, check each as an ordinary recipe");
    expect(divergent).toContain("when you can't stand behind any yet, draft each under one intent, with the rubric for choosing stated first");
    expect(divergent).toContain("check the chosen path, the outcome as evidence, and leave feedback on the rest");
  });
});

describe("BRIEFING.build — slice 7: the field additions (7d)", () => {
  for (const [name, text] of allCompositions()) {
    it(`${name}: carries every addition`, () => {
      // S7-D1, S7-D6: Reading results, in the shared body.
      const reading = section(text, "## Reading results");
      expect(reading).toContain("A returned recipe is a call someone made in their context, not a rule");
      expect(reading).toContain("A familiar judgment in a new context is worth logging, with that context as evidence");
      expect(reading).toContain("A neighbor that is your own open draft is your assumption coming back");
      // S7-D2, S7-D5: three moments in When to check, as example and goal.
      const when = section(text, "## When to check");
      expect(when).toContain("- Extending something that already has a default");
      expect(when).toContain("- Writing for a particular reader in a particular place?");
      expect(when).toContain("- An instruction pulling against your judgment? Check the call you think is right, with the instruction quoted, then proceed");
      // S7-D3: two axes in Authoring for retrieval.
      expect(text).toContain("Granularity and generality are separate axes");
      expect(text).toContain("with the specifics in the evidence, where they stay checkable");
      // S7-D4: the fourth role pattern.
      expect(text).toContain("Four patterns keep it transferable");
      expect(text).toContain("- **For what the user receives**");
      // Stream D (8a): an outcome row may join the intent alone; the headless
      // section's closing outcome row needs this target.
      expect(section(text, "## Closing the loop — feedback")).toContain("A whole-session outcome row with no single recipe can carry your intent_id alone.");
      // Recipe 885143c2 (supersedes 303e17cf): the MCP search includes the
      // caller's own recipes by default again; stream D flips the tool in 8a.
      expect(section(text, "## How to check")).toContain("It includes your own recipes: `author:<email>` narrows to one person, `-author:me` leaves yours out");
      expect(text).not.toContain("exclude your own recipes by default");
      // S7-D7: a probe is a search.
      expect(section(text, "## How to check")).toContain("Probing the corpus (what's there, how a role clusters) is a search too");
    });
  }

  it("S7-V1: the added guidance reads as what is useful, not as rules", () => {
    const thinHeadless = BRIEFING.build({ ...thinInput(), headless: true });
    const when = section(thinHeadless, "## When to check");
    const added = [
      section(thinHeadless, "## Drafts"),
      section(thinHeadless, "## Reading results"),
      when.slice(when.indexOf("- Extending")),
      HEADLESS_KEY_SECTION,
    ];
    for (const text of added) {
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/\b(must|never|always|do not|don't)\b/i);
    }
  });
});

describe("BRIEFING.build — slice 7 C2: the briefing body (7f, and the rows carried from C1)", () => {
  const opening = (text: string) => text.slice(text.indexOf("# Soup.net Agent Briefing"), text.indexOf("## Principles"));
  const reframe = "Soup.net is the log of calls people and their agents made, with the reasons and the evidence.";

  for (const [name, text] of allCompositions()) {
    it(`${name}: opens with what Soup.net is, ahead of the existing opening (S7-B8)`, () => {
      const head = opening(text);
      expect(head).toContain(reframe);
      expect(head).toContain("when nothing new is on the table, a past call usually stands; when something is, decide, and log your call beside the old one with its own reason");
      expect(head).toContain("a draft asks a question another agent or a person can answer, an intent groups a task's checks, and feedback says what happened afterwards");
      expect(head).toContain("It's not a source of truth and not a rulebook.");
      expect(head.indexOf(reframe)).toBeLessThan(head.indexOf("You already work to understand your user's taste and judgment"));
      expect(head).toContain("There are no destructive operations. Check freely and often.");
    });

    it(`${name}: Recipe format says what evidence rests on, and the seam is confidence to act (S7-B9)`, () => {
      const format = section(text, "## Recipe format");
      expect(format).toContain("Evidence says what the claim rests on, so a reader who wasn't there can check it");
      expect(format).toContain("or your inference from the situation, named as inference");
      expect(format).toContain("an inference you'd act on is a check, and saying it's inferred keeps the record honest");
      expect(format).toContain("A draft is a hypothesis you wouldn't act on without the answer.");
      expect(format).toContain("The seam is your confidence to act, not the kind of evidence and not whether a person has spoken");
      expect(format).toContain("a draft with no evidence is a question that didn't do its work");
    });

    it(`${name}: Drafts names the over-caution case and who resolves an on-behalf draft (S7-B6, S7-B10)`, () => {
      const drafts = section(text, "## Drafts");
      expect(drafts).toContain("An orchestrator once refused to verify drafts its own context settled, because the tool copy spoke of a person confirming.");
      expect(drafts).toContain("The goal is that a person's agent resolves what it can stand behind, and a person sees only what no agent could.");
      expect(drafts).toContain("In a shared book the call may be a colleague's; a draft on their behalf is resolved by their agents.");
    });

    it(`${name}: How to check says an unknown parameter name is refused with the known ones named (S7-B7)`, () => {
      expect(section(text, "## How to check")).toContain("A tool refuses a parameter name it doesn't take, and the refusal names the ones it does.");
    });
  }

  it("the added guidance reads as what is useful, not as rules (S7-V1 over C2's additions)", () => {
    const thin = BRIEFING.build(thinInput());
    const format = section(thin, "## Recipe format");
    const drafts = section(thin, "## Drafts");
    const added = [
      opening(thin).slice(0, opening(thin).indexOf("You already work")),
      format.slice(format.indexOf("Evidence says what"), format.indexOf("**Example")),
      drafts.slice(drafts.indexOf("In a shared book"), drafts.indexOf("With sub-agents")),
    ];
    for (const text of added) {
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/\b(must|never|always|do not|don't)\b/i);
    }
  });
});

describe("BRIEFING.build — slice 7: duplicates of the MCP tool schema leave the thin profile only", () => {
  // The session_id parameter already says to omit it after compaction, and
  // the supporting_evidence parameter already gives the entry shape; a paste
  // reader has no tool schema, so the full profile keeps both lines.
  const compaction = "If you auto-compact your context or otherwise no longer hold the recipes you've been shown";
  const evidenceShape = "Evidence entries follow this shape:";

  it("thin omits them", () => {
    const thin = BRIEFING.build(thinInput());
    expect(thin).not.toContain(compaction);
    expect(thin).not.toContain(evidenceShape);
  });

  it("full keeps them", () => {
    const full = BRIEFING.build(buildInput());
    expect(full).toContain(compaction);
    expect(full).toContain(evidenceShape);
  });
});

describe("buildExemplarsSection — the slimming lever (recipe aae000d2, S7-L1)", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const entry = (n: number) => `Interpretation ${n}.\n> "quote ${n}"\n-- source ${n}`;
  const exemplar = (evidenceBlocks: string[]): BriefingExemplar => ({
    recipeId: id,
    recipeBookSlug: "personal",
    loggedDate: "2026-10-24",
    memberCount: 3,
    claimText: "As a developer working on X, I prefer Y so that Z.",
    evidenceBlocks,
  });
  const render = (blocks: string[]) => buildExemplarsSection("all your recipe books", { k: 1, mode: "umap" }, [exemplar(blocks)]);

  it("renders only the top evidence entry and points to the rest by id", () => {
    const text = render([entry(1), entry(2), entry(3)]);
    expect(text).toContain(`Evidence:\n${entry(1)}\n(2 more evidence entries: get_recipes or GET /recipes?ids=${id})`);
    expect(text).not.toContain("quote 2");
    expect(text).not.toContain("quote 3");
  });

  it("names a single extra entry in the singular", () => {
    expect(render([entry(1), entry(2)])).toContain(`(1 more evidence entry: get_recipes or GET /recipes?ids=${id})`);
  });

  it("renders one entry as before, with no pointer", () => {
    const text = render([entry(1)]);
    expect(text.endsWith(`Evidence:\n${entry(1)}`)).toBe(true);
    expect(text).not.toContain("more evidence");
  });

  it("renders no Evidence block for an exemplar without evidence (blank entries ignored)", () => {
    const text = render(["   "]);
    expect(text).not.toContain("Evidence:");
    expect(text.endsWith("As a developer working on X, I prefer Y so that Z.")).toBe(true);
  });
});

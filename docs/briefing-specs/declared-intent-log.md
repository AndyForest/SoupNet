# Declared-intent log — briefing-copy changes

Every PR that touches briefing copy (`packages/domain/src/recipe-guide-content.ts`, the briefing composer, MCP tool descriptions) appends an entry here **before** merging: the date, each edit, the scenarios it intends to move, and the rationale for why every other scenario holds. See [README.md](README.md) §The regression rule. Newest entry first.

## 2026-07-06 — Placeholder mode: no raw key in any briefing response

Operator-approved generalization of the same day's OAuth branch. Principle: every MCP/API consumer of the briefing had to supply the key to get the briefing, so echoing it back is redundant; the only consumer that needs an inline key is the human copy-briefing flow, and the browser does that substitution itself. Raw keys never appear in responses — not even on the JWT path.

### Edits

1. **`BRIEFING.build` takes no key input at all** (`apiKey` and `checkUrl` removed from `BriefingBuildInput`). Non-OAuth compositions render the exported `BRIEFING_KEY_PLACEHOLDER` literal (`YOUR_API_KEY`) in the key section and every key-bearing URL/config (check URL, guide URL, mcp-setup link, Codex env/inline configs, Claude Code one-liner/JSON, link-format example). The OAuth mode from the previous entry is unchanged (placeholders would mislead there — nothing pasteable exists).
2. **"## Your API key" copy** rewritten as a dual-state explanation, true both pre-substitution (Bearer agents — GET /briefing, MCP get_briefing, and the stdio proxy's Claude Desktop consumers, who hold their key in client config) and post-substitution (the human-pasted artifact, where the dashboard spliced the real key in). Copy rule, enforced by a domain test: the placeholder literal never appears in prose — only in key positions — because the frontend's `replaceAll` would splice a raw key mid-sentence.
3. **`GET /keys/briefing?key=` → `POST /keys/briefing` with the key in the JSON body** — minted keys stop transiting request URLs (F24 keeps ALB access logs disabled precisely because URLs carried keys). All four dashboard call sites (CopyBriefingButton, ApiKeysPage, RecipeMapPage, GroupsPage AgentConnectBox) now POST and substitute the raw key they already hold client-side via the shared `substituteBriefingKey` helper (`apps/frontend/src/lib/briefing-key.ts`; its literal must match the domain's).

### Guards (CI-enforced under test:ci)

- Domain: placeholder mode renders the literal in every key position, nothing raw-key-shaped (`cn_[sd]_` pattern), prose free of the literal (`recipe-guide-content.test.ts`).
- Bearer paths: GET /briefing and MCP get_briefing responses contain neither the authenticated key nor any `cn_[sd]_`-shaped substring, and do contain the placeholder (`oauth-flow.test.ts`).
- JWT path: POST /keys/briefing output carries the placeholder and never the raw key (`keys.test.ts`).
- Frontend: `substituteBriefingKey` composes an artifact carrying the key at every placeholder position (`briefing-key.test.ts`).

### Scenarios intended to move

None — no scenario asserts the briefing artifact's key is server-inlined; they assert what the *received* artifact affords.

### Scenarios watched, with rationale for holding

- **`web-only-agents.feature` (all scenarios)** — that population receives the HUMAN-pasted artifact, which after the dashboard's copy-time substitution still carries a real key in the identical positions (key section value line, `?key=` URLs, Bearer configs). The frontend unit test proves the composed artifact is position-for-position what the server used to inline, so the pasted-briefing UX is unchanged.
- **Bearer MCP agents (comprehension/checking scenarios)** — they never needed the echoed key (they call tools directly); the key section now says exactly that. The stdio-proxy population (Claude Desktop) holds its key in client config per the connection it was set up with.
- **All other scenarios** — principles, format, when/how-to-check, feedback, divergence, corpus-context copy untouched in both modes.
- Suite re-run: harness not yet wired (README §regression rule "once wired"); .feature files remain the manual checklist.

## 2026-07-06 — OAuth connections: credential-free briefing branch

Backlog item "Reconcile the briefing's API-key-in-URL assumptions for OAuth-connected agents". Live failure (2026-07-06, claude.ai connector): the briefing rendered the raw 1-hour OAuth access token in "## Your API key" and embedded it as `?key=` in every setup URL; the connected agent warned the user about a "leaked key" that wasn't one.

### Edits

When the briefing is composed for an OAuth access token (`api_keys.key_type = 'oauth'`, threaded from `resolveScope` through `BRIEFING.build`'s new `oauthConnection` input), the four credential-bearing sections swap to short truthful notes; every other section is shared verbatim between the two branches:

1. **"## Your API key" → "## Your connection"** — connected via OAuth, 1-hour token (verified: `ACCESS_TOKEN_TTL_SECONDS` in oauth.service.ts) the client refreshes automatically, nothing to copy, paste, protect, or rotate.
2. **"## Setup — MCP-capable agents"** — one already-connected line (the tools are live in this session) plus the `/info/connect` pointer for connecting other clients (canonical-doc rule, recipe 12b00466).
3. **"## Setup — web-only agents"** — keyless note: the key-in-URL flow doesn't apply to this connection; the human can mint a pasteable key and copy a key-carrying briefing at the frontend.
4. **"## Formatting recipe-check links"** — heading kept (the divergent-checks section cross-references it) with a not-applicable note and dashboard pointer instead of the key-embedded markdown-link example.

Defense in depth: for OAuth keys the composer also passes a keyless `checkUrl` and an empty `apiKey`, so the token physically cannot render even if a future template edit misses the branch. Non-OAuth briefings are **byte-identical** to before (verified against the HEAD render, 20,417 bytes with fixed inputs; pinned by `packages/domain/src/recipe-guide-content.test.ts` plus two integration tests in `oauth-flow.test.ts`).

### Scenarios intended to move

None — no existing scenario's persona is an OAuth-connected agent.

### Scenarios watched, with rationale for holding

- **`web-only-agents.feature` (all scenarios)** — the web-setup section and key-embedded URL examples disappear for OAuth connections only. Every persona in that file is a web-browsing agent primed with a pasted key-carrying briefing; an OAuth connection is by definition an MCP tool-calling session, so the pasteable-key population those scenarios describe always receives the unchanged legacy sections.
- **`divergent-checks.feature`** — untouched copy; the "see the link-formatting guidance below" cross-reference still resolves in both branches because the section heading is kept in OAuth mode.
- **`comprehension-quiz.feature`, `recipe-voice`, `evidence-integrity`, `checking-behavior`, `recipe-book-routing`, `advanced-workflows`, `feedback-loop`** and the `@unreleased` files — principles, format, when-to-check, how-to-check, feedback, annotation, and corpus-context copy are shared verbatim between the branches (single template with four swapped section variables), so no fed copy changed for any non-OAuth reader.
- Suite re-run: the agent-run harness is not yet wired (README §regression rule "once wired"); per README, the .feature files double as the manual checklist until then.

## 2026-07-05 — FF-3: feedback parity, dry-run honesty, encoding/decided_at examples, hostname derivation

Six copy edits from the 2026-07-05 qualitative-eval findings (§Briefing copy gaps surfaced by cold readers) and the backlog item "Feedback copy parity for web agents". First entry under the declared-intent rule.

### Edits and scenarios intended to move

1. **Web/REST feedback path** (briefing §Closing the loop): documents `POST /feedback` (Bearer key, single row with `trace_id` or `{"feedback": [rows]}`) alongside `log_feedback`/`feedback`.
   → Moves: `feedback-loop.feature` — new scenario "Web/REST agent closes the loop via POST /feedback" (added in this PR).
2. **Null/ignored/contradicted results line** (briefing §Closing the loop): "results that didn't help are worth a row too" — answers a cold reader's verbatim question.
   → Moves: `feedback-loop.feature` — new scenario "Ignored, contradicted, or empty results still earn a feedback row" (added in this PR).
3. **Dry-run honesty** (briefing intro): every submission logs a real trace; probe on the docs pages; `filter` (alias `f`) is the no-logging keyword lookup.
   → Moves: `checking-behavior.feature` — new scenario "Probing the system does not log junk recipes", tagged `@unreleased` until FF-1 lands the `/check` filter implementation.
4. **Percent-encoding example** (briefing §Setup — web-only agents): concrete `%20`/`%22` example.
   → Moves: `web-only-agents.feature` — new scenario "Recipe-check URLs percent-encode parameter values" (added in this PR).
5. **`decided_at` worked example** (CONNECTION_TIERS tier 2 + `MCP_PARAM_DESCRIPTIONS.decidedAt`): artifact date → `decided_at` value.
   → Moves: `advanced-workflows.feature` — "Backfilled decision carries its original judgment date" (existing scenario; edit strengthens it, no text change to the scenario).
6. **Instance-derived link example** (briefing §Formatting recipe-check links): the markdown-link example now derives from `checkUrl` instead of the hardcoded hosted domain.
   → Moves: `web-only-agents.feature` — new scenario "Emitted links use the briefing's own base URL" (added in this PR).

Also in this PR: dropped the stale feature-level `@unreleased` tag on `feedback-loop.feature` (WT-4's feedback ingestion shipped and was Layer-4b-verified 2026-07-05; the tag's own rule says drop it in the implementing PR, which omitted it) and updated its README table row.

### Scenarios asserted to hold (rationale)

- **`checking-behavior.feature` "Checks happen autonomously, without permission-seeking" and HOW_THIS_WORKS' check-freely framing** — the highest-risk interaction. The dry-run sentence is phrased as a redirect to sanctioned alternatives (docs pages, `filter`), not a warning against checking; "check freely and often" is unchanged and precedes it. Verified against corpus recipe 5ebea12c-2740-4498-aa95-c1bb562c6dce lineage (append-only framing exists to remove check hesitation).
- **All other `feedback-loop.feature` scenarios** — the blurb's mid-flow-vs-standalone guidance and field vocabulary are unchanged; the REST sentence adds a surface without altering carrier guidance.
- **`web-only-agents.feature` link-format scenarios (Gemini plaintext / markdown / uncertain-fallback)** — the format-selection guidance is untouched; only the example URL's host changed, and every briefing already embedded the instance's own `checkUrl` elsewhere.
- **`recipe-voice`, `evidence-integrity`, `recipe-book-routing`, `divergent-checks`, `comprehension-quiz`, `frontmatter-recipe-lookup`, `known-recipes-dedup`, `subagent-purpose-briefing`** — no edited copy feeds these: voice/evidence/routing/divergence sections, exemplar rendering, and the WT-3/WT-4 tool descriptions (other than `decidedAt`) are byte-identical.
- Suite re-run: the agent-run harness is not yet wired (README §regression rule "once wired"); per README, the .feature files double as the manual checklist until then.

Briefing size: 18,560 → 19,324 bytes (+764, +4.1%) with fixed reference inputs.

## 2026-07-06 — Tool/param descriptions trimmed to affordances (18KB → 11.6KB tools/list)

**Edits:** every MCP tool and param description reduced to affordance size (what it does, when to reach for it, hard constraints); teaching content (voice-mistake examples, ROI mechanics, feedback-field tutorials, worked decided_at example) removed from schema — it already lives in the briefing, which remains the canonical teaching surface. Operator-specific example vocabulary removed from static schema copy. The briefing's "How to check" section gains a one-paragraph pointer at the optional power params (known_recipes, decided_at, response_format, agent_id, feedback) and absorbs the region depth line. Budget guard added (mcp-tool-descriptions.test.ts: ≤420 chars per shared description, ≤4,000 total).

**Scenarios intended to move:** none — this is a redundancy reduction, not a behavior change; all teaching remains reachable via get_briefing, which every comprehension scenario already routes through.

**Scenarios watched, with rationale for holding:** voice/format scenarios (voice-and-format.feature and kin) — the one behavioral risk is agents that skip get_briefing now get a one-line voice rule in the recipe param instead of the example set; mitigated by keeping the rule itself plus an explicit "get_briefing teaches the voice rules" pointer in both the check_recipe trailer and the recipe param. If the naive-agent evals show voice quality regressing for briefing-skipping agents, the reversal is scoped: restore examples to the recipe param only.

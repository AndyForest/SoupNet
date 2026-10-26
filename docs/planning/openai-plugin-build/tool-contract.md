# OpenAI plugin directory, stream T: the tool contract

Stream T's rubric, build notes and verification record for [openai-plugin-directory.md](../openai-plugin-directory.md) items 3 to 7 and 13. Branch `plugin/tool-contract`, session `d-tool-shapes` (agent `a-plugin-t-2026-10-26`, Soup.net intent `int_jzE34Le6G65SUL9QAsXHJlsf`). Merges first of T, O and L.

## Rubric

Written 2026-10-26, before implementation, from the plan, OpenAI's plugin guidelines and app-review page (read the same day), and the code at `5b81097`.

**File ownership, agreed with the planning session:** T owns `MCP_TOOL_DESCRIPTIONS` and `MCP_PARAM_DESCRIPTIONS` in `recipe-guide-content.ts`, plus a new domain file for the server instructions. L owns the rest of that file and asks T for any description change. In `routes/mcp.ts`, T touches descriptions, annotations, the instructions and the new profile tool, while stream O touches the 401 challenge and `securitySchemes`.

**The rule the annotations follow**, stated once so every flag on every tool can be checked against it:

- **`readOnlyHint` is true when the tool changes no state the person or their collaborators can see.** A tool that writes only its own call record (the audit row that every call writes) still counts as read-only. So does a tool that writes the session bookkeeping the caller asked for, an intent registered from the `intent` text. That is the position to check, and the justification document says it plainly so the reviewer reads it before the scan. OpenAI: "Set to `true` if it strictly fetches/looks up/lists/retrieves data and does not modify anything."
- **`destructiveHint` is true when the tool does more than add.** That covers a tool that overwrites, deletes, or moves something to a state it cannot come back from through the same surface. This combines the MCP specification ("If false, the tool performs only additive updates") with OpenAI ("can cause irreversible outcomes"; "Being able to undo an action does not, by itself, justify setting `destructiveHint` to `false`").
- **`openWorldHint` is true when the tool reaches the public internet**, which today is only `check_recipe` fetching a `file_url`. Everything else is bounded to the books the account can read or write. OpenAI: "Set to `false` if the tool is limited to a bounded private account or workspace". This replaces the old reason for `true` on three read tools ("a corpus other agents write to between calls"), which describes a changing corpus, not an open world.

### Annotations (item 3)

| # | Criterion | Evidence |
|---|---|---|
| T-A1 | Every tool on the remote `tools/list` carries `title`, `readOnlyHint`, `destructiveHint` and `openWorldHint` as explicit booleans. Today `get_briefing`, `get_recipes` and `list_my_recipe_books` omit `destructiveHint`. | A test over the served `tools/list` that fails on any missing or non-boolean flag. |
| T-A2 | Each flag's value follows the rule above, and a test pins the full table (tool × flag), so any change is a reviewed edit. | The pin test; the justification document's table. |
| T-A3 | `update_recipe_book_description` is `destructiveHint: true`, and its description says that the call replaces the book's description and that the response shows the earlier text once. (Amended while building: the audit row keeps the earlier text, so "is not kept" would claim more than the server does.) | The pin test; the description text. |
| T-A4 | `verify_draft` is judged by the same rule. A resolution changes a draft's state, and the agent surface cannot undo it (a repeat is refused), so it is `destructiveHint: true` unless the code shows otherwise. The value, and the confirmation prompt it brings in ChatGPT, are named in the PR. | The pin test; the justification. |
| T-A5 | The stdio server's flags follow the same rule for every tool it serves, and equal the remote ones where the behaviour is equal. (Amended while building: stdio's `check_recipe` attaches a local file, never a URL, so it is closed-world there.) | A stdio test pinning its table. |

### Descriptions (item 4)

| # | Criterion | Evidence |
|---|---|---|
| T-D1 | Every remote tool description says what the tool does, when to use it, and when not to (naming the tool to use instead), as plain statements. | A test that each description carries a use clause and a not-for clause; the justification document quotes each. |
| T-D2 | No promotional or comparative wording, and nothing that favours or disparages other plugins or services. | A word-list test (for example "powerful", "best", "seamless", "smart", "revolutionary", "only", "upgrade", "premium") over the served `tools/list`; reading. |
| T-D3 | Every claim in a description matches hosted behaviour and the schema. Each parameter or behaviour a description names exists, and the justification document maps each claim to the code that makes it true. | The document's claim table; a test that each parameter named in a description is in that tool's schema. |
| T-D4 | Tool names and input schemas are unchanged, so the published contract stays backward compatible. Only descriptions and annotations change, plus one added tool. | A schema snapshot comparison against `main`. |
| T-D5 | The lean variant (`MCP_TOOL_PROFILE=lean`) also meets T-D1 to T-D3, or the document states why that diagnostic profile is out of scope. | Reading; the document. |
| T-D6 | Size: remote and stdio `tools/list` and the shared-description total are measured on this branch with `main` merged (stream B's `page` parameter lands first). A cap moves only by the measured figure, with a dated reason at the assertion and in `spec-decision-log.md`. | The size tests; the figures. |

### Server instructions (item 5)

| # | Criterion | Evidence |
|---|---|---|
| T-I1 | `initialize` returns `instructions` on the remote server, and on stdio, from one domain constant in its own file. | Layer 3 on remote; a stdio in-memory test. |
| T-I2 | The first 512 characters carry the cross-tool guidance: get the briefing first; check before a judgment call; log the call after a decision; close the loop with feedback; resolve drafts your context settles; search, not check, when you only want to look. Each move names its tool. | A test on the first 512 characters. |
| T-I3 | The whole text is at most 1,200 characters, uses no vendor names, and does not contradict the briefing (C2's copy on `main`). | A length test; reading against the briefing. |

### Output minimisation (item 6)

| # | Criterion | Evidence |
|---|---|---|
| T-O1 | An inventory of every field each tool returns, in markdown and in `structuredContent`, success and refusal, with each field marked keep (and the product reason) or drop. Recorded in the justification document before any code changes. | The document; a probe run against a fresh stack that captures each tool's real output. |
| T-O2 | Kept, as the product's semantics: recipe ids (the handle for follow-up calls), judgment dates (`decided_at`, "newest judgment"), authors in shared books, session, intent, search and briefing ids (they drive id-stub rendering and the feedback loop), and similarity figures (how close a result is, which the agent weighs). | The document's reasons; a test that each is still present. |
| T-O3 | Dropped or gated: anything diagnostic only, such as internal ids the agent never sends back, request or trace ids, debug payloads, and timing. Each drop is pinned by a test that the field is absent. | The tests; the document. |
| T-O4 | Text owned by stream L (the briefing body in `recipe-guide-content.ts`) is audited too, and any finding there goes to L as a message, not as an edit on this branch. | The document lists what was sent. |

### No plan or upgrade language (item 7)

| # | Criterion | Evidence |
|---|---|---|
| T-P1 | No tool description or output mentions plans, premium, upgrades, pricing, trials or checkout. Today `synthesize`'s description begins "Premium opt-in", and its refusal says "premium feature — not enabled for this account". Both become neutral statements of what happens. | A word-list test over `tools/list` and over the refusal text; grep of the output paths. |

### Profile tool (item 13)

| # | Criterion | Evidence |
|---|---|---|
| T-F1 | A new tool takes no parameters and returns the caller's own identity: a stable opaque `id` (the user's id, never reassigned, the same for every key and OAuth grant the person holds), `email` and `displayName` as separate fields, in `structuredContent` and as text. | Layer 3 with a daily key and a scoped key of the same person returning one id; another person's key returning another. |
| T-F2 | It is flagged `_meta["openai/profile"]: true` and annotated read-only, not destructive, closed world. | The served `tools/list`. |
| T-F3 | The unknown-parameter guard covers it, it is in the registry pin, and its bytes are counted in T-D6. | The existing guard and pin tests. |

### The justification document, and the shared logs

| # | Criterion | Evidence |
|---|---|---|
| T-G1 | `docs/connectors/openai-plugin.md` holds the rule, the annotation table with a justification per flag per tool, each description and its claim-to-code map, the output inventory with reasons, the plan-language audit, and the profile tool. Every quoted guideline is verbatim with its link. | The document. |
| T-G2 | `spec-decision-log.md` records each description and instructions change, the scenarios watched, and the bytes. | The log. |
| T-G3 | The gate passes on the branch with `main` merged (`npm run test:ci`, distinct ports). The authz seam holds: the profile tool reads only the caller's own user row, through the principal. | The gate. |

## Build notes (2026-10-26)

Written by the builder for the verifier; the verification record is the verifier's to write.

**Gate:** `TESTCI_PGPORT=5644 TESTCI_BACKEND_PORT=3288 npm run test:ci` exited 0 with 2,214 tests passed and 6 skipped (149 files, 2 skipped). Typecheck, lint (0 errors), the data-model check and the authz seam passed. New suites:
- `routes/tool-contract.test.ts`: in-process remote `initialize` and `tools/list`, for rows A1 to A4, D1 to D3, I1 to I3 and F2.
- `routes/tool-contract-outputs.test.ts`: Layer 3, for rows F1, O2, O3 and P1.
- `apps/mcp-server/src/tool-contract.test.ts`: stdio, for rows A5, D2 and I1.

**Output inventory (T-O1):** taken from each tool's real output on a fresh stack, with a temporary probe that captured every tool in markdown and structured form, successes and refusals. The probe is not committed. The inventory and its reasons are in `docs/connectors/openai-plugin.md`. Two findings in the briefing text went to stream L, and L took both (PR #151).

**Rows to check closely:**
- **T-A3, T-A5, T-D3:** amended while building, and the rubric rows say how. The audit row keeps the earlier description, so the description says the response shows the earlier text once. Stdio's check is closed-world. The dedup is per key, so the check description says "and key".
- **T-D4:** the schema snapshot against `main` is to be taken after stream B's `page` parameter lands, as the verification coordinator advised. Only descriptions and annotations changed here, plus one added tool.
- **T-O3:** `ranking` and the feedback id left MCP only; REST keeps both. The refusal paths are unchanged, so the uniform-marker tests stand as they were.
- **T-F1:** the profile tool reads the principal's own user row, takes no parameters, and refuses an argument.

**Seam:** `feedback.service.ts` was re-fingerprinted (`c7490c2928a4` → `e1e7da957b6a`, same 26 lines). The duplicate-row summary line, whose feedback id was removed, sits inside a fingerprinted statement window. No SQL changed.

**Caps:** set once after slice 8b (#154) merged, measured on `main` at `cf6e13e` plus this branch: remote 17,904 → 18,930 (cap 18,200 → 18,950), stdio 14,407 → 14,738 (14,700 → 14,750), shared descriptions 6,593 → 7,434 (6,600 → 7,450), each dated at its assertion.

**T-D4, closed after #154 merged:** a structural snapshot took the served `tools/list` of both servers on this branch and on `main`'s own server code at `cf6e13e`, with descriptions stripped. Every existing tool's name, parameter names, types and required list are identical on both servers. The one difference is `get_profile`, added on the remote server.

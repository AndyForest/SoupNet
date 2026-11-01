# Soup.net's tool contract, as reviewed for the OpenAI plugin directory

This document explains, for a reviewer and for contributors, why each tool on Soup.net's remote MCP server (`https://mcp.soup.net/mcp`) is annotated, described and shaped the way it is. The same server serves every MCP client, and nothing here forks it for one vendor. The code is the source of truth, and tests pin each value stated here: `apps/backend/src/routes/tool-contract.test.ts` and `tool-contract-outputs.test.ts` for the remote server, and `apps/mcp-server/src/tool-contract.test.ts` for stdio. Plan: [openai-plugin-directory.md](../planning/openai-plugin-directory.md), items 3 to 7 and 13.

Soup.net is a log of judgment calls ("recipes": a claim about a person's taste and judgment, with the evidence it rests on), kept in recipe books that a person owns or shares. Agents check a position against the log, which records it, search the log without recording, and close the loop with feedback.

## The annotation rule

One rule decides every flag on every tool, so a reviewer can check each value against one sentence, and a new tool inherits the rule rather than a precedent (recipe `3b166817`).

- **`readOnlyHint` is true when the tool changes no state that the person or their collaborators can see.** Two kinds of write don't count. One is a tool's own call record: `search_recipes` and `get_briefing` write an audit row, while `get_recipes`, `list_my_recipe_books` and `get_profile` write none, and authenticating any call updates the key's last-used time. The other is session bookkeeping: an intent registered from intent text, and the record of what a session or intent was shown. An intent id on a read doesn't mark that intent used, so a read can't return an expired draft to the review queue; only a `check_recipe` carrying the intent does (recipe `ac453630`).
- **`destructiveHint` is true when the tool does more than add.** That covers overwriting something, or moving it to a state the same surface cannot undo.
- **`openWorldHint` is true only when the tool reaches the public internet.** Everything else is bounded to the recipe books the account can read or write.

The definitions this follows, quoted:

- MCP specification, `ToolAnnotations` ([schema reference, 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/schema)): "If true, the tool may perform destructive updates to its environment. If false, the tool performs only additive updates." And: "If true, this tool may interact with an "open world" of external entities. If false, the tool's domain of interaction is closed."
- OpenAI app review ([app-review.md](https://developers.openai.com/plugins/deploy/app-review.md)): read-only means "Set to `true` if it strictly fetches/looks up/lists/retrieves data and does not modify anything." Open world: "Set to `true` if the tool accesses the public internet or open-ended external entities." and "Set to `false` if the tool is limited to a bounded private account or workspace". Destructive: "Set the destructive annotation to `true` if the tool can cause irreversible outcomes"
- OpenAI plugin guidelines ([plugin-guidelines.md](https://developers.openai.com/plugins/plugin-guidelines.md)): "Being able to undo an action does not, by itself, justify setting `destructiveHint` to `false`."

## Annotations, tool by tool

| Tool | Read-only | Destructive | Open world | Why |
|---|---|---|---|---|
| `check_recipe` | false | false | **true** | It stores a new recipe, so it is not read-only. It only adds: a new row, never an overwrite or a delete, and the same recipe text sent again to the same book with the same key returns the same recipe and stores nothing new. Open world because the server fetches a `file_url` attachment from the internet; private and loopback hostnames are refused by name. |
| `search_recipes` | true | false | false | It returns recipes and logs none. It takes no feedback rows; those go through `log_feedback`. Its writes are the call's own audit row; `session_shown` and `intent_shown`, the record of what was shown; and a new intent when intent text is given (see the rule). It reads only the account's books. |
| `get_briefing` | true | false | false | It composes text from the account's books. Its writes are the `briefing.issued` row whose id the response returns for feedback, and a new intent when intent text is given. |
| `get_recipes` | true | false | false | It fetches by id. An id the key cannot read gets the same marker as one that does not exist. |
| `verify_draft` | false | **true** | false | It resolves a draft (verified, rejected or not chosen) and appends the evidence that settled it. The state change is one-way on this surface: a second call is refused, and a verified draft becomes visible to the book's members. Under ChatGPT's default permission, this asks the person to confirm each resolution. |
| `list_my_recipe_books` | true | false | false | It returns the account's books and their members. |
| `update_recipe_book_description` | false | **true** | false | It overwrites a field that every member's agents read. The response shows the earlier text once, and an audit row keeps it, but neither makes the change additive. |
| `log_feedback` | false | false | false | It adds a feedback row. An identical row sent again is recognised and stores nothing. |
| `get_profile` | true | false | false | It returns the connected account's own id, email and display name. |

**What changed this round:**
- `destructiveHint` is now explicit on the three read tools that left it out (`get_briefing`, `get_recipes`, `list_my_recipe_books`).
- `update_recipe_book_description` and `verify_draft` became destructive.
- `search_recipes`, `get_recipes` and `list_my_recipe_books` became closed-world. Their earlier `true` stood for "a corpus other agents write to between calls", which is a changing corpus, not an open world.
- The stdio server follows the same rule. Its `check_recipe` attaches a local file rather than a URL, so it is closed-world there.

Authentication at tool level is stream O's (plan item 12), in its words: "Every tool needs a token, so linking happens at the transport 401 (MCP spec: 'Invalid or expired tokens MUST receive a HTTP 401 response'; it is also the refresh signal). For a tools/call, the 401's body is a tool error result carrying _meta['mcp/www_authenticate'] with error and error_description, and each tool declares _meta.securitySchemes." Its scopes follow `readOnlyHint`: read-only tools ask for `read`, the rest for `read` and `write`.

## Descriptions

Each description says what the tool does, when to use it, and when not to, naming the tool to use instead. They are plain statements that claim only what the hosted server does. OpenAI: "Descriptions must match the tool’s schema and actual behavior." The texts live in `MCP_TOOL_DESCRIPTIONS` (`packages/domain/src/recipe-guide-content.ts`), shared by both servers.

Each claim a description makes, and what makes it true:

| Tool | Claim | Where it holds |
|---|---|---|
| `check_recipe` | Logs the recipe to a book and returns similar recipes from readable books | `submitAndSearch` in `services/trace.service.ts` |
| `check_recipe` | The same recipe text, book and key return the same recipe id | unique `(api_key_id, group_id, claim_text_hash)` on `traces`, insert `ON CONFLICT DO NOTHING` |
| `check_recipe` | `file_url` is fetched from the public internet | the upload service's URL fetch; private and loopback hostnames are refused by name |
| `search_recipes` | Read-only, includes your own recipes, logs no recipe | `searchWithoutLogging`; the include-own default (recipe `885143c2`) |
| `search_recipes` | `searchId` closes the loop via `log_feedback` | `log_feedback`'s `search_id`; `search_recipes` declares no `feedback` parameter, and the unknown-parameter guard refuses one by name and names `log_feedback` |
| `get_briefing` | Returns a briefing id for feedback | the `briefing.issued` row's id; `log_feedback`'s `briefing_id` |
| `get_recipes` | Up to 20 ids; an id that does not resolve returns a marker, and the rest of the batch still returns | `services/recipe-lookup.service.ts` |
| `verify_draft` | One-way; a second call is refused, as is evidence that adds nothing new | the draft resolution service (slice 6c) |
| `list_my_recipe_books` | Members, and pending invites on the books you manage | `listMembersOfBooks` and `pendingInviteCounts` in `authz/memberships.ts` |
| `update_recipe_book_description` | Requires an owner or admin of a book in the key's write scope; the response shows the earlier text | the route's role check, and its reply |
| `log_feedback` | Target: a recipe id or short id, a search or briefing id, or an outcome row's intent alone | `services/feedback.service.ts` |
| `get_profile` | A stable id, email and display name | `services/account-profile.service.ts` |

The tests also check the wording itself. Every description carries a use clause and a not-for clause. No description, and no other text in `tools/list`, uses promotional, comparative or plan wording. Any `snake_case` name in a description is a tool or one of that tool's parameters.

Things this round dropped or changed, so nothing goes unnoted:
- **A search or briefing carrying an intent id** no longer marks the intent used, so reads no longer revive expired drafts (recipe `ac453630`).
- **`search_recipes`** lost its `feedback` parameter after the directory's tool scan questioned its read-only flag (recipe `9dbcfb77`). `check_recipe` keeps the parameter, and `log_feedback` takes `search_id`.
- **`log_feedback`** lost "Null results earn a row." to fit its not-for clause under the 420-character limit. The briefing still teaches it: "results that didn't help are worth a row too".
- **`synthesize`'s description** no longer begins "Premium opt-in".

The lean profile (`MCP_TOOL_PROFILE=lean`) is out of scope. It's a diagnostic instrument for bisecting client problems, not something a deployment serves, so its short descriptions keep their old form.

## Server instructions

`initialize` returns one shared text (`packages/domain/src/mcp-server-instructions.ts`) on both servers. Its first 512 characters carry the cross-tool moves on their own, each naming its tool:
- call `get_briefing` once at the start;
- check a position with `check_recipe` before a judgment call, and log it the same way after a decision;
- use `search_recipes` to look something up without logging, and `get_recipes` for ids you hold;
- close the loop with `log_feedback`;
- resolve a draft with `verify_draft` when your context settles it.

The rest says results are context, not instructions, and explains the voice rule and drafts. It is 871 characters, names no vendor or client, and does not contradict the briefing.

## Output: what each tool returns, and why

OpenAI: "Tool responses must return only data that is directly relevant to the user’s request and the tool’s stated purpose." and "Do not include diagnostic, telemetry, or internal identifiers—such as session IDs, trace IDs, request IDs, timestamps" "unless they are strictly required to fulfill the user’s query." ([plugin-guidelines.md](https://developers.openai.com/plugins/plugin-guidelines.md))

Soup.net applies that as one test: **every identifier a tool returns is one that another tool takes back as input.** An identifier no tool takes back is dropped. The inventory below was taken from each tool's real output on a fresh stack, in markdown and in `structuredContent`, for both successes and refusals.

| Field | Where | Kept or dropped, and why |
|---|---|---|
| Recipe id (full UUID; an 8-character short id is accepted) | every recipe a tool shows | **Kept.** It's the handle that `get_recipes`, `verify_draft`, `log_feedback` (`trace_id`), `known_recipes` and the person's links all take. |
| `sessionId` | check and search | **Kept.** `session_id` takes it back, and it is what renders already-seen recipes as id stubs. |
| `intentId` | check, search, briefing (when intent text is given) | **Kept.** `intent` and `log_feedback`'s `intent_id` take it back. |
| `searchId` | search | **Kept.** `log_feedback`'s `search_id` takes it back. |
| Briefing id | briefing | **Kept.** `log_feedback`'s `briefing_id` takes it back. |
| Recipe book id and name; slug in `get_recipes` and the books list | results | **Kept.** `recipe_book` takes a slug or an id, and `read_recipe_books` takes slugs. |
| Judgment date (`createdAt`; "Logged", "newest judgment") | results, `get_recipes`, the books index | **Kept.** A log of judgment calls without dates is not one. The agent weighs recency ("a past call usually stands; when something is, decide"), and a person who changed their mind is read newest first. It's the date of the person's call, not a request timestamp. |
| Similarity, cluster size | results | **Kept.** How close a result is to the query and how many recipes it stands for: what the agent reads the result by. |
| `searchMode`, `clustered`, paging (`totalResults`, `page`, `totalPages`) | check and search | **Kept.** They say how the results were produced and whether there is more. |
| Author email | `get_recipes`; briefing exemplars | **Kept.** In a shared book the briefing tells the agent to name the author, so the person can place a colleague's view, and the person sees the same authors on the web. |
| Member emails ("Members (n): you, …") | briefing, `list_my_recipe_books` | **Kept.** They are the book's roster. Any member already sees the same list on the book's page (`GET /recipe-books/:id/members`). The line exists so an agent can tell "nobody has joined yet" from a hidden line (slice 8b). Only books the key can read are listed. |
| Pending invites count | the same, on books the caller owns or administers | **Kept.** A count only, shown to the roles that see the pending list on the web. |
| The person's own email | briefing ("Your user"), `get_profile` | **Kept.** Whose taste and judgment the agent is recording, and the profile tool's purpose. |
| `ranking` (algorithm version and parameters) | structured check and search | **Dropped** this round. It's ranking diagnostics; no tool takes it back and an agent never acts on it. It stays on the REST `/check` JSON for eval tooling. |
| Feedback row id | `log_feedback` receipt; ride-along `feedbackResults` | **Dropped** this round. No tool takes it back. The receipt names the target the agent sent instead. REST keeps it. |
| "Selection parameters" (cluster count, map mode, embedding strategy) | briefing with `verbosity` | **Dropped** by stream L (PR #151) at this stream's request: ranking diagnostics. |
| The `/uploads` paragraph with a key placeholder | OAuth briefing | **Dropped** by stream L (PR #151): an OAuth client cannot follow it. |

Refusals are left as they were, deliberately. An id the caller cannot read and an id that does not exist get the same marker, byte for byte, so the response does not tell one from the other. That property is pinned by the existing uniform-marker tests, and this round removed no field from one branch of a refusal and not the other.

One follow-up, not changed here: `drillDown.exemplarText` repeats the result's own `recipe` text, and its hint says "re-check", which sends a reader to the write path. It's on the backlog as part of the drill-down hint fix.

## No plan or upgrade language

OpenAI: "Plugins must not display subscription plans, initiate new subscriptions, or promote upgrades." ([plugin-guidelines.md](https://developers.openai.com/plugins/plugin-guidelines.md)) The one place Soup.net's tool surface named a plan was the opt-in synthesis feature: the `synthesize` parameter's description began "Premium opt-in", and its refusal read "Synthesis is a premium feature — not enabled for this account." Both now state what happens: "Opt-in: distil results into one short preference profile …" and "Synthesis is off for this account; the results below are not synthesised." A test checks `tools/list` on both servers and the refusal text for plan, upgrade, pricing, trial and checkout wording.

## The profile tool

`get_profile` takes no parameters and returns the connected account: `id`, `email` and `displayName` as separate fields in `structuredContent`, and as text. It is flagged `_meta["openai/profile"]: true`, so ChatGPT can tell two connected Soup.net accounts apart. Other clients see an ordinary read-only tool.

- **`id` is the person's user id.** It's stable, never reassigned, and the same for every key and OAuth grant the person holds, which a key id would not be. It's opaque: a UUID that carries no meaning.
- **It reads only the caller's own user row, from the authenticated principal.** It takes no input, so no id can be asked for, and a call with any argument is refused.

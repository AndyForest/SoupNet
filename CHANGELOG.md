# Changelog

What changed for people who use the hosted service at [soup.net](https://www.soup.net) or self-host this codebase. One entry per production deploy, newest first, with the pull requests that shipped in it. Soup.net deploys from `main` and has no numbered versions; the deploy date is the version.

Two narrower logs exist beside this one: [`docs/architecture/ranking-changelog.md`](docs/architecture/ranking-changelog.md) records every change to the shipped ranking defaults, and [`docs/backlog-completed.md`](docs/backlog-completed.md) keeps the work-queue items as they were closed. The design history behind each feature is in the recipes the planning docs link to.

## In review, not yet deployed

- **`search_recipes` no longer takes `feedback`.** Search can no longer write a feedback row. A call that still sends it is refused and told to use `log_feedback`, which takes `search_id`; `check_recipe` keeps its `feedback` parameter.
- **Intent link** (#6a, stream B): a recipe records the task it was deposited under (`traces.intent_id`), and search gains an `intent:` qualifier, so a task's whole lineage is one query.
- **Report read paths** (#140): `GET /intents`, `GET /intents/:id` (what a task's checks were shown, deposited and concluded) and `GET /feedback/rows`, under the API key, scoped to the caller's own fleet. Built for the behaviour-change figure the README's field-data section still quotes from July.
- **Briefing rewrite** (#138 and a second commit): a Drafts section, "a returned recipe is a call someone made in their context, not a rule", evidence standards, and the explicit over-caution line (drafts are for calls the context does not settle, not for every call).
- **Drafts as a bus** (slice 10): a draft stays live while the task that asked it was active in the last 24 hours, then leaves the queue and default listings without being deleted; check and search results name a nearby open question the caller may be able to settle.

## 2026-10-25

Agent-side draft resolution and the tool shapes the field asked for. #137, #139.

- **Resolve a draft from the agent.** `verify_draft` (and `POST /recipes/:id/verify`) takes `outcome: verified | rejected | not_chosen`, under the same authority and the same new-evidence rule as verifying. Until now an agent could deposit a draft but only the person's review queue could close one; nine of eighteen drafts from one piece of field work sat unresolved for that reason. A resolved draft leaves results and the queue and stays readable by id with its resolution.
- **Search includes your own recipes by default.** `search_recipes` used to exclude the caller's own recipes, which read as "no prior judgment" when the judgment was the caller's own. `author:` still narrows; `-author:me` restores the old behaviour. Re-read any brief or script that passed `author:anyone` to work around this.
- **Unknown parameter names are refused** with the names the tool takes, instead of being silently dropped. A `limit` or `group` argument that did nothing before now errors.
- **`get_recipes` accepts a JSON array** of ids as well as one id.
- **`log_feedback` reports every failing field at once**, with the accepted values in the description; an `outcome` row may carry only an intent id, for reporting a task's result rather than one check's.
- **Briefings carry an id** that feedback rows can target, so copy changes to the briefing can be measured.
- **Prose parentheses in a search query read as text**, not as grouping.
- Stdio server: `verify_draft` gains the same `outcome` parameter; `log_feedback` matches the remote tool.

## 2026-10-21

Headless keys, the drafts copy pass and the browser regression suite. #120, #121, #135, #136.

- **Headless API keys.** A key's deposit level can be set to drafts-only: every check through it lands as a draft, and the briefing it receives is written for an agent working unattended. For background agents, schedulers and sweeps that should propose and never assert.
- **Drafts copy and labelling** across the review queue, the dashboard card, the deposit notice and the detail page, from the first weeks of field use.
- **Playwright regression suite** for drafts, run against a local stack: slices 3 to 5 and the post-merge follow-ups, at desktop and phone widths, with accessibility findings grouped by impact.
- Local test gate made reliable: in-process test users, the OAuth race, clock-stepped revocations.

## 2026-09-27 and 2026-09-28

Drafts, triage ratings, deciding by building both, corpus import, bot protection, and a security round. Four deploys over two days. #96 to #119.

- **Drafts.** `check_recipe` takes `draft: true` for a hypothesis the agent could not settle from its context. A draft is visible only to the person it is about and their own agents, appears on no shared surface, and waits in a **review queue** at `/app/drafts` where the person confirms or rejects it in one click. Design: [`docs/planning/drafts-and-triage.md`](docs/planning/drafts-and-triage.md). #100
- **Impact and uncertainty ratings** on every check, recorded for triage and never used in ranking. #100
- **Build both.** When nobody can decide yet, an agent deposits both options as linked drafts with the rubric set in advance, builds and measures both, verifies the winner and marks the other not chosen. #100
- **Drafts on behalf of another person.** Any agent may deposit a draft about a collaborator; it is readable only by that person and their agents, and by the depositor, until the person verifies it, at which point it becomes theirs. #117
- **Corpus import** (`POST /import`) accepts the file that `GET /auth/me/export` produces. Import creates rows and never overwrites: your own corpus re-imports idempotently, a corpus whose ids belong to someone else gets fresh ids with the mapping reported. By default it creates a new recipe book. #117, #119
- **Cloudflare Turnstile** on signup, password reset, verification resend and waitlisted sign-in, optional for self-hosters and off without the keys. #113, #118
- **Account deletion preserves co-authors' recipes** in shared books; invitations follow membership; one key-authentication primitive whose scope follows live membership; one membership condition and one-statement trace access across the read paths. Findings F50, F65 to F75, F90, F96 to F103 from the security audits. #96, #97, #98, #110, #115, #119
- **Long-lived local embedding cache** for developers, with harvest, tiered verified backups and a restore test, so dropping a dev database no longer drops the vectors you paid for. [`docs/workflows/embedding-cache.md`](docs/workflows/embedding-cache.md). #106, #107
- Browser verification harness (Playwright) with device-width overflow checks and second-actor contexts; test-data cleanup that keeps the long-lived eval accounts. #101, #108, #116
- Operator logging for the signup cap. #111

## 2026-09-20

- **Human recipe-book access in one module**, guarded in CI: every path by which a signed-in person reads or writes a book goes through the same condition. #90
- Organization accounts program documented (design only, not built). #89

## 2026-08-24

Cold-start v2: what a new agent sees in its first minute. #76 to #79.

- **Declared intents.** An agent states its task once and carries the returned `int_` id on checks, searches and feedback; recipes already delivered to that intent render as id stubs, and feedback joins to the task. The session mechanism stays but intents are the way forward.
- **Surface-profiled briefing.** MCP clients get a thin index that fits their tool budget; the web gets the full artifact. The same text, trimmed to the surface.
- **Honest exemplars and zero-result disclosure.** A check that finds nothing says so, and a thin corpus is called thin. Lookup prefixes: `get_recipes` and `GET /recipes` resolve short ids of eight or more characters, the form docs and pull requests cite.

## 2026-08-20

- **Recipe search.** `search_recipes` and the check page's `filter` parameter: read-only search over the same corpus with the same ranking and a structured, Gmail-shaped query grammar (quoted phrases, uppercase `OR` groups, `author:`, `after:`, `before:`, with `impact:`, `uncertainty:` and `is:draft` added since). Built for reading collaborators' judgment, such as the area a pull request touches. Design: [`docs/planning/recipe-search-design.md`](docs/planning/recipe-search-design.md). #71
- Runtime dependency updates closing every Dependabot alert in scope. #72

## Earlier

The connectors-directory listing on claude.ai (2026-08-19), local and offline embedding providers (ADR-0023, 2026-07), the ranking-lever program (2026-07, in the ranking changelog), remote MCP over Streamable HTTP with OAuth 2.1 (ADR-0021), and the public launch (2026-07-02) are recorded in [`docs/backlog-completed.md`](docs/backlog-completed.md) and [`docs/adr/`](docs/adr/).

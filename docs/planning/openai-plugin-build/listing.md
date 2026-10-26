# OpenAI plugin directory, stream L: listing and copy

Plan: [../openai-plugin-directory.md](../openai-plugin-directory.md) (on `plan/openai-plugin-directory`, draft PR #148), items 9, 15 and 16 and the stream L row. Research brief with every source: the companion repo's `docs/briefings/openai-chatgpt-app-distribution-2026-10-26.md`. Format rules re-read from OpenAI's [build](https://developers.openai.com/plugins/build/plugins.md) and [submission](https://developers.openai.com/plugins/deploy/submission.md) pages on 2026-10-26.

Session `c-briefing`, agent `c-listing-2026-10-26`, Soup.net intent `int_SjdqJR6K8363JzVMO1C3ESZF` (`soupnet-oss`). Branch `plugin/listing-package`, merging last, after T and O.

Ownership this round: the parts of `packages/domain/src/recipe-guide-content.ts` outside `MCP_TOOL_DESCRIPTIONS` and `MCP_PARAM_DESCRIPTIONS` (those are T's), and `docs/connectors/index.md`. A listing need that touches a tool description goes to `d-tool-shapes` as a message, not an edit.

## Rubric

Written 2026-10-26, before implementation. Each row is graded met, not met, or partial, with the evidence named.

| Row | What is true when it's done | How it's checked |
|---|---|---|
| L1 | The privacy policy names, for each category of personal data it keeps (account, content, drafts and intents, the check log and feedback, uploads, embeddings, connections and keys, technical and audit data, email records, backups), the purpose, the recipients, and a retention timeline. Every timeline is a number or an event (account deletion), and each comes from code or the deployment configuration, cited in this file. Where no number exists today, the gap is a question for the operator, not an invented figure. | Read against the sources table below. |
| L2 | The privacy policy says what a connected AI app (ChatGPT, Codex, Claude, any MCP client) sends to Soup.net and receives from it: the recipe text and evidence its agent submits, and the recipes from books the person granted. It says that app's own policy governs the conversation on its side. | Read. |
| L3 | The privacy policy names the user controls: export, deletion (immediate, plus the backup window), the check log at `/app/checks`, the review queue, revoking a connection from the API Keys page or the AI app, and choosing books at connect time. | Read; each control exists in the app. |
| L4 | The terms say the same about connected AI apps in one short clause (an app's own terms govern it; the person's own agents act under their account, as §2 already says), and both pages' effective dates move. | Read. |
| L5 | `plugins/soupnet/skills/recipe-check/SKILL.md` has `name` and `description` frontmatter and carries the when-to-check moments, the recipe voice (the user's taste and judgment, a transferable role, evidence quoted and cited), drafts, search versus check, and closing the loop with feedback. No vendor-specific wording: no product names, no harness-specific tools beyond the Soup.net tools themselves. It points to `get_briefing` as the source of truth. | A test asserts frontmatter and a vendor-word scan; read for voice. |
| L6 | `.agents/plugins/marketplace.json` lists the plugin as a local source at `./plugins/soupnet`, installation `AVAILABLE`, authentication on install, category matching the manifest. | A test parses it and resolves the path to a directory with `plugin.json`. |
| L7 | `plugins/soupnet/` is the one source for the ZIP and the Codex marketplace: `plugin.json` (Agent Plugins schema, `extensions["com.openai"]` with `interface`, `review` and `publication`), `mcp.json` (one `streamable-http` server at `https://mcp.soup.net/mcp`, `auth` `oauth` with `client.mode` `dcr`, no headers, no secrets), `assets/` (square logo and composer icon of at least 48 px), `skills/`. | The validation test below. |
| L8 | `scripts/build-openai-plugin.mjs` builds `dist/openai-plugin/soupnet-<version>.zip` from `plugins/soupnet/` reproducibly: sorted entries, fixed timestamps, so two runs give the same bytes. It validates before zipping and refuses on any failure. Nothing named `test_credentials` or `reviewer_instructions`, and no `apps`, `.app.json` or hooks. | Run twice and compare hashes; a test runs the validator. |
| L9 | The manifest meets every submission limit: `name` kebab-case at most 64; `displayName` and `shortDescription` at most 30; `longDescription` and `description` at most 4,000; up to three unique `defaultPrompt`s at most 128 each with no `@`; four HTTPS URLs at most 1,024 (`websiteURL`, `supportURL`, `privacyPolicyURL`, `termsOfServiceURL`); `capabilities` present; `brandColor` at least 2:1 against white and `brandColorDark` at least 2:1 against `#212121`, both computed with the WCAG formula. | The validation test computes each. |
| L10 | Listing copy follows the corpus's listing rulings (`7fab88bc`: "taste and judgment" paired, recipe checks named; `bb2d12e3`: lead with the gain and carry both pillars, one person across their agents and people sharing books; `249d7dae`: fragmentation, never amnesia; `a820ec6e`: the cross-vendor point explicit) within OpenAI's rules (no comparisons, pricing, trials or promotion, no steering toward or away from other plugins, no "MCP" or "Plugin" in the name, no implied endorsement). Where the two pull apart, the call is recipe-checked. | Read; recipe ids recorded here. |
| L11 | Five positive test cases (`description`, `prompt`, `tools_triggered`, `expected_behavior`) and three negative (`description`, `prompt`), each self-contained and order-independent, checking shape rather than wording, and runnable against a reviewer account with a "Directory Review" book of about five sample recipes. Negative cases cover a request Soup.net must not act on and say what the assistant does instead. | The test checks counts and fields; read for independence. |
| L12 | The connect page's ChatGPT section matches today's product: the custom MCP server path (Plugins, Add custom MCP server), full MCP on Business, Enterprise and Edu (web), Pro read-only for custom servers, Free and Plus not named; "Team" and "Developer Mode" gone. A Codex section gives the `config.toml` OAuth form, `codex mcp login`, and the repository marketplace. The directory listing link waits for approval (plan, operator step 8). | Read against the brief's help-center sources. |
| L13 | Agent-facing copy in `recipe-guide-content.ts` changes only if L12 makes the keys page's Codex text wrong; any change lands with a spec-decision-log entry giving bytes before and after. | Diff. |
| Z1 | `npm run test:ci` passes; the build script runs clean; the ZIP is not committed (`dist/` is ignored). | Gate output. |

## Retention sources

Each timeline in the privacy policy's §8, beside what it comes from. Code paths are on `main` at `5b81097` unless this branch changes them; infrastructure is the companion repo's Terraform and its operations runbook (`docs/operations/rds-backups.md`).

| Policy line | Timeline | Source |
|---|---|---|
| Account data, recipes, evidence, references, drafts, intents, feedback, memberships | until the item or the account is deleted | `services/user-delete.service.ts` header ("Hard-delete a user account and ALL data attributable to it"); `intents.user_id` "onDelete: cascade" (`packages/db/src/schema/intents.ts`) |
| API keys | hashes until account deletion; daily keys stop at midnight UTC | `services/api-key.service.ts` ("Generate a daily key that expires at midnight UTC"); `GET /keys` lists only "expires_at > NOW()" |
| OAuth access and refresh tokens | 1 hour, renewed for up to 30 days; rows deleted 30 days after expiry | `services/oauth.service.ts`: `ACCESS_TOKEN_TTL_SECONDS = 60 * 60`, `REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60`, `OAUTH_KEY_SWEEP_DAYS = 30` |
| OAuth sign-in codes | deleted 1 day after expiry | `OAUTH_CODE_SWEEP_DAYS = 1`, `AUTH_CODE_TTL_SECONDS = 5 * 60` |
| Unused app registrations | 30 days | `OAUTH_CLIENT_SWEEP_DAYS = 30` ("only never-authenticated registrations … are swept") |
| Display history | 30 days | new on this branch: `services/display-history.service.ts`, `DISPLAY_HISTORY_RETENTION_DAYS = 30`; every reader looks back 7 days (`trace.service.ts`, `intent.service.ts`: "shown_at > now() - interval '7 days'") |
| Audit log, including the check log | unchanged wording, no timeline yet | nothing deletes `audit_log` rows, and account deletion keeps them ("append-only trail outlives the actor", `user-delete.service.ts:99`); question 1 below |
| Email records | 60 days | `services/email.service.ts`: `EMAIL_LOG_RETENTION_DAYS = 60` |
| Waitlist accounts | 30 days unverified | unchanged from the existing policy (`services/waitlist.service.ts`) |
| Application logs | 14 days | `infra/terraform/modules/ecs/main.tf`: `retention_in_days = 14`; the MCP request line logs "status … origin … ua" (`routes/mcp.ts:1460`) |
| Load balancer access logs | 30 days | `infra/terraform/modules/alb-access-logs/main.tf`: `log_retention_days` default 30, not overridden in `environments/dev` |
| Backups | 35 days point-in-time; daily 14, weekly 35, monthly 365; a second-region copy on the same schedule | runbook: "Point-in-time restore, 35 days", "daily, kept 14 days; weekly (Sunday), kept 35 days; monthly (the 1st), kept 365 days", "A second-region copy of every snapshot … with the same retention" |

## Questions for the operator

Asked as draft recipes under this stream's intent; numbered here from 1.

1. **How long the audit log keeps what** (draft `2d85dbc2`). Nothing deletes `audit_log` rows today, account deletion keeps them on purpose, and the same table is the check log at `/app/checks`. Recommendation: the check log (recipe checks, searches, briefings) is kept while the account exists and deleted with it; security events (sign-ins, password and key changes, deletions, with IP addresses) are kept 12 months, matching the monthly backups and the CloudTrail bucket, and anonymized on account deletion as the backlog's audit-log item already decided (null the actor, redact free text). Building it is a throttled sweep plus one deletion step, reviewed by the audit coordinator. Until the ruling, the policy keeps its current audit-log line.
2. **The listing's 30-character subtitle** (draft `3ca50187`). Recommendation: "Taste and judgment, shared" (26). It carries the pair and both pillars; alternatives in the draft.

## Build notes

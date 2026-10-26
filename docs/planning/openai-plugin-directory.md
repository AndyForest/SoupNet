# OpenAI plugin directory: listing Soup.net for ChatGPT and Codex

Status: plan, 2026-10-26, ruled by the operator ("get the OpenAI plugin work done. Do our process"). Research brief with sources is in the private companion repo (`docs/briefings/openai-chatgpt-app-distribution-2026-10-26.md`); this document carries what a self-hoster or contributor needs: the server changes, who builds them, and the order. Decision recipes: `788ca0fc` (target the directory by hardening the one server), `26591199` (sessions push their own branches, squash merge).

## What this is

OpenAI's **plugin** (the 2026 name; the Apps SDK and ChatGPT app directory were folded into it) is a package of skills, a remote MCP server, or both, published through one directory shared by ChatGPT and Codex. "Custom UI is not required for an MCP server." Soup.net's remote MCP server at `/mcp` with OAuth 2.1 already fits the MCP-server-only shape. What remains is a review-driven checklist on the server, a listing package, and operator steps in OpenAI's portal.

The same server serves claude.ai's directory today. Nothing here forks it for one vendor: every change below is an MCP or OAuth standard that makes the server more correct for every client.

## What the server must change

Checked against `apps/backend/src/routes/oauth.ts`, `services/oauth.service.ts` and `routes/mcp.ts` on 2026-10-26, and against OpenAI's auth page the same day.

**Required by OpenAI (build these)**

1. **Audience-bound tokens.** ChatGPT sends `resource=<MCP server URL>` on the authorize and token requests. Copy it into the access token (`aud`), verify audience on every MCP request, reject tokens with the wrong or missing audience, and make the protected-resource metadata's `resource` value the canonical URL ChatGPT sends (confirm live whether that is `https://mcp.soup.net` or `https://mcp.soup.net/mcp`; the AS `issuer` must equal the PRM `authorization_servers` entry byte for byte). Today the token endpoint ignores `resource`.
2. **Domain challenge file.** Serve the portal's token as plain text at `/.well-known/openai-apps-challenge`, read from an environment variable (`OPENAI_APPS_CHALLENGE_TOKEN`; empty means 404), so the operator can set it without a code change.
3. **Tool annotations with written justifications.** All eight tools already carry `readOnlyHint`, `destructiveHint` and `openWorldHint`; the portal rejects a tool where any is missing or null, and the review compares each flag with behaviour. Write the justification for each flag of each tool in `docs/connectors/openai-plugin.md`. Decide `update_recipe_book_description`: OpenAI's guidelines call overwriting destructive and say undo-ability does not justify `false`; it is `false` today. Recommended: flip it to `true` and say why in the description (the agent then gets a confirmation prompt under the user's default permission, which for a standing-context field is right).
4. **Tool descriptions in the reviewed shape.** Each description says when to use the tool and when not to; no promotional wording; the description matches the schema and the hosted behaviour exactly (a description that claims more than the server does is the most common rejection). The size caps in `mcp-tools-list-size.test.ts` and `mcp-tool-descriptions.test.ts` still apply; move a cap only with a dated reason.
5. **Server `instructions`.** The first 512 characters carry the cross-tool guidance: check before a judgment call, log after a decision, close the loop with feedback, resolve drafts you can settle.
6. **Output minimisation, with the product's semantics kept.** OpenAI rejects "undisclosed user data returned": internal ids, request ids, debug payloads, emails not needed for the task. Audit every tool's output. Keep what the product is: recipe ids (the handle for follow-up calls), judgment dates (`decided_at`, "newest judgment"; a judgment log without dates is not one), authors in shared books (the briefing tells the agent to name them), session and intent ids (they drive id-stub rendering). Drop or gate anything that is diagnostic only. Write the reasoning in the justification document so the reviewer reads it before the scan.
7. **No plan or upgrade language in tool output.** Audit any `paid_user` gating messages; plugins may not promote upgrades or link to checkout.
8. **Refresh tokens.** Confirm the 2026-07 "`invalid_grant` after one hour idle" report is fixed, with a test that idles past expiry and refreshes; a reviewer who pauses will hit it.
9. **Privacy policy and terms pages** state categories of personal data, purposes, recipients (AWS, Google Gemini), retention timelines, and user controls (export, deletion, the check log at `/app/checks`). The privacy page has no retention text today. Four HTTPS URLs are required: website, support, privacy, terms.

**Recommended (build in the same round; each is a standard)**

10. **RFC 9207 `iss`** on every authorization response, success and error, and `authorization_response_iss_parameter_supported: true`; with it ChatGPT uses one stable redirect URI. The `iss` value equals the metadata `issuer` exactly.
11. **Client ID metadata documents (CIMD)**: `client_id_metadata_document_supported: true`; accept `client_id = https://chatgpt.com/oauth/client.json` (and the callback-specific variant) with `token_endpoint_auth_method` `none` or `private_key_jwt` verified against `https://chatgpt.com/oauth/jwks.json`. OpenAI prefers CIMD and falls back to DCR. Publish `token_endpoint_auth_methods_supported`.
12. **Per-tool `securitySchemes`** and `_meta["mcp/www_authenticate"]` on an unauthenticated tool call, so account linking triggers at tool level.
13. **A profile tool** flagged `_meta["openai/profile"]: true`, returning a stable opaque `id`, with email and display name as separate fields, so ChatGPT can tell two connected Soup.net accounts apart.
14. **`openid` and `email` scopes with a UserInfo endpoint** returning `email` and `email_verified: true`; required only for Enterprise workspace domain restrictions, cheap now.
15. **A bundled skill** `skills/recipe-check/SKILL.md` for Codex, which has no briefing hook: the when-to-check moments and the voice rules, no vendor-specific wording.
16. **Codex marketplace file** `.agents/plugins/marketplace.json` in this repository, so a Codex user can install from the repository with no review.

**Not needed**: UI widgets, screenshots, `search` and `fetch` tools, a stdio path.

## Who builds what

Three streams, each in a session that already holds the context, each on a branch it creates and pushes itself (draft PR; `main` moves only by the operator's merge and deploy approval; no force-push over a pushed branch; bring `main` in with a merge commit). Rubric first, in a file per stream under `docs/planning/openai-plugin-build/` (`oauth.md`, `tool-contract.md`, `listing.md`), so the streams never append to one file. Recipe-check the calls; questions for the operator go in as drafts under the stream's intent; verifier and audit coordinators run concurrently as in the drafts round.

| Stream | Session | Scope | Branch |
|---|---|---|---|
| **O** OAuth | `e-read-paths` (REST and auth surface context) | Items 1, 2, 8, 10, 11, 12, 14. The security workflow applies: read the latest audit in the companion repo's `docs/security/` first; every auth change gets a test; the auditor is not the builder. | `plugin/oauth-hardening` |
| **T** Tool contract | `d-tool-shapes` (8a tool shapes, descriptions, size caps) | Items 3, 4, 5, 6, 7, 13. The justification document is a deliverable beside the code. | `plugin/tool-contract` |
| **L** Listing and copy | `c-briefing` (briefing and connect-page copy) | Items 9, 15, 16; the ZIP package (`plugin.json`, `mcp.json`, square logo, `composerIcon`, `brandColor` with contrast checks); listing copy (30-character name and subtitle, 4,000-character description, three starter prompts under 128 characters, no `@` mentions); the five positive and three negative test cases; the connect page's ChatGPT and Codex sections with the plan list corrected ("Team" is now Business; Pro is read-only for custom servers; Free and Plus are not named for custom servers). | `plugin/listing-package` |

Shared files: `routes/mcp.ts` (O touches the 401 challenge and `securitySchemes`; T touches descriptions and annotations; coordinate by hunk, T merges first); `packages/domain/src/recipe-guide-content.ts` (T owns the `MCP_TOOL_DESCRIPTIONS` and `MCP_PARAM_DESCRIPTIONS` blocks and adds a server-instructions constant in its own file; L owns the rest and asks T for any description change); the size-cap tests (T moves caps as measured, dated; stream B's 8b branch leaves the shared-descriptions cap 7 characters of headroom, so expect a move); `docs/connectors/index.md` (L only). No migrations expected; if one is needed, claim the number when the branch is first pushed.

Merge order: T, then O, then L. One deploy approval after the three. Then the operator's portal steps.

## What the operator does

Personal steps, in order; none can be delegated:

1. On platform.openai.com choose the organisation and a project **without** EU data residency. Decide the developer identity: individual verification (government ID and selfie) publishes under your name; business verification (legal name, registered address, registration or tax number) publishes under "Soup.net". Confirm you are an organisation owner.
2. Merge T, O and L; approve the deploy.
3. In the portal: Plugins, Create plugin, With MCP, `https://mcp.soup.net/mcp`. Copy the domain token to the OAuth session, which stages the environment variable in the companion repo's Terraform; apply; redeploy; Verify Domain.
4. Authentication: OAuth, client registration DCR (or CIMD once O ships it). Connect with your own account; Scan Tools; paste the Issues panel to the tool-contract session.
5. Provision the reviewer account on production: admin invite, verified email, a "Directory Review" book with about five sample recipes, a password you will hand to reviewers, no MFA, no email code at login. Credentials go only into the portal's Review details.
6. Run the eight test cases against the reviewer account; record the short demo video; upload the ZIP; submit with the attestations.
7. Watch email; forward any rejection text to the planning session. No expedite requests.
8. On approval: Publish, set countries. The listing session then adds the plugin link to the connect page and the keys page.

## Open questions carried from the research

Plan gating of write plugins on Free and Plus; EEA, Swiss and UK availability; review timeline (one write-up says nine days); whether a fee exists (none found); whether the `resource` value carries the `/mcp` path; the package-ordering contradiction in OpenAI's docs (create With MCP first, then upload the ZIP for metadata and skills is the reading). None blocks the build; the portal answers most of them at step 3.

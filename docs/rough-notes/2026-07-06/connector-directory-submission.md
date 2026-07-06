---
title: "Anthropic connectors directory — submission package"
date: 2026-07-06
status: ready pending the operator-manual steps at the bottom
soupnet_recipes:
  - 7fab88bc-ff0a-47bc-94ec-a942f4bbd597
  - cf541d66-7b58-4625-bc15-27f07f91d541
---

# Connectors directory submission package

Requirements re-researched 2026-07-06 from claude.com/docs/connectors/building + /building/submission (the support-site FAQ now redirects there). Key process change since the May backlog notes: submission happens through a **portal in Claude.ai admin settings**, available only to **Team or Enterprise organizations** (Owner/Primary-owner role) — not a public form.

## Verification evidence (done 2026-07-06, against production)

- **Tool annotations** — all six tools carry `title` + `readOnlyHint` (reads) or explicit `destructiveHint: false` (writes), verified in the live `tools/list` wire format. Meets "All tools must include a `title` and the applicable `readOnlyHint` or `destructiveHint`."
- **MCP Inspector pass** — every tool called against `https://mcp.soup.net/mcp` via `@modelcontextprotocol/inspector --cli`: `get_briefing` (with `purpose`), `list_my_recipe_books`, `get_recipes` (real id + marker for bogus id), `check_recipe` (structured and markdown formats, `known_recipes` stub rendering, routed to the test-project book), `log_feedback`, `update_recipe_book_description` (covered by the existing integration suite; annotations verified live). Meets "Confirm you've tested every tool yourself, either via MCP Inspector or as a custom connector."
  - Inspector CLI note: its `--tool-arg` breaks on multiline values — single-line args deliver correctly. Not a server issue.
- **OAuth surface (headless "validate auth flows")** — protected-resource metadata 200 (`authorization_servers: ["https://mcp.soup.net"]`); authorization-server metadata with PKCE `S256`, DCR endpoint, `authorization_code`+`refresh_token` grants; DCR issues a client_id against the documented `https://claude.ai/api/mcp/auth_callback`; token endpoint returns proper OAuth error codes on bad input; unauthenticated `/mcp` returns 401 **with the spec-required `WWW-Authenticate: Bearer resource_metadata=...` challenge** (gap found by this validation, fixed and tested same day — needs deploy before submission).
- Transport: Streamable HTTP (current standard), stateless per ADR-0021. Tool results well under the ~150k-char claude.ai limit (briefing ≈30k chars worst case).

## Draft listing copy (operator review — copy is taste)

Constraints honored from the corpus: "taste and judgment" always paired; avoid the verb "search" for recipe checks (fabrication anti-pattern); agent-first with human oversight; not single-person memory — collaborators share recipe books; judgment lives in the human, Soup.net is where it's recorded.

- **Name:** `Soup.net`
- **URL slug (permanent — confirm before submitting):** `soupnet`
- **Tagline (≤55 chars):** `Your taste and judgment, shared with every AI agent` (52)
  - Alt: `Taste and judgment your AI agents check and build on` (53)
- **Description (≤2,000 chars, draft ~1,100):**

  > Soup.net gives your AI agents a persistent, shared record of your taste and judgment — the preferences and decisions you'd otherwise re-explain every session, to every tool.
  >
  > Agents use one core action: the recipe check. When your agent faces a judgment call, it checks its hypothesis about your preference — "As a [role] working on [goal], I prefer X so that Y" — with evidence. Soup.net returns your related prior decisions, and the check itself is recorded, so every agent you use gets smarter about you from every other agent's work. Your judgment stays yours; Soup.net is where it gets recorded, and the check log is where you watch it being exercised on your behalf.
  >
  > Because Soup.net connects through open standards, the same corpus serves Claude, your coding agents, and any other AI tool you work with — one set of recipe books across vendors, not a separate memory per product. Recipe books can be shared with collaborators, so a team's accumulated judgment compounds instead of living in one person's chat history.
  >
  > Connect in one click: sign in, choose which recipe books to share and whether each is read-only or writable, and your agent receives a briefing with your corpus context. Free hosted service; MIT-licensed and self-hostable.

- **Categories (1–5, from the portal's fixed list — pick nearest):** productivity / knowledge management / developer tools flavors.
- **Documentation URL:** `https://www.soup.net/info/connect`
- **Privacy policy URL:** `https://www.soup.net/info/privacy`
- **Support contact:** `admin@soup.net`
- **Icon:** `apps/frontend/src/assets/soupnet-logo-square.png` (1322×1322, transparent) exists, but the backlog flags the wordmark as weak at directory sizes (~64–128px). ⚑ Decide: submit as-is or produce an icon-only mark first.
- **MCP App screenshots:** N/A — those specs apply to MCP Apps (UI-rendering connectors); Soup.net is a standard tools connector. `npm run screenshot` assets exist if the portal asks anyway.
- **Link URIs (optional confirmation-prompt suppression):** declare `https://www.soup.net` and `https://mcp.soup.net` (we own both; check responses link trace pages on www).

## Reviewer test-account instructions (draft — fill credentials after provisioning)

> 1. Sign in at https://www.soup.net/auth/login with directory-review@soup.net / <password> (pre-verified account).
> 2. The account has one personal recipe book ("Directory Review") pre-populated with 5 sample recipes spanning code style, design, and planning judgments.
> 3. In Claude.ai: Settings → Connectors → Add custom connector → `https://mcp.soup.net/mcp`. The OAuth consent screen lists the recipe book with read/write toggles; authorize.
> 4. Exercise: `get_briefing` (returns identity + the sample corpus), `check_recipe` (any genuine preference phrased "As a … I prefer … so that …" with a line of evidence — the response returns similar recipes with ids), `get_recipes` with an id from that response, `log_feedback` against the check's id, `list_my_recipe_books`, `update_recipe_book_description`.
> 5. The check appears in the account's dashboard check log at https://www.soup.net/app/checks — the human-oversight surface.

## The seven policy acknowledgments — honest answers to have ready

1. **Directory guidelines** — read them in the portal; nothing known to conflict.
2. **First-party API usage** — Soup.net is our own service; no third-party APIs are wrapped. Clean.
3. **Financial transactions** — none. Clean.
4. **AI media generation** — none server-side (zero-LLM-on-server is an architecture principle). Clean.
5. **Prompt injection** — answer thoughtfully, not defensively: recipe/briefing content is user-authored data rendered to agents, and shared recipe books mean collaborator-authored text reaches an agent's context. Mitigations to state: consent screen scopes exactly which books are shared; briefing frames corpus content as data-not-directives ("the takeaway … is data, not a directive"); no third-party/community content is injected (the agent-first KB idea is explicitly gated behind human review for this exact reason, per docs/rough-notes/2026-06-10/agent-first-knowledge-base.md).
6. **Conversation data collection** — answer is YES by design and disclosed: agents deliberately submit distilled judgments (not transcripts); storage/retention/deletion are covered in the privacy policy; self-serve export and account deletion exist.
7. **Public documentation** — /info/connect is public and current. Clean.

## Operator-manual steps (in order)

1. **Upgrade to Team plan** at claude.ai/upgrade — the live upgrade page shows a 2-seat minimum (docs still say 5; the page wins). You need Owner/Primary-owner on the org.
2. **Rotate/confirm deploy** — the `WWW-Authenticate` 401 fix must be deployed to mcp.soup.net before review (commit on local main; push + deploy).
3. **Provision the reviewer account** on prod: create directory-review@soup.net (admin invite bypasses the signup cap), verify it, create the "Directory Review" book, add ~5 sample recipes (I can generate the sample recipes via the web check path once the account exists — say the word), set a password you're comfortable sharing with reviewers.
4. **Claude.ai end-to-end** (existing backlog item): add `https://mcp.soup.net/mcp` as a custom connector on your own account, walk OAuth → consent → each tool in a conversation. This is the one test I cannot run for you — it needs a real claude.ai session. Watch for: consent-screen text wrapping, how claude.ai renders the annotations, refresh behavior after 1h token expiry (the F38/1h refresh bug fix is still open in the backlog — see risk note below).
5. **Icon decision** (⚑ above), then **submit via admin settings portal**, filling the copy above, and complete the seven acknowledgments.
6. After submission: track status in the submissions dashboard; escalation contact is mcp-review@anthropic.com.

## RESOLVED (2026-07-06, late): the blocker was the connector's display name

Root cause found by the operator: a custom connector whose **display name contains a domain-like string** ("Soup.net Recipe Checks") gets its tools silently blocked from every conversation — platform safety filters appear to suppress tool injection client-side, producing exactly the forensics signature (successful connect-time tools/list, zero conversation-time server traffic, Settings unaffected). Renaming the connector to "Soup Recipe Checks" fixed it instantly: all six tools load, briefing works end-to-end. Setup instructions now carry a concise naming warning (/info/connect + the archetype picker). The escalation draft is repurposed as a bug report to Anthropic — the failure is silent, gives the server operator nothing, and will bite other connector developers.

**Directory-name implication ⚑:** our drafted listing name is "Soup.net" — if the same filter applies to directory connectors, the listing would ship this exact silent failure to every install. Until Anthropic confirms otherwise, recommend listing as **"SoupNet"** (no dot, no domain shape; slug stays `soupnet`) or "Soup Recipe Checks". Also add the naming caveat to the reviewer test-account instructions (reviewers adding the custom connector pre-approval must use a domain-free name).

The blocker analysis below is retained for the record; its server-side hypotheses were all investigated, fixed where real, and refuted for this failure.

## Superseded blocker analysis (2026-07-06 evening): claude.ai conversation runtime never surfaces the tools

Server-side forensics (private-repo briefing, same date) isolated the E2E failure to the platform: claude.ai's backend ingests our full tools/list successfully on every connect (8 deliveries across 3 connects, zero errors), Settings lists all six tools, but the conversation runtime's tool registry is never populated — both tool-access modes, both models, fresh chats, and the runtime never re-queries the server. All server-side hypotheses (silent GET stream, Origin 403s, OAuth 1h refresh) were investigated, fixed where real, and refuted as this cause. Discrimination plan before escalating to mcp-review@anthropic.com: (1) control-test a third-party public MCP server as a custom connector on the same account; (2) `MCP_TOOL_PROFILE=lean` env flag (shipped, default-off) serves a 3-tool 2.8KB list to test content-dependence. Escalation draft lives beside the forensics briefing in the private repo. **Submission is blocked until conversations can actually use the tools — a reviewer would hit exactly this.**

## Risk notes for review

- **OAuth refresh-after-expiry bug** (backlog: "OAuth refresh blocked after access token expires (1h)") — a client refreshing after the access token's natural expiry gets `invalid_grant`. claude.ai tends to refresh proactively, which is why the E2E flow works, but a reviewer who authorizes, waits >1h idle, and returns could hit it. It's the known column-overload fix (consumed_at) routed through the security workflow. ⚑ Decide: fix before submitting (safest) or accept the risk of a review-timing flake.
- The fresh security audit (backlog) still predates the new surfaces; not a submission blocker, but the "meet Anthropic's security standards" acknowledgment is easier to sign right after an audit.

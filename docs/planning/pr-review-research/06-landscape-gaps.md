# Research track 6: gaps in the PR-review landscape Soup.net might fill

Research for the PR review helpers plan (planning agent `a-pr-review-plan-2026-09-27`). Researched 2026-09-27 by `a-pr-review-research-landscape-2026-09-27`. Builds on [01](01-hosted-ai-reviewers.md), [02](02-agent-native-review.md), [04](04-preference-memory.md) and [../org-accounts-research/pr-review-integration.md](../org-accounts-research/pr-review-integration.md) (cited as "PRI"); facts already sourced there are cited, not repeated.

Method note: pages on code.claude.com came back as raw page text. Every other quote came back through a fetch tool that summarizes; the strings were returned as verbatim but are **(fetch-extracted)** and worth re-opening before public use. Search-snippet-only claims are marked **unverified**.

The operator's framing, verbatim: "It's hard to spin up a PR review automation system. What if you didn't need one?" and "How could soupnet contribute to other systems? For example, soupnet could be an mcp for Devin, which could fill in the gap that I don't think it has a decision log."

## Key findings for the plan

- **Standing up hosted review is an admin act, not a personal one.** Claude Code Review needs "the Owner or Primary Owner role in your Claude organization and permission to install GitHub Apps in your GitHub organization"; the Claude Action needs "admin access to the repository" plus a secret and a workflow PR; CodeRabbit needs "organization owner permissions"; Copilot auto-review on a repo needs a branch ruleset set by a repo admin. Setup cost falls on whoever holds admin, which is why teams rarely get past one bot.
- **The "no system" review already exists; what's missing is the shared part.** Every major vendor now ships a review that needs no repo-side install: Claude `/code-review` ("without installing the GitHub App"), Codex local `/review`, Copilot CLI `/review`, CodeRabbit CLI, Bugbot's `/review` skill, Copilot's personal "review the pull requests you create" setting, and Devin's `devinreview.com` URL swap. Each is private to one person. None carries one reviewer's taste and judgment to a teammate's review. That shared layer, with no shared infrastructure, is what Soup.net adds.
- **The operator's Devin hypothesis holds, and the timing is good.** Devin's documented Knowledge fields are name, trigger, content, scope, folder and repo pin; the docs "do not specify metadata like author, creation date, source attribution, or access to version history" (fetch-extracted). Knowledge is now "being migrated to Skills" (2026-09-21), and plugins "bundle skills, rules, hooks, and MCP servers into a single installable package" (2026-09-09). A Soup.net Devin plugin (one skill plus the remote MCP server) is the natural integration, and it matches report 02's thin-skill-plus-MCP shape.
- **No reviewer surveyed has a decision log.** The closest stores record facts or rules with partial provenance (Copilot Memory citations, CodeRabbit PR and user, Qodo source PR, per report 01). None keeps who decided, when, why in their words, and the evidence. That gap is uniform across the set, not specific to Devin.
- **Most agent platforms can already call Soup.net with a static header; OAuth is the uneven part.** Header auth works in Devin sessions, Copilot cloud agent and code review, CodeRabbit, Cursor cloud agents, Codex CLI/IDE/app, Kiro web, and the Claude Action. "Copilot cloud agent and Copilot code review do not currently support remote MCP servers that leverage OAuth" (PRI). So the integration depends on a long-lived, read-only Soup.net key a secret store can hold, which is drafts-and-triage slice 5 / PRI's no-deposit principal, not OAuth.
- **Hard blockers are few and specific.** Jules supports only a curated MCP list with API-key auth; Codex cloud has no MCP configuration (open community request, **unverified** against first-party docs); Graphite's MCP is a server, not a client; Devin Review and Claude's managed Code Review document no MCP (files only); Qodo's remote MCP is documented for its IDE agent, not its PR review. For these, report 04's repo-file export is the only path.
- **Positioning:** hosted bots stay the always-on layer; the person's own agent is the "no system" layer; Soup.net is the shared decision log both read. Soup.net should not try to become a bot.

## 1. No-setup review

### What standing up review automation takes today

| System | Who must act | What it takes (quote) |
|---|---|---|
| Claude Code Review (managed) | Claude org Owner plus GitHub App installer | "You need the Owner or Primary Owner role in your Claude organization and permission to install GitHub Apps in your GitHub organization." Billed separately: "Each review averages \$15-25 in cost" ([docs](https://code.claude.com/docs/en/code-review)) |
| Claude Code GitHub Action | Repo admin | "For either path, you need admin access to the repository." Then an app, a secret (`ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`) and a workflow PR; org rollout adds an org-level secret and "Add the workflow file to each repository". "When you install the app, you accept its full permission set. GitHub doesn't let you accept a subset." ([docs](https://code.claude.com/docs/en/github-actions)) |
| CodeRabbit | GitHub org owner | "you need **organization owner permissions**" to authorize for organization repositories; app wants read-write on "Checks, code, commit statuses, issues, and pull requests" (fetch-extracted, [docs](https://docs.coderabbit.ai/platforms/github-com)). Per-developer pricing in report 01 |
| Copilot automatic review (repo) | Repo admin, org owner or enterprise admin | Create a branch ruleset and "select **Automatically request Copilot code review**"; plan gate "Copilot Pro, Copilot Pro+, and Copilot Max plans, and with a Copilot Business or Copilot Enterprise license" (fetch-extracted, [docs](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/configure-automatic-review)) |
| Devin Review | GitHub org app install | "Write features ... require a GitHub App connection installed on your GitHub organization"; "PAT-based connections are read-only and cannot post comments" (fetch-extracted, [docs](https://docs.devin.ai/work-with-devin/devin-review)) |
| Kiro agent | Org owner | "The Kiro Agent GitHub app only needs to be installed once per organization or account" (fetch-extracted, [docs](https://kiro.dev/docs/autonomous-agent/github/)) |
| Copilot MCP for review | Repo admin | Settings > Copilot > MCP servers, secrets prefixed `COPILOT_MCP_` (fetch-extracted, [docs](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/extend-coding-agent-with-mcp)) |

### Zero repo-side install precedents

- Claude Code: "The `/code-review` command reviews a diff in your terminal without installing the GitHub App"; `--comment` "posts the findings on a GitHub pull request as inline comments"; "a scheduled task with `/code-review` as its prompt runs the review" ([docs](https://code.claude.com/docs/en/code-review)). On plans without managed review: "you can still review a diff locally" (same page).
- Codex local `/review`, a private draft that never reaches GitHub on its own (report 02 §2).
- Copilot CLI: `/review` lets you "analyze code changes without leaving the CLI" (fetch-extracted, [docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/agentic-code-review)). `gh pr edit --add-reviewer @copilot` requests a hosted review from the CLI (fetch-extracted, [changelog 2026-03-11](https://github.blog/changelog/2026-03-11-request-copilot-code-review-from-github-cli/)).
- Copilot personal setting: "You can set Copilot code review to review the pull requests you create, in any repository where Copilot code review is available to you" (fetch-extracted, [docs](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/configure-automatic-review)). This is the closest vendor precedent for "my agent reviews, no repo system": configured per person, not per repo.
- CodeRabbit CLI: "Get AI code reviews directly in your CLI before you commit", with "cr auth login"; "Claude Code now supports CodeRabbit through a native plugin" (fetch-extracted, [docs](https://docs.coderabbit.ai/cli)).
- Cursor: "Use the `/review-bugbot` or `/review` skills to run Bugbot from your agent before you push the code" (fetch-extracted, [docs](https://cursor.com/docs/bugbot)).
- Devin: "For any GitHub.com PR link, replace github.com with devinreview.com in the URL" and "Public PRs don't require a Devin account" (fetch-extracted, [docs](https://docs.devin.ai/work-with-devin/devin-review)).
- `gh` extensions give agents review-thread plumbing rather than review itself, e.g. `agynio/gh-pr-review` "adds full inline PR review comment support ... LLM-ready" (search snippet, [repo](https://github.com/agynio/gh-pr-review), **unverified**). Report 05 already covers `gh api` for pending reviews.

### Hypotheses

**H1. Setup friction is admin-gating, not technical difficulty.** For: every hosted path in the table needs an owner or admin, an app permission grant that can't be narrowed ("GitHub doesn't let you accept a subset"), and often a secret and a workflow PR per repo. Against: once an admin has done it, it's on for everyone, which a per-person path never achieves.

**H2. "No system" review is already viable for the review itself; the gap is shared taste and judgment.** For: seven vendors ship a personal, no-install review (list above), and Claude's can be scheduled or started by the agent itself. Each keeps its learnings private or vendor-side (report 04: learned layers are siloed per vendor and repo). Against: nothing in these tools stops each teammate's personal reviewer from applying different standards, and that inconsistency is the problem hosted bots plus repo files exist to solve.

**H3. Soup.net supplies the shared part without shared infrastructure.** What it adds: one person's agent logs a judgment (or a draft for the person whose call it is); a teammate's agent finds it with `search_recipes` while reviewing, from any MCP client, with no repo install and no admin. Setup moves from per repo, gated by an admin, to per person, done once in their own agent (one MCP entry plus a key), and it is reused across every repo and task. For: the corpus already records the operator's zero-setup principle for agents (recipe `1416ce64`, web page primary, MCP "for platforms where it provides lower friction"), and his "helpers, not another workflow" ruling (`103e6242`). Against, stated plainly:
- Coverage. A personal reviewer runs only when its person asks or a local schedule fires. A PR nobody picks up gets no review. Hosted bots don't have that failure.
- Every participant still needs a Soup.net account, a recipe book shared with the team, and an MCP connection. That is a per-person setup, and teammates who don't connect never read or add to the log.
- The judgment only compounds if people's agents actually write it. The drafts loop in the plan is what makes that happen; without it, "no system" is just N private reviewers.
- Security moves to the laptop: report 05's `claude -p` loading the PR branch's hooks and `.mcp.json` applies to every personal sweep.

**Implication.** Pitch "no system" as the default for small teams and individuals, with the hosted bot as an optional always-on layer that reads the same log (section 2). Don't pitch it as replacing hosted review.

## 2. Soup.net as the decision log for other systems

### Per-system table

"Decision log" means a record of why a choice was made, with who, when and evidence. Learned-layer details are in reports 01 and 04; this table only answers the two questions.

| System | Decision log? | Remote MCP client? | Auth | Tool restriction | Blocker |
|---|---|---|---|---|---|
| Devin sessions (incl. a session asked to review) | No. Knowledge fields documented: name, trigger, content, scope, folder, repo pin; no author, date or source (fetch-extracted, [Knowledge](https://docs.devin.ai/product-guides/knowledge)). Now migrating to Skills | Yes: "Devin supports 3 transport methods (stdio, SSE, and HTTP)" | "Choose between `None`, `Auth Header`, or `OAuth`"; OAuth org-shared or personal | Not documented on the MCP page | Adding servers "requires the **Manage MCP Servers** permission" (all fetch-extracted, [MCP](https://docs.devin.ai/work-with-devin/mcp)) |
| Devin Review | No; reads repo instruction files | Not documented (PRI; re-checked, "no reference to MCP servers or Knowledge", fetch-extracted) | n/a | n/a | Files only |
| Copilot cloud agent and code review | No. Copilot Memory holds repo facts with citations and 28-day expiry (report 01) | Yes, `http`/`sse`; config "shared between Copilot cloud agent and Copilot code review by default" | Static headers from `COPILOT_MCP_` secrets; OAuth remote servers not supported | `tools` allowlist; "strongly recommend ... read-only tools" | Needs a long-lived static key; repo admin configures (fetch-extracted, [docs](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/extend-coding-agent-with-mcp)) |
| CodeRabbit | No. Learnings carry PR, file, GitHub user (report 01) | Yes; "Tools used during analysis are listed under **'Additional context used.'**" | "API token, complete OAuth, or continue without authentication" | Admin chooses "which tools CodeRabbit may use" | Admin-only; "number of MCP server connections ... depends on your plan" (fetch-extracted, [docs](https://docs.coderabbit.ai/context-enrichment/mcp-server-integrations)) |
| Cursor cloud agents | No | Yes; "HTTP (recommended)"; "SSE and `mcp-remote` are not supported" | Headers or OAuth; "OAuth is per-user, including for MCP servers shared at the team level" | Not stated | None found (fetch-extracted, [docs](https://cursor.com/docs/cloud-agent/capabilities)) |
| Cursor Bugbot | No. Learned rules in a dashboard (report 01) | Likely: "Add the tools to Bugbot in Automations"; "MCP support is available on Team and Enterprise plans only" | Not stated | Tools chosen in Automations | Plan-gated; direction partly resolved vs PRI §7 (fetch-extracted, [docs](https://cursor.com/docs/bugbot)) |
| Codex CLI, IDE, desktop app | No | Yes: "The ChatGPT desktop app, Codex CLI, and IDE extension support MCP servers" | `bearer_token_env_var`, `http_headers`, or `codex mcp login` for OAuth | `enabled_tools` "Tool allow list", `disabled_tools` | None (fetch-extracted, [docs](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)) |
| Codex cloud and cloud code review | No; `AGENTS.md` review rules (report 02) | Not on the first-party MCP page's surface list; community request "There should be decent MCP support for Codex Cloud" (2025-10-07, no staff reply) | n/a | n/a | No MCP (fetch-extracted, [thread](https://community.openai.com/t/codex-cloud-mcp-server-support/1361373); **unverified** as current) |
| Claude Code Action | No; `CLAUDE.md` | Yes, `--mcp-config` | CI secrets | `--allowedTools` | Fork PRs get no secrets (PRI) |
| Claude managed Code Review | No; `CLAUDE.md`/`REVIEW.md`, thumbs tune Anthropic's model | Not documented | n/a | n/a | Files only |
| Graphite | No | Not found. GT MCP is a server: "allows AI agents to automatically create stacked PRs" (fetch-extracted, [docs](https://graphite.com/docs/gt-mcp)) | n/a | n/a | No client |
| Greptile | No. Learns from reactions (report 01) | Named connectors only: "By connecting your Jira, Greptile can search for and read the original Jira ticket" (fetch-extracted, [blog 2025-05-30](https://www.greptile.com/blog/greptile-update)); arbitrary remote servers not confirmed | Not stated | Not stated | Probably none for Soup.net |
| Qodo | No. Rule Miner links rules to source PRs (report 01) | IDE agent only: "you'll provide a URL, and optionally, you can add custom HTTP headers" (fetch-extracted, [docs](https://docs.qodo.ai/qodo-ide/tools-mcps/agentic-tools-mcps)) | Headers | Enterprise "Agentic Tools Allow List" | PR review not documented |
| Jules | No | Curated only: "Linear, Stitch, Neon, Tinybird, Context7, and Supabase" | "Our MCP server integration uses API key authentication." | n/a | Can't add Soup.net (fetch-extracted, [changelog 2026-02-02](https://jules.google/docs/changelog/2026-02-02/)) |
| Kiro web agent | No. Learns from comments, but only the task creator's: "the agent learns and applies those patterns to future work" (fetch-extracted, [docs](https://kiro.dev/docs/autonomous-agent/github/)) | Yes: "Kiro Web supports local (stdio) and remote (HTTP/SSE) MCP servers" | Headers or OAuth, `${key_name}` secrets | "MCP servers run outside the agent's tool-execution sandbox" | Kiro "doesn't perform code reviews" (fetch-extracted, [MCP](https://kiro.dev/docs/web/sandbox/mcp/)) |
| Amazon Q Developer GitHub review | No | Not documented | n/a | n/a | End of support; see report 01 |

### Hypotheses

**H4. "Devin has Knowledge but no decision log" is right, and Devin is the best first target.** For: the Knowledge docs list no author, date, source or history fields (fetch-extracted). Knowledge is "tips, advice, and instructions" (PRI), and Skills, its replacement, are instructions too. Devin sessions take header-auth remote MCP, and plugins now bundle "skills, rules, hooks, and MCP servers" installable at personal, organization or enterprise level (fetch-extracted, [plugins](https://docs.devin.ai/product-guides/plugins)). Against: Devin Review, the surface that actually reviews PRs, documents no MCP. A Devin integration reaches sessions (including ones asked to review a PR), not the Review product. And Devin's own agents may not deposit well-formed recipes unprompted; the skill has to carry the recipe format.

Integration shape: a Soup.net plugin for Devin containing (a) a skill carrying the search-then-log procedure and the recipe voice rules, and (b) the Soup.net remote MCP server with an Auth Header. Read tools: `get_briefing`, `search_recipes`, `get_recipes`, `log_feedback`. Write: `check_recipe` with `draft` only, so a Devin session asks the person whose call it is instead of asserting their taste and judgment (plan §3). Personal-scope install needs no admin; org scope needs "Manage MCP Servers".

**H5. The gap is general: no surveyed system has a decision log, and most can read one over MCP.** For: the table. Against: several vendors have learned layers they will keep improving, and Copilot Memory's code-citation re-validation is a real feature Soup.net lacks (report 04).

Integration snippets (header auth, read-only allowlist; key from a secret store):

```json
{
  "mcpServers": {
    "soupnet": {
      "type": "http",
      "url": "https://mcp.soup.net/mcp",
      "tools": ["get_briefing", "search_recipes", "get_recipes", "log_feedback"],
      "headers": { "Authorization": "Bearer $COPILOT_MCP_SOUPNET_KEY" }
    }
  }
}
```

```toml
[mcp_servers.soupnet]
url = "https://mcp.soup.net/mcp"
bearer_token_env_var = "SOUPNET_API_KEY"
enabled_tools = ["get_briefing", "search_recipes", "get_recipes", "log_feedback"]
```

Blocker shared by every unattended client: the key. Copilot can't use OAuth, and every client's allowlist is client-side ("a convenience, not a control", PRI §3). Soup.net's daily keys expire too fast for a secret store. The unattended integrations therefore depend on drafts-and-triage slice 5 (headless, drafts-only keys) or PRI's no-deposit service principal, enforced server-side.

**H6. For reviewers that can't call out, the log reaches them through repo files.** Devin Review, Claude managed Code Review, Graphite, Codex cloud and Jules all read repo files. Report 04's generated `REVIEW.md`/`AGENTS.md` section with recipe ids is the only route to them, and it is also what makes "no system" teams consistent with any hosted bot they add later.

### Updates to PRI (stale as of this pass)

- Devin: Knowledge "is being migrated to Skills" (2026-09-21) and plugins bundle MCP servers (2026-09-09) (fetch-extracted, [release notes](https://docs.devin.ai/release-notes/2026)). PRI §5's "Devin Knowledge item pinned to the repo" snippet should become a Devin plugin. PRI §7's open question on a per-server tool allowlist is still undocumented.
- Cursor: cloud agents take headers or per-user OAuth; Bugbot MCP is Team/Enterprise via Automations. This mostly answers PRI §7's direction question (Bugbot can use tools), with auth still unstated.
- CodeRabbit: MCP connections are admin-only and capped by plan.
- New rows PRI lacked: Codex (local yes, cloud no), Jules (curated only), Kiro (yes, but no PR review), Graphite (server only).

## Soup.net use

- Intent: `int_C5nGCRMYAvNOlhTFrM3fJaHr`; agent_id `a-pr-review-research-landscape-2026-09-27`.
- Search `412671fe-43ff-4010-86e7-32d03ee99547` (Devin or Copilot calling Soup.net as a decision log): surfaced older setup and coordination recipes (`4b2d506b`, `e15f48ab`, `b842ce34`, `ddb118c8`); nothing on Devin or third-party platforms. Thin corpus area.
- Search `ef9b2d36-6644-42c3-89db-ee2a7bda565c` (review without setup): surfaced `103e6242` (helpers, not another workflow), `97fa42eb`, `e7c16ef0`, `c5410416`. Framed the H3 pitch.
- Search `9651d503-a598-400d-8423-3cf81d02e567` (integrations, OAuth vs static key): surfaced `5b38080d` (per-platform MCP setup docs), `eb4b77eb` (scoped-down derived keys, OAuth parity), `1416ce64` (zero-setup web page primary). `eb4b77eb` informs the key blocker in H5.
- Feedback rows: `edade259-73a3-487b-834b-928805fde354` (search 412671fe, null result, charted-new), `92504607-7fd8-488a-bf99-e9f03b529dd3` (search ef9b2d36), `324cac53-1c11-475f-bf7e-89472b5c4c37` (search 9651d503).
- Recipe checks: none. Findings are research; the positioning calls (H3 "no system" as default, Devin plugin as first integration) are escalated to the planning agent.
